import { getDb } from '../db/index'

export interface IssueRow {
  id?: number
  project_id: number
  process_id?: number | null
  description: string
  severity?: string
  reporter?: string
  report_date: string
  owner?: string
  due_date?: string | null
  status?: string
  solution?: string | null
  close_date?: string | null
}

/** R13 已闭环必须填处理措施与闭环日期 */
function validate(d: IssueRow) {
  if (!d.project_id) throw new Error('必须指定所属项目')
  if (!d.description?.trim()) throw new Error('问题描述不能为空')
  if (!d.report_date) throw new Error('提出日期不能为空')
  if (d.status === '已闭环') {
    if (!d.solution?.trim()) throw new Error('状态为"已闭环"时必须填写处理措施')
    if (!d.close_date) throw new Error('状态为"已闭环"时必须填写闭环日期')
  }
}

export function listIssues(q: { projectId: number; status?: string; severity?: string; quick?: string }) {
  const db = getDb()
  const where: string[] = ['i.project_id = ?']
  const params: any[] = [q.projectId]
  if (q.status) { where.push('i.status = ?'); params.push(q.status) }
  if (q.severity) { where.push('i.severity = ?'); params.push(q.severity) }
  if (q.quick === 'overdue') {
    where.push("i.status <> '已闭环' AND i.due_date IS NOT NULL AND i.due_date < date('now','localtime')")
  }
  const rows: any[] = db.prepare(`
    SELECT i.*, p.name AS process_name FROM issue i
    LEFT JOIN process p ON p.id = i.process_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE i.severity WHEN '紧急' THEN 0 WHEN '重要' THEN 1 ELSE 2 END, i.report_date DESC
  `).all(...params)
  const today = new Date().toISOString().slice(0, 10)
  return rows.map((r) => ({
    ...r,
    isOverdue: r.status !== '已闭环' && r.due_date && r.due_date < today,
  }))
}

export function getIssue(id: number) {
  const row = getDb().prepare('SELECT * FROM issue WHERE id = ?').get(id)
  if (!row) throw new Error('问题记录不存在')
  return row
}

export function createIssue(data: IssueRow) {
  validate(data)
  const db = getDb()
  const info = db.prepare(`INSERT INTO issue
    (project_id, process_id, description, severity, reporter, report_date, owner, due_date, status, solution, close_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    data.project_id, data.process_id ?? null, data.description, data.severity || '一般',
    data.reporter ?? null, data.report_date, data.owner ?? null, data.due_date ?? null,
    data.status || '待处理', data.solution ?? null, data.close_date ?? null,
  )
  return getIssue(Number(info.lastInsertRowid))
}

export function updateIssue(id: number, data: IssueRow) {
  validate(data)
  const db = getDb()
  db.prepare(`UPDATE issue SET process_id = ?, description = ?, severity = ?, reporter = ?, report_date = ?,
    owner = ?, due_date = ?, status = ?, solution = ?, close_date = ?, updated_at = datetime('now','localtime')
    WHERE id = ?`).run(
    data.process_id ?? null, data.description, data.severity || '一般', data.reporter ?? null, data.report_date,
    data.owner ?? null, data.due_date ?? null, data.status || '待处理', data.solution ?? null, data.close_date ?? null, id,
  )
  return getIssue(id)
}

export function removeIssue(id: number) {
  getDb().prepare('DELETE FROM issue WHERE id = ?').run(id)
  return { deleted: true }
}
