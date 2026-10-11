import { getDb } from '../db/index'
import { updateEquipment, validateEquipment, type EquipmentRow } from './equipment.service'

/**
 * 总物料管理（跨项目）。
 *
 * 数据仍存放在 equipment 表，本模块不新增表结构，只提供「汇总视角」：
 *   - listMaterials      全项目物料总表（带项目归属、金额、逾期天数）
 *   - materialStats      与总表同一套过滤条件下的汇总指标
 *   - groupByProject     按项目汇总（含没有任何物料的项目）
 *   - groupBySupplier    按供货商汇总（催货用）
 *   - batchUpdateStatus  批量改到货 / 验收状态，逐条走设备校验，违规的跳过并说明原因
 *
 * 「逾期」口径：有合同到货日期、且该日期早于今天、且尚未「已到货」。
 * 「待到货验收」口径：已到货 / 部分到货，但验收状态仍为「未验收」。
 *
 * 「日常备品」：project_id 为空的物料（暂不归属任何项目的公共备件）。
 * 它们必须出现在总表里，所以所有联表一律用 LEFT JOIN project，
 * 否则 INNER JOIN 会把备品整批过滤掉。
 */

export type MaterialView = 'all' | 'overdue' | 'upcoming' | 'pending_accept' | 'unqualified'

export interface MaterialQuery {
  /** 不传 / null 表示全部项目 */
  projectId?: number | null
  /** true = 只看日常备品（project_id IS NULL） */
  common?: boolean
  keyword?: string
  arrival?: string[]
  accept?: string[]
  supplier?: string
  brand?: string
  view?: MaterialView
  /** 合同到货日期区间（含） */
  from?: string
  to?: string
}

/** 日常备品的展示名（总表 / 汇总共用，避免各处写歪） */
export const COMMON_GROUP_NAME = '日常备品（未分配项目）'

/** 逾期判定（SQL 片段，统一口径，避免各处写歪） */
const OVERDUE_SQL = `(e.contract_arrival_date IS NOT NULL AND TRIM(e.contract_arrival_date) <> ''
  AND e.arrival_status <> '已到货'
  AND date(e.contract_arrival_date) < date('now','localtime'))`

/** 待到货验收判定 */
const PENDING_ACCEPT_SQL = `(e.arrival_status IN ('已到货','部分到货') AND e.accept_status = '未验收')`

/** 7 天内应到货（含今天，且尚未到货） */
const UPCOMING_SQL = `(e.contract_arrival_date IS NOT NULL AND TRIM(e.contract_arrival_date) <> ''
  AND e.arrival_status <> '已到货'
  AND date(e.contract_arrival_date) BETWEEN date('now','localtime') AND date('now','localtime','+7 day'))`

const BASE_SELECT = `
  SELECT
    e.id, e.project_id, e.name, e.model, e.tag_no, e.brand, e.supplier, e.unit,
    e.quantity, e.unit_price, e.contract_arrival_date, e.actual_arrival_date,
    e.arrival_status, e.accept_status, e.location, e.remark, e.created_at, e.updated_at,
    p.code AS project_code, p.name AS project_name, p.status AS project_status,
    CASE WHEN e.project_id IS NULL THEN 1 ELSE 0 END AS is_common,
    (e.quantity * IFNULL(e.unit_price, 0)) AS amount,
    CASE WHEN e.contract_arrival_date IS NULL OR TRIM(e.contract_arrival_date) = '' THEN NULL
         ELSE CAST(julianday(date(e.contract_arrival_date)) - julianday(date('now','localtime')) AS INTEGER)
    END AS days_to_contract,
    CASE WHEN ${OVERDUE_SQL} THEN 1 ELSE 0 END AS is_overdue,
    CASE WHEN ${PENDING_ACCEPT_SQL} THEN 1 ELSE 0 END AS pending_accept
  FROM equipment e
  LEFT JOIN project p ON p.id = e.project_id
`

/** 排序：项目物料按项目编号排在前，日常备品统一沉底 */
const ORDER_BY = `ORDER BY CASE WHEN e.project_id IS NULL THEN 1 ELSE 0 END, p.code ASC, e.id ASC`

