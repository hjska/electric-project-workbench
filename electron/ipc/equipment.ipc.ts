import { ipcMain } from 'electron'
import * as svc from '../service/equipment.service'

export function registerEquipmentIpc() {
  ipcMain.handle('equipment:list', (_e, query) => svc.listEquipment(query))
  ipcMain.handle('equipment:get', (_e, id: number) => svc.getEquipment(id))
  ipcMain.handle('equipment:create', (_e, data) => svc.createEquipment(data))
  ipcMain.handle('equipment:update', (_e, id: number, data) => svc.updateEquipment(id, data))
  ipcMain.handle('equipment:remove', (_e, id: number) => svc.removeEquipment(id))
  ipcMain.handle('equipment:import', (_e, projectId: number, rows: any[]) => svc.importEquipment(projectId, rows))
  ipcMain.handle('equipment:exportRows', (_e, projectId: number) => svc.listAllEquipment(projectId))
}
