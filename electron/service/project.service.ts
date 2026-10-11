import { getDb } from '../db/index'
import { ensureProjectFolder, syncFolderOnRename } from './folder.service'

export interface ProjectRow {
  id?: number
  code: string
  name: string
  address?: string
  owner_unit?: string
  build_unit?: string
  supervise_unit?: string
  manager: string
  phone?: string
  contract_amount?: number
  start_date: string
  plan_end_date: string
  actual_end_date?: string | null
  status: string
  remark?: string
}

/** 校验项目数据的业务规则 R1~R3 */
function validate(data: ProjectRow, isUpdate = false, id?: number) {
  if (!data.code?.trim()) throw new Error('项目编号不能为空')
  if (!data.name?.trim()) throw new Error('项目名称不能为空')
  if (!data.manager?.trim()) throw new Error('项目经理不能为空')
  if (!data.start_date) throw new Error('开工日期不能为空')
  if (!data.plan_end_date) throw new Error('计划竣工日期不能为空')

  // R2 计划竣工不得早于开工
  if (data.plan_end_date < data.start_date) throw new Error('计划竣工日期不得早于开工日期')

  // R3 仅"已竣工"时允许填写实际竣工日期
  if (data.actual_end_date && data.status !== '已竣工') {
    throw new Error('仅当项目状态为"已竣工"时才能填写实际竣工日期')
  }

  // R1 编号唯一
  const db = getDb()
  const dup = isUpdate
    ? db.prepare('SELECT id FROM project WHERE code = ? AND id <> ?').get(data.code.trim(), id)
    : db.prepare('SELECT id FROM project WHERE code = ?').get(data.code.trim())
  if (dup) throw new Error(`项目编号「${data.code}」已存在`)
}

const FIELDS: (keyof ProjectRow)[] = [
  'code', 'name', 'address', 'owner_unit', 'build_unit', 'supervise_unit',
  'manager', 'phone', 'contract_amount', 'start_date', 'plan_end_date',
  'actual_end_date', 'status', 'remark',
]

export function listProjects(query: { keyword?: string; status?: string; from?: string; to?: string } = {}) {
  const db = getDb()
  const where: string[] = []
  const params: any[] = []
  if (query.keyword) {
    where.push('(code LIKE ? OR name LIKE ?)')
    params.push(`%${query.keyword}%`, `%${query.keyword}%`)
  }
  if (query.status) {
    where.push('status = ?')
    params.push(query.status)
  }
  if (query.from) {
    where.push('start_date >= ?')
    params.push(query.from)
  }
  if (query.to) {
    where.push('start_date <= ?')
    params.push(query.to)
  }
  const sql = `
    SELECT p.*,
      (SELECT COUNT(*) FROM equipment e WHERE e.project_id = p.id) AS equipment_count,
      (SELECT COUNT(*) FROM equipment e WHERE e.project_id = p.id AND e.arrival_status = '已到货') AS arrived_count,
      (SELECT COUNT(*) FROM issue i WHERE i.project_id = p.id AND i.status <> '已闭环') AS open_issue_count,
      (SELECT IFNULL(SUM(weight),0) FROM process pr WHERE pr.project_id = p.id AND pr.status <> '已暂停') AS total_weight,
      (SELECT IFNULL(SUM(weight * CASE
          WHEN pr.plan_qty > 0 THEN MIN(pr.done_qty / pr.plan_qty, 1)
          WHEN pr.status = '已完成' THEN 1 ELSE 0 END),0)
        FROM process pr WHERE pr.project_id = p.id AND pr.status <> '已暂停') AS done_weight
    FROM project p
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.start_date DESC, p.id DESC
  `
  const rows: any[] = db.prepare(sql).all(...params)
  return rows.map((r) => ({
    ...r,
    progress: r.total_weight > 0 ? Math.round((r.done_weight / r.total_weight) * 100) : 0,
    arrival_rate: r.equipment_count > 0 ? Math.round((r.arrived_count / r.equipment_count) * 100) : 0,
  }))
}

export function getProject(id: number) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM project WHERE id = ?').get(id)
  if (!row) throw new Error('项目不存在')
  return row
}

export function createProject(data: ProjectRow) {
  validate(data)
  const db = getDb()
  const cols = FIELDS.filter((f) => data[f] !== undefined && f !== 'actual_end_date')
  // actual_end_date 允许为空
  const values = cols.map((f) => (data[f] === undefined ? null : data[f]))
  const sql = `INSERT INTO project (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  const info = db.prepare(sql).run(...values)
  const id = Number(info.lastInsertRowid)

  // 自动创建工程资料文件夹。建目录失败不应让整个建项目流程失败
  // （比如根目录所在磁盘未就绪），但要如实回报给界面。
  let folderWarning: string | null = null
  try {
    ensureProjectFolder({ id, code: String(data.code).trim(), name: String(data.name).trim() })
  } catch (e: any) {
    folderWarning = e?.message || String(e)
  }

  return { ...getProject(id), folderWarning }
}

export function updateProject(id: number, data: ProjectRow) {
  validate(data, true, id)
  const db = getDb()
  const before = getProject(id) as any
  const cols = FIELDS.filter((f) => data[f] !== undefined)
  const values = cols.map((f) => (data[f] === undefined ? null : data[f]))
  const sql = `UPDATE project SET ${cols.map((c) => `${c} = ?`).join(', ')},
      updated_at = datetime('now','localtime') WHERE id = ?`
  db.prepare(sql).run(...values, id)

  // 编号/名称改了，资料文件夹跟着改名，否则用户按新名字找不到目录
  const after = getProject(id) as any
  try {
    syncFolderOnRename(before, after)
  } catch { /* 改名失败不影响项目数据保存 */ }

  return getProject(id)
}

export function removeProject(id: number) {
  const db = getDb()
  const proj = db.prepare('SELECT folder_path FROM project WHERE id = ?').get(id) as { folder_path: string | null } | undefined
  const counts = {
    equipment: (db.prepare('SELECT COUNT(*) c FROM equipment WHERE project_id = ?').get(id) as any).c,
    process: (db.prepare('SELECT COUNT(*) c FROM process WHERE project_id = ?').get(id) as any).c,
    milestone: (db.prepare('SELECT COUNT(*) c FROM milestone WHERE project_id = ?').get(id) as any).c,
    issue: (db.prepare('SELECT COUNT(*) c FROM issue WHERE project_id = ?').get(id) as any).c,
    attachment: (db.prepare('SELECT COUNT(*) c FROM attachment WHERE project_id = ?').get(id) as any).c,
  }
  db.prepare('DELETE FROM project WHERE id = ?').run(id)
  // 资料文件夹一律保留 —— 里面是用户自己的图纸和程序，软件无权连带删除
  return { deleted: true, cascade: counts, folderKept: proj?.folder_path ?? null }
}

export function projectOptions() {
  const db = getDb()
  return db.prepare('SELECT id, code, name, status FROM project ORDER BY start_date DESC').all()
}
