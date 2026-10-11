import { ipcMain } from 'electron'
import * as svc from '../service/report.service'

export function registerReportIpc() {
  ipcMain.handle('report:list', (_e, query) => svc.listReports(query))
  ipcMain.handle('report:create', (_e, data, overwrite?: boolean) => {
    try {
      return svc.createReport(data, overwrite)
    } catch (e: any) {
      return { error: e.message, code: e.code, existingId: e.existingId }
    }
  })
  ipcMain.handle('report:update', (_e, id: number, data) => svc.updateReport(id, data))
  ipcMain.handle('report:remove', (_e, id: number) => svc.removeReport(id))
}
