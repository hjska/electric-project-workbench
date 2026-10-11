import { ipcMain } from 'electron'
import * as svc from '../service/milestone.service'

export function registerMilestoneIpc() {
  ipcMain.handle('milestone:list', (_e, projectId: number) => svc.listMilestones(projectId))
  ipcMain.handle('milestone:create', (_e, data) => svc.createMilestone(data))
  ipcMain.handle('milestone:update', (_e, id: number, data) => svc.updateMilestone(id, data))
  ipcMain.handle('milestone:remove', (_e, id: number) => svc.removeMilestone(id))
  ipcMain.handle('milestone:processIds', (_e, id: number) => svc.getMilestoneProcessIds(id))
}
