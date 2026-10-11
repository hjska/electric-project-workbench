import { ipcMain } from 'electron'
import * as svc from '../service/process.service'

export function registerProcessIpc() {
  ipcMain.handle('process:list', (_e, projectId: number) => svc.listProcess(projectId))
  ipcMain.handle('process:create', (_e, data) => svc.createProcess(data))
  ipcMain.handle('process:update', (_e, id: number, data) => svc.updateProcess(id, data))
  ipcMain.handle('process:remove', (_e, id: number) => svc.removeProcess(id))
  ipcMain.handle('process:reorder', (_e, items) => svc.reorderProcess(items))
}
