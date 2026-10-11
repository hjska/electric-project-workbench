import { getDb } from '../db/index'

export interface EquipmentRow {
  id?: number
  /** null = 日常备品（暂不归属任何项目） */
  project_id: number | null
  name: string
  model?: string
  tag_no?: string
  brand?: string
  supplier?: string
  unit: string
  quantity: number
  unit_price?: number
  contract_arrival_date?: string | null
  actual_arrival_date?: string | null
  arrival_status: string
  accept_status: string
  location?: string
  remark?: string
}

export function validateEquipment(d: EquipmentRow) {
  // project_id 允许为空 —— 空表示「日常备品」，只在物料管理里维护；
  // 一旦填了就必须是合法项目 id。
  if (d.project_id !== null && d.project_id !== undefined) {
    if (!Number.isInteger(Number(d.project_id)) || Number(d.project_id) <= 0) {
      throw new Error('所属项目无效')
    }
  }
  if (!d.name?.trim()) throw new Error('设备名称不能为空')
  if (!(Number(d.quantity) > 0)) throw new Error('数量必须大于 0')
  if (d.unit_price !== undefined && d.unit_price !== null && Number(d.unit_price) < 0) {
    throw new Error('单价不能为负数')
  }
  // R6 已到货/部分到货必须填实际到货日期
  if (['已到货', '部分到货'].includes(d.arrival_status) && !d.actual_arrival_date) {
    throw new Error('到货状态为"已到货/部分到货"时必须填写实际到货日期')
  }
  // R7 验收结果必须有已到货前置
  if (['合格', '不合格', '让步接收'].includes(d.accept_status) && d.arrival_status === '未到货') {
    throw new Error('未到货的设备不能进行验收')
  }
}

const FIELDS: (keyof EquipmentRow)[] = [
  'project_id', 'name', 'model', 'tag_no', 'brand', 'supplier', 'unit',
  'quantity', 'unit_price', 'contract_arrival_date', 'actual_arrival_date',
  'arrival_status', 'accept_status', 'location', 'remark',
]

export function listEquipment(q: { projectId: number; quick?: string; keyword?: string }) {
  const db = getDb()
  const where: string[] = ['project_id = ?']
  const params: any[] = [q.projectId]
  if (q.keyword) {
    where.push('(name LIKE ? OR model LIKE ? OR tag_no LIKE ? OR supplier LIKE ?)')
    const k = `%${q.keyword}%`
    params.push(k, k, k, k)
  }
  if (q.quick === 'not_arrived') where.push("arrival_status = '未到货'")
  if (q.quick === 'unqualified') where.push("accept_status = '不合格'")
  if (q.quick === 'upcoming') {
    where.push("contract_arrival_date IS NOT NULL AND contract_arrival_date <= date('now','localtime','+7 day') AND arrival_status = '未到货'")
  }
  return db.prepare(`SELECT * FROM equipment WHERE ${where.join(' AND ')} ORDER BY id DESC`).all(...params)
}

export function listAllEquipment(projectId: number) {
  return listEquipment({ projectId })
}

export function getEquipment(id: number) {
  const row = getDb().prepare('SELECT * FROM equipment WHERE id = ?').get(id)
  if (!row) throw new Error('设备记录不存在')
  return row
}

export function createEquipment(data: EquipmentRow) {
  validateEquipment(data)
  const db = getDb()
  const cols = FIELDS.filter((f) => data[f] !== undefined)
  const values = cols.map((f) => (data[f] === undefined ? null : data[f]))
  const info = db.prepare(`INSERT INTO equipment (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...values)
  return getEquipment(Number(info.lastInsertRowid))
}

export function updateEquipment(id: number, data: EquipmentRow) {
  validateEquipment(data)
  const db = getDb()
  const cols = FIELDS.filter((f) => data[f] !== undefined)
  const values = cols.map((f) => (data[f] === undefined ? null : data[f]))
  db.prepare(`UPDATE equipment SET ${cols.map((c) => `${c} = ?`).join(', ')},
    updated_at = datetime('now','localtime') WHERE id = ?`).run(...values, id)
  return getEquipment(id)
}

export function removeEquipment(id: number) {
  getDb().prepare('DELETE FROM equipment WHERE id = ?').run(id)
  return { deleted: true }
}

/** 批量导入：按 project+name+model 判重（存在则更新，不存在则插入）。projectId 传 null 即导入到「日常备品」。 */
export function importEquipment(projectId: number | null, rows: Partial<EquipmentRow>[]) {
  const db = getDb()
  let inserted = 0
  let updated = 0
  const errors: { row: number; message: string }[] = []

  const findExisting = projectId
    ? db.prepare("SELECT id FROM equipment WHERE project_id = ? AND name = ? AND IFNULL(model,'') = IFNULL(?,'')")
    : db.prepare("SELECT id FROM equipment WHERE project_id IS NULL AND name = ? AND IFNULL(model,'') = IFNULL(?,'')")

  const tx = db.transaction((list: Partial<EquipmentRow>[]) => {
    list.forEach((raw, idx) => {
      try {
        const d: EquipmentRow = {
          project_id: projectId ?? null,
          name: String(raw.name ?? '').trim(),
          model: raw.model ? String(raw.model).trim() : undefined,
          tag_no: raw.tag_no,
          brand: raw.brand,
          supplier: raw.supplier,
          unit: raw.unit || '台',
          quantity: Number(raw.quantity),
          unit_price: raw.unit_price !== undefined && raw.unit_price !== null && raw.unit_price !== ('' as any) ? Number(raw.unit_price) : 0,
          contract_arrival_date: raw.contract_arrival_date || null,
          actual_arrival_date: raw.actual_arrival_date || null,
          arrival_status: raw.arrival_status || '未到货',
          accept_status: raw.accept_status || '未验收',
          location: raw.location,
          remark: raw.remark,
        }
        validateEquipment(d)
        const existing = (projectId
          ? findExisting.get(projectId, d.name, d.model ?? '')
          : findExisting.get(d.name, d.model ?? '')) as { id: number } | undefined
        if (existing) {
          updateEquipment(existing.id, d)
          updated++
        } else {
          createEquipment(d)
          inserted++
        }
      } catch (e: any) {
        errors.push({ row: idx + 1, message: e.message })
      }
    })
  })
  tx(rows)
  return { inserted, updated, errors, total: rows.length }
}
