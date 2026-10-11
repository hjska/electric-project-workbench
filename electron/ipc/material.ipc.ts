import { ipcMain } from 'electron'
import * as svc from '../service/material.service'
import { createEquipment, updateEquipment, removeEquipment } from '../service/equipment.service'

/**
 * 总物料管理：跨项目的物料总表、汇总分析、到货监控与批量改状态。
 * 写操作复用设备服务，保证与项目内「设备清单」页签走同一套校验。
 */
export function registerMaterialIpc() {
  ipcMain.handle('material:list', (_e, q) => svc.listMaterials(q ?? {}))
  ipcMain.handle('material:stats', (_e, q) => svc.materialStats(q ?? {}))
  ipcMain.handle('material:groupByProject', (_e, q) => svc.groupByProject(q ?? {}))
  ipcMain.handle('material:groupBySupplier', (_e, q) => svc.groupBySupplier(q ?? {}))
  ipcMain.handle('material:facets', (_e, q) => svc.materialFacets(q ?? {}))
  ipcMain.handle('material:batchStatus', (_e, ids: number[], patch: any) => svc.batchUpdateStatus(ids, patch))
  ipcMain.handle('material:removeMany', (_e, ids: number[]) => svc.removeMany(ids))
  ipcMain.handle('material:create', (_e, data) => createEquipment(data))
  ipcMain.handle('material:update', (_e, id: number, data) => updateEquipment(id, data))
  ipcMain.handle('material:remove', (_e, id: number) => removeEquipment(id))
}
