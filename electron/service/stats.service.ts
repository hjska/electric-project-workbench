import { getDb } from '../db/index'

/** P0 仪表盘指标 */
export function dashboardStats() {
  const db = getDb()
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = today.slice(0, 7) + '-01'

  const buildingCount = (db.prepare("SELECT COUNT(*) c FROM project WHERE status = '施工中'").get() as any).c
  const overdueProcess = (db.prepare(`
    SELECT COUNT(*) c FROM process
    WHERE status <> '已完成' AND status <> '已暂停' AND plan_end < ?
  `).get(today) as any).c
  const openIssue = (db.prepare("SELECT COUNT(*) c FROM issue WHERE status <> '已闭环'").get() as any).c
  const monthArrival = (db.prepare(`
    SELECT COUNT(*) c FROM equipment WHERE actual_arrival_date >= ? AND actual_arrival_date IS NOT NULL
  `).get(monthStart) as any).c

  // 各项目进度
  const projectProgress = db.prepare(`
    SELECT p.id, p.code, p.name,
      (SELECT IFNULL(SUM(weight),0) FROM process pr WHERE pr.project_id = p.id AND pr.status <> '已暂停') tw,
      (SELECT IFNULL(SUM(weight * CASE WHEN pr.plan_qty > 0 THEN MIN(pr.done_qty/pr.plan_qty,1)
          WHEN pr.status='已完成' THEN 1 ELSE 0 END),0)
        FROM process pr WHERE pr.project_id = p.id AND pr.status <> '已暂停') dw
    FROM project p
    WHERE p.status IN ('施工中','未开工')
    ORDER BY p.start_date DESC LIMIT 10
  `).all() as any[]

  // 设备到货分布
  const arrivalDist = db.prepare(`
    SELECT arrival_status name, COUNT(*) value FROM equipment GROUP BY arrival_status
  `).all()

  // 近 30 天日报趋势
  const trend = db.prepare(`
    SELECT report_date date, COUNT(*) count, IFNULL(SUM(day_qty),0) qty
    FROM daily_report
    WHERE report_date >= date('now','localtime','-29 day')
    GROUP BY report_date ORDER BY report_date ASC
  `).all()

  // 未闭环问题 Top 5
  const openIssues = db.prepare(`
    SELECT i.id, i.description, i.severity, i.due_date, i.status, p.name AS project_name
    FROM issue i LEFT JOIN project p ON p.id = i.project_id
    WHERE i.status <> '已闭环'
    ORDER BY CASE i.severity WHEN '紧急' THEN 0 WHEN '重要' THEN 1 ELSE 2 END, i.due_date ASC
    LIMIT 5
  `).all()

  return {
    cards: { buildingCount, overdueProcess, openIssue, monthArrival },
    projectProgress: projectProgress.map((r) => ({
      name: r.name,
      code: r.code,
      progress: r.tw > 0 ? Math.round((r.dw / r.tw) * 100) : 0,
    })),
    arrivalDist,
    trend,
    openIssues,
  }
}

/** 单项目汇总（详情页指标） */
export function projectSummary(projectId: number) {
  const db = getDb()
  const today = new Date().toISOString().slice(0, 10)
  const tw = (db.prepare("SELECT IFNULL(SUM(weight),0) v FROM process WHERE project_id = ? AND status <> '已暂停'").get(projectId) as any).v
  const dw = (db.prepare(`SELECT IFNULL(SUM(weight * CASE WHEN plan_qty > 0 THEN MIN(done_qty/plan_qty,1)
      WHEN status='已完成' THEN 1 ELSE 0 END),0) v FROM process WHERE project_id = ? AND status <> '已暂停'`).get(projectId) as any).v
  const eqTotal = (db.prepare('SELECT COUNT(*) c FROM equipment WHERE project_id = ?').get(projectId) as any).c
  const eqArrived = (db.prepare("SELECT COUNT(*) c FROM equipment WHERE project_id = ? AND arrival_status IN ('已到货','部分到货')").get(projectId) as any).c
  const openIssue = (db.prepare("SELECT COUNT(*) c FROM issue WHERE project_id = ? AND status <> '已闭环'").get(projectId) as any).c
  const overdueProcess = (db.prepare("SELECT COUNT(*) c FROM process WHERE project_id = ? AND status <> '已完成' AND status <> '已暂停' AND plan_end < ?").get(projectId, today) as any).c

  return {
    progress: tw > 0 ? Math.round((dw / tw) * 100) : 0,
    equipmentTotal: eqTotal,
    arrivalRate: eqTotal > 0 ? Math.round((eqArrived / eqTotal) * 100) : 0,
    openIssue,
    overdueProcess,
  }
}
