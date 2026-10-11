import { getDb } from '../db/index'
import { recalcProcess } from './process.service'

export interface ReportRow {
  id?: number
  project_id: number
  process_id: number
  report_date: string
  day_qty: number
  unit?: string
  weather?: string
  worker_count?: number
  recorder?: string
  site_note?: string
}

function validate(d: ReportRow) {
  if (!d.project_id || !d.process_id) throw new Error('必须指定项目与工序')
  if (!d.report_date) throw new Error('日报日期不能为空')
  if (!(Number(d.day_qty) > 0)) throw new Error('当日完成量必须大于 0')
}

export function listReports(q: { projectId?: number; processId?: number; from?: string; to?: string }) {
  const db = getDb()
  const where: string[] = []
  const params: any[] = []
  if (q.projectId) { where.push('r.project_id = ?'); params.push(q.projectId) }
  if (q.processId) { where.push('r.process_id = ?'); params.push(q.processId) }
  if (q.from) { where.push('r.report_date >= ?'); params.push(q.from) }
  if (q.to) { where.push('r.report_date <= ?'); params.push(q.to) }
  return db.prepare(`
    SELECT r.*, p.name AS process_name FROM daily_report r
    LEFT JOIN process p ON p.id = r.process_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.report_date DESC, r.id DESC
  `).all(...params)
}

export function getReport(id: number) {
  const row = getDb().prepare('SELECT * FROM daily_report WHERE id = ?').get(id)
  if (!row) throw new Error('日报不存在')
  return row
}

/** 保存日报：R9 同工序同日唯一；R10 保存后重算累计 */
export function createReport(data: ReportRow, overwrite = false) {
  validate(data)
  const db = getDb()
  const existing = db.prepare('SELECT id FROM daily_report WHERE process_id = ? AND report_date = ?')
    .get(data.process_id, data.report_date) as { id: number } | undefined
  if (existing) {
    if (!overwrite) {
      const err: any = new Error('该工序今日已有日报记录')
      err.code = 'DUPLICATE_REPORT'
      err.existingId = existing.id
      throw err
    }
    return updateReport(existing.id, data)
  }
  const cols = ['project_id', 'process_id', 'report_date', 'day_qty', 'unit', 'weather', 'worker_count', 'recorder', 'site_note']
  const values = cols.map((c) => ((data as any)[c] === undefined ? null : (data as any)[c]))
  const info = db.prepare(`INSERT INTO daily_report (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...values)
  const newId = Number(info.lastInsertRowid)
  // R10：保存后重算工序累计与完成率
  const process = recalcProcess(data.process_id)
  // 回填本条的累计完成量（该工序截至本日报日期的合计）
  syncCumQty(newId, data.process_id)
  return { report: getReport(newId), process }
}

/** 重新计算某工序所有日报的 cum_qty（按日期顺序累加） */
function syncCumQty(_reportId: number, processId: number) {
  const db = getDb()
  const rows = db.prepare(
    'SELECT id, day_qty FROM daily_report WHERE process_id = ? ORDER BY report_date ASC, id ASC',
  ).all(processId) as { id: number; day_qty: number }[]
  const stmt = db.prepare('UPDATE daily_report SET cum_qty = ? WHERE id = ?')
  let acc = 0
  for (const r of rows) {
    acc += Number(r.day_qty) || 0
    stmt.run(acc, r.id)
  }
}

export function updateReport(id: number, data: ReportRow) {
  validate(data)
  const db = getDb()
  const cols = ['process_id', 'report_date', 'day_qty', 'unit', 'weather', 'worker_count', 'recorder', 'site_note']
  const values = cols.map((c) => ((data as any)[c] === undefined ? null : (data as any)[c]))
  db.prepare(`UPDATE daily_report SET ${cols.map((c) => `${c} = ?`).join(', ')},
    updated_at = datetime('now','localtime') WHERE id = ?`).run(...values, id)
  const process = recalcProcess(data.process_id)
  syncCumQty(id, data.process_id)
  return { report: getReport(id), process }
}

export function removeReport(id: number) {
  const db = getDb()
  const row = db.prepare('SELECT process_id FROM daily_report WHERE id = ?').get(id) as { process_id: number } | undefined
  db.prepare('DELETE FROM daily_report WHERE id = ?').run(id)
  if (row) {
    recalcProcess(row.process_id)
    syncCumQty(0, row.process_id)
  }
  return { deleted: true }
}