/** 组装过滤条件。总表与汇总指标共用，保证两边数字一致。 */
function buildWhere(q: MaterialQuery) {
  const w: string[] = []
  const params: any[] = []

  if (q.common) {
    w.push('e.project_id IS NULL')
  } else if (q.projectId) {
    w.push('e.project_id = ?')
    params.push(q.projectId)
  }
  if (q.keyword?.trim()) {
    // 备品的 p.name / p.code 为空，用 IFNULL 兜底成「日常备品」，这样搜「备品」也能命中
    w.push(`(e.name LIKE ? OR e.model LIKE ? OR e.tag_no LIKE ? OR e.brand LIKE ?
      OR e.supplier LIKE ? OR e.location LIKE ? OR IFNULL(p.name,'日常备品') LIKE ? OR IFNULL(p.code,'') LIKE ?)`)
    const k = `%${q.keyword.trim()}%`
    params.push(k, k, k, k, k, k, k, k)
  }
  if (q.arrival?.length) {
    w.push(`e.arrival_status IN (${q.arrival.map(() => '?').join(',')})`)
    params.push(...q.arrival)
  }
  if (q.accept?.length) {
    w.push(`e.accept_status IN (${q.accept.map(() => '?').join(',')})`)
    params.push(...q.accept)
  }
  if (q.supplier) {
    w.push('e.supplier = ?')
    params.push(q.supplier)
  }
  if (q.brand) {
    w.push('e.brand = ?')
    params.push(q.brand)
  }
  if (q.from) {
    w.push('e.contract_arrival_date >= ?')
    params.push(q.from)
  }
  if (q.to) {
    w.push('e.contract_arrival_date <= ?')
    params.push(q.to)
  }

  switch (q.view) {
    case 'overdue': w.push(OVERDUE_SQL); break
    case 'upcoming': w.push(UPCOMING_SQL); break
    case 'pending_accept': w.push(PENDING_ACCEPT_SQL); break
    case 'unqualified': w.push("e.accept_status = '不合格'"); break
    default: break
  }

  return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', params }
}

/** 全项目物料总表（含日常备品） */
export function listMaterials(q: MaterialQuery = {}) {
  const { sql, params } = buildWhere(q)
  return getDb()
    .prepare(`${BASE_SELECT} ${sql} ${ORDER_BY}`)
    .all(...params)
}

/** 与总表同过滤条件下的汇总指标 */
export function materialStats(q: MaterialQuery = {}) {
  const { sql, params } = buildWhere(q)
  const row = getDb().prepare(`
    SELECT
      COUNT(*)                                                              AS items,
      IFNULL(SUM(e.quantity), 0)                                            AS total_qty,
      IFNULL(SUM(e.quantity * IFNULL(e.unit_price, 0)), 0)                  AS total_amount,
      IFNULL(SUM(CASE WHEN e.arrival_status = '已到货' THEN e.quantity ELSE 0 END), 0) AS arrived_qty,
      IFNULL(SUM(CASE WHEN e.arrival_status = '未到货' THEN 1 ELSE 0 END), 0)   AS not_arrived,
      IFNULL(SUM(CASE WHEN e.arrival_status = '部分到货' THEN 1 ELSE 0 END), 0) AS partial,
      IFNULL(SUM(CASE WHEN e.arrival_status = '已到货' THEN 1 ELSE 0 END), 0)   AS arrived,
      IFNULL(SUM(CASE WHEN ${PENDING_ACCEPT_SQL} THEN 1 ELSE 0 END), 0)         AS pending_accept,
      IFNULL(SUM(CASE WHEN e.accept_status = '不合格' THEN 1 ELSE 0 END), 0)     AS unqualified,
      IFNULL(SUM(CASE WHEN ${OVERDUE_SQL} THEN 1 ELSE 0 END), 0)                AS overdue,
      IFNULL(SUM(CASE WHEN ${UPCOMING_SQL} THEN 1 ELSE 0 END), 0)               AS upcoming,
      IFNULL(SUM(CASE WHEN e.project_id IS NULL THEN 1 ELSE 0 END), 0)          AS common_items,
      IFNULL(SUM(CASE WHEN e.project_id IS NULL THEN e.quantity ELSE 0 END), 0)  AS common_qty,
      COUNT(DISTINCT e.project_id)                                              AS project_count,
      COUNT(DISTINCT CASE WHEN e.supplier IS NOT NULL AND TRIM(e.supplier) <> ''
                          THEN e.supplier END)                                  AS supplier_count
    FROM equipment e
    LEFT JOIN project p ON p.id = e.project_id
    ${sql}
  `).get(...params) as any

  return {
    ...row,
    arrival_rate: row.total_qty > 0 ? Math.round((row.arrived_qty / row.total_qty) * 100) : 0,
  }
}

