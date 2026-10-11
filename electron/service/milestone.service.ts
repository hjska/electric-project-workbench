import { getDb } from '../db/index'

export interface MilestoneRow {
  id?: number
  project_id: number
  name: string
  plan_date: string
  actual_date?: string | null
  status?: string
  description?: string
  process_ids?: number[]
}

function validate(d: MilestoneRow) {
  if (!d.project_id) throw new Error('必须指定所属项目')
  if (!d.name?.trim()) throw new Error('里程碑名称不能为空')
  if (!d.plan_date) throw new Error('计划日期不能为空')
}

export function listMilestones(projectId: number) {
  const db = getDb()
  const rows: any[] = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM milestone_process mp WHERE mp.milestone_id = m.id) AS process_count
    FROM milestone m WHERE m.project_id = ? ORDER BY m.plan_date ASC, m.id ASC
  `).all(projectId)
  const today = new Date().toISOString().slice(0, 10)
  return rows.map((r) => ({
    ...r,
    isOverdue: r.status !== '已达成' && r.plan_date < today,
  }))
}

export function getMilestone(id: number) {
  const row = getDb().prepare('SELECT * FROM milestone WHERE id = ?').get(id)
  if (!row) throw new Error('里程碑不存在')
  return row
}

function saveLinks(milestoneId: number, processIds?: number[]) {
  const db = getDb()
  db.prepare('DELETE FROM milestone_process WHERE milestone_id = ?').run(milestoneId)
  if (processIds?.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO milestone_process(milestone_id, process_id) VALUES (?, ?)')
    processIds.forEach((pid) => stmt.run(milestoneId, pid))
  }
}

export function createMilestone(data: MilestoneRow) {
  validate(data)
  const db = getDb()
  const info = db.prepare(`INSERT INTO milestone (project_id, name, plan_date, actual_date, status, description)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    data.project_id, data.name, data.plan_date, data.actual_date ?? null,
    data.status || '未开始', data.description ?? null,
  )
  const id = Number(info.lastInsertRowid)
  saveLinks(id, data.process_ids)
  return getMilestone(id)
}

export function updateMilestone(id: number, data: MilestoneRow) {
  validate(data)
  const db = getDb()
  db.prepare(`UPDATE milestone SET name = ?, plan_date = ?, actual_date = ?, status = ?, description = ?,
    updated_at = datetime('now','localtime') WHERE id = ?`).run(
    data.name, data.plan_date, data.actual_date ?? null, data.status || '未开始', data.description ?? null, id,
  )
  saveLinks(id, data.process_ids)
  return getMilestone(id)
}

export function removeMilestone(id: number) {
  getDb().prepare('DELETE FROM milestone WHERE id = ?').run(id)
  return { deleted: true }
}

export function getMilestoneProcessIds(milestoneId: number) {
  return (getDb().prepare('SELECT process_id FROM milestone_process WHERE milestone_id = ?').all(milestoneId) as any[])
    .map((r) => r.process_id)
}
