import { ipcMain } from 'electron'
import * as svc from '../service/stats.service'

export function registerStatsIpc() {
  ipcMain.handle('stats:dashboard', () => svc.dashboardStats())
  ipcMain.handle('stats:projectSummary', (_e, projectId: number) => svc.projectSummary(projectId))
}