/**
 * 分组聚合的公共片段（项目分组 / 备品分组用同一套口径）。
 * 注意用 COUNT(e.id) 而非 COUNT(*)：LEFT JOIN 下没有物料的项目也会有一行，
 * COUNT(*) 会把它算成 1 条物料。
 */
const GROUP_AGG_SQL = `
  COUNT(e.id)                                                       AS items,
  IFNULL(SUM(e.quantity), 0)                                        AS qty,
  IFNULL(SUM(e.quantity * IFNULL(e.unit_price, 0)), 0)              AS amount,
  IFNULL(SUM(CASE WHEN e.arrival_status = '已到货' THEN e.quantity ELSE 0 END), 0) AS arrived_qty,
  IFNULL(SUM(CASE WHEN e.arrival_status = '未到货' THEN 1 ELSE 0 END), 0)  AS not_arrived,
  IFNULL(SUM(CASE WHEN e.arrival_status = '部分到货' THEN 1 ELSE 0 END), 0) AS partial,
  IFNULL(SUM(CASE WHEN ${PENDING_ACCEPT_SQL} THEN 1 ELSE 0 END), 0)        AS pending_accept,
  IFNULL(SUM(CASE WHEN e.accept_status = '不合格' THEN 1 ELSE 0 END), 0)    AS unqualified,
  IFNULL(SUM(CASE WHEN ${OVERDUE_SQL} THEN 1 ELSE 0 END), 0)               AS overdue,
  MAX(e.updated_at)                                                        AS last_updated
`

/** 日常备品聚合为一条虚拟分组（id=0，前端据此渲染成标签而非项目链接） */
export function commonGroupRow() {
  const a = getDb().prepare(`
    SELECT ${GROUP_AGG_SQL}
    FROM equipment e
    WHERE e.project_id IS NULL
  `).get() as any
  return {
    id: 0,
    code: '—',
    name: COMMON_GROUP_NAME,
    status: '',
    is_common: 1,
    ...a,
  }
}

/**
 * 按项目汇总。用 LEFT JOIN，保证没有录物料的项目也会出现在列表里；
 * 日常备品作为一条独立分组追加在最后（没有备品时不出现）。
 */
export function groupByProject(q: { projectId?: number | null; common?: boolean } = {}) {
  const db = getDb()
  const common = commonGroupRow()

  if (q.common) return common.items > 0 ? [common] : []

  const where = q.projectId ? 'WHERE p.id = ?' : ''
  const params = q.projectId ? [q.projectId] : []
  const rows = db.prepare(`
    SELECT
      p.id, p.code, p.name, p.status,
      ${GROUP_AGG_SQL}
    FROM project p
    LEFT JOIN equipment e ON e.project_id = p.id
    ${where}
    GROUP BY p.id
    ORDER BY p.code ASC
  `).all(...params) as any[]

  if (!q.projectId && common.items > 0) rows.push(common)
  return rows
}

