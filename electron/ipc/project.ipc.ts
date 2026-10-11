import { ipcMain } from 'electron'
import * as svc from '../service/project.service'
import { projectSummary } from '../service/stats.service'

export function registerProjectIpc() {
  ipcMain.handle('project:list', (_e, query) => svc.listProjects(query ?? {}))
  ipcMain.handle('project:get', (_e, id: number) => ({ ...svc.getProject(id), summary: projectSummary(id) }))
  ipcMain.handle('project:create', (_e, data) => svc.createProject(data))
  ipcMain.handle('project:update', (_e, id: number, data) => svc.updateProject(id, data))
  ipcMain.handle('project:remove', (_e, id: number) => svc.removeProject(id))
  ipcMain.handle('project:options', () => svc.projectOptions())
}
