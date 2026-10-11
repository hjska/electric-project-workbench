import { ipcMain } from 'electron'
import * as svc from '../service/issue.service'

export function registerIssueIpc() {
  ipcMain.handle('issue:list', (_e, query) => svc.listIssues(query))
  ipcMain.handle('issue:create', (_e, data) => svc.createIssue(data))
  ipcMain.handle('issue:update', (_e, id: number, data) => svc.updateIssue(id, data))
  ipcMain.handle('issue:remove', (_e, id: number) => svc.removeIssue(id))
}