/** 按供货商汇总（催货视角） */
export function groupBySupplier(q: { projectId?: number | null; common?: boolean } = {}) {
  const w = ["e.supplier IS NOT NULL", "TRIM(e.supplier) <> ''"]
  const params: any[] = []
  if (q.common) {
    w.push('e.project_id IS NULL')
  } else if (q.projectId) {
    w.push('e.project_id = ?')
    params.push(q.projectId)
  }
  return getDb().prepare(`
    SELECT
      e.supplier                                                        AS name,
      COUNT(DISTINCT e.project_id)                                      AS project_count,
      COUNT(*)                                                          AS items,
      IFNULL(SUM(e.quantity), 0)                                        AS qty,
      IFNULL(SUM(e.quantity * IFNULL(e.unit_price, 0)), 0)              AS amount,
      IFNULL(SUM(CASE WHEN e.project_id IS NULL THEN 1 ELSE 0 END), 0)  AS common_items,
      IFNULL(SUM(CASE WHEN e.arrival_status = '未到货' THEN 1 ELSE 0 END), 0)  AS not_arrived,
      IFNULL(SUM(CASE WHEN ${OVERDUE_SQL} THEN 1 ELSE 0 END), 0)               AS overdue,
      IFNULL(SUM(CASE WHEN ${PENDING_ACCEPT_SQL} THEN 1 ELSE 0 END), 0)        AS pending_accept,
      IFNULL(SUM(CASE WHEN e.accept_status = '不合格' THEN 1 ELSE 0 END), 0)    AS unqualified
    FROM equipment e
    LEFT JOIN project p ON p.id = e.project_id
    WHERE ${w.join(' AND ')}
    GROUP BY e.supplier
    ORDER BY amount DESC, items DESC
  `).all(...params)
}

/** 筛选下拉的可选值 */
export function materialFacets(q: { projectId?: number | null } = {}) {
  const where = q.projectId ? 'WHERE project_id = ?' : ''
  const params = q.projectId ? [q.projectId] : []
  const db = getDb()
  const pick = (col: string) => (db.prepare(`
    SELECT DISTINCT ${col} AS v FROM equipment
    ${where}${where ? ' AND' : 'WHERE'} ${col} IS NOT NULL AND TRIM(${col}) <> ''
    ORDER BY ${col} ASC
  `).all(...params) as { v: string }[]).map((r) => r.v)
  return { suppliers: pick('supplier'), brands: pick('brand') }
}

export interface BatchPatch {
  arrival_status?: string
  accept_status?: string
  actual_arrival_date?: string | null
  location?: string
}

function todayLocal() {
  const t = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

/**
 * 批量修改状态。
 *
 * 不绕过业务规则：每条都走一遍设备校验（如「未到货不能验收」），
 * 不合法的条目记入 skipped 并带上原因，其余照常更新——避免"整批失败"。
 * 设为「已到货 / 部分到货」但没给实际到货日期时，默认取今天。
 */
export function batchUpdateStatus(ids: number[], patch: BatchPatch) {
  const db = getDb()
  const skipped: { id: number; name: string; project_name?: string; reason: string }[] = []
  let updated = 0

  const tx = db.transaction((list: number[]) => {
    for (const id of list) {
      const cur = db.prepare(`
        SELECT e.*, p.name AS project_name
        FROM equipment e LEFT JOIN project p ON p.id = e.project_id
        WHERE e.id = ?
      `).get(id) as any
      if (!cur) {
        skipped.push({ id, name: '', reason: '物料不存在（可能已被删除）' })
        continue
      }

      const next: EquipmentRow = { ...cur, project_id: cur.project_id ?? null }

      if (patch.arrival_status) {
        next.arrival_status = patch.arrival_status
        if (['已到货', '部分到货'].includes(patch.arrival_status)) {
          next.actual_arrival_date = patch.actual_arrival_date || cur.actual_arrival_date || todayLocal()
        } else {
          // 退回「未到货」时清掉实际到货日期，否则数据自相矛盾
          next.actual_arrival_date = null
        }
      } else if (patch.actual_arrival_date !== undefined) {
        next.actual_arrival_date = patch.actual_arrival_date
      }

      if (patch.accept_status) next.accept_status = patch.accept_status
      if (patch.location !== undefined) next.location = patch.location

      try {
        validateEquipment(next)
      } catch (e: any) {
        skipped.push({
          id,
          name: cur.name,
          project_name: cur.project_name || COMMON_GROUP_NAME,
          reason: e?.message || '不满足设备校验规则',
        })
        continue
      }

      updateEquipment(id, next)
      updated++
    }
  })
  tx(ids)

  return { updated, skipped, total: ids.length }
}

/** 批量删除 */
export function removeMany(ids: number[]) {
  const db = getDb()
  const tx = db.transaction((list: number[]) => {
    const stmt = db.prepare('DELETE FROM equipment WHERE id = ?')
    let n = 0
    for (const id of list) n += stmt.run(id).changes
    return n
  })
  return { deleted: tx(ids) }
}
