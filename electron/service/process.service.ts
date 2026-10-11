import { getDb } from '../db/index'

export interface ProcessRow {
  id?: number
  project_id: number
  seq_no?: number
  name: string
  plan_qty?: number
  qty_unit?: string
  done_qty?: number
  plan_start: string
  plan_end: string
  actual_start?: string | null
  actual_end?: string | null
  weight?: number
  owner?: string
  status?: string
  remark?: string
}

function validate(d: ProcessRow) {
  if (!d.project_id) throw new Error('必须指定所属项目')
  if (!d.name?.trim()) throw new Error('工序名称不能为空')
  if (!d.plan_start || !d.plan_end) throw new Error('计划开始与计划结束不能为空')
  if (d.plan_end < d.plan_start) throw new Error('计划结束不得早于计划开始')
  if (d.plan_qty !== undefined && Number(d.plan_qty) < 0) throw new Error('计划总量不能为负数')
  if (d.weight !== undefined && Number(d.weight) <= 0) throw new Error('权重必须大于 0')
}

const FIELDS: (keyof ProcessRow)[] = [
  'project_id', 'seq_no', 'name', 'plan_qty', 'qty_unit', 'done_qty',
  'plan_start', 'plan_end', 'actual_start', 'actual_end', 'weight', 'owner', 'status', 'remark',
]

export function listProcess(projectId: number) {
  const db = getDb()
  return db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM daily_report r WHERE r.process_id = p.id) AS report_count,
      CASE WHEN p.plan_qty > 0 THEN MIN(p.done_qty / p.plan_qty, 1)
           WHEN p.status = '已完成' THEN 1 ELSE 0 END AS ratio
    FROM process p WHERE p.project_id = ? ORDER BY p.seq_no ASC, p.id ASC
  `).all(projectId)
}

export function getProcess(id: number) {
  const row = getDb().prepare('SELECT * FROM process WHERE id = ?').get(id)
  if (!row) throw new Error('工序不存在')
  return row
}

export function createProcess(data: ProcessRow) {
  validate(data)
  const db = getDb()
  if (data.seq_no === undefined) {
    const max = (db.prepare('SELECT IFNULL(MAX(seq_no),0) m FROM process WHERE project_id = ?').get(data.project_id) as any).m
    data.seq_no = max + 1
  }
  const cols = FIELDS.filter((f) => data[f] !== undefined)
  const values = cols.map((f) => (data[f] === undefined ? null : data[f]))
  const info = db.prepare(`INSERT INTO process (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...values)
  return getProcess(Number(info.lastInsertRowid))
}

export function updateProcess(id: number, data: ProcessRow) {
  validate(data)
  const db = getDb()
  const cols = FIELDS.filter((f) => data[f] !== undefined)
  const values = cols.map((f) => (data[f] === undefined ? null : data[f]))
  db.prepare(`UPDATE process SET ${cols.map((c) => `${c} = ?`).join(', ')},
    updated_at = datetime('now','localtime') WHERE id = ?`).run(...values, id)
  return getProcess(id)
}

export function removeProcess(id: number) {
  getDb().prepare('DELETE FROM process WHERE id = ?').run(id)
  return { deleted: true }
}

export function reorderProcess(items: { id: number; seq_no: number }[]) {
  const db = getDb()
  const stmt = db.prepare('UPDATE process SET seq_no = ? WHERE id = ?')
  const tx = db.transaction((list: { id: number; seq_no: number }[]) => {
    list.forEach((it) => stmt.run(it.seq_no, it.id))
  })
  tx(items)
  return { ok: true }
}

/** R11/R12：根据某工序全部日报重算累计完成量与状态 */
export function recalcProcess(processId: number) {
  const db = getDb()
  const p = db.prepare('SELECT * FROM process WHERE id = ?').get(processId) as any
  if (!p) return null

  const agg = db.prepare(
    'SELECT IFNULL(SUM(day_qty),0) s, MIN(report_date) first, MAX(report_date) last FROM daily_report WHERE process_id = ?',
  ).get(processId) as any
  const cum = Number(agg.s) || 0
  const firstDate = agg.first as string | null
  const lastDate = agg.last as string | null

  let status = p.status
  let actualEnd = p.actual_end
  if (p.plan_qty > 0 && cum > 0 && cum < p.plan_qty && status === '未开始') status = '进行中'
  if (p.plan_qty > 0 && cum >= p.plan_qty) {
    status = '已完成'
    actualEnd = lastDate
  } else if (cum < p.plan_qty) {
    // 未完成时不应残留结束日期
    actualEnd = null
  }
  // 实际开始取首条日报日期
  const actualStart = cum > 0 ? firstDate : null

  db.prepare(`UPDATE process SET done_qty = ?, status = ?, actual_end = ?, actual_start = ?,
    updated_at = datetime('now','localtime') WHERE id = ?`).run(cum, status, actualEnd, actualStart, processId)
  return getProcess(processId)
}
