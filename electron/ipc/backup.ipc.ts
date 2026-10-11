import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as svc from '../service/backup.service'

export function registerBackupIpc() {
  ipcMain.handle('backup:settings', () => svc.getBackupSettings())
  ipcMain.handle('backup:saveSettings', (_e, s) => svc.saveBackupSettings(s))

  ipcMain.handle('backup:runNow', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { canceled: true }
    const r = await dialog.showOpenDialog(win, {
      title: '选择备份保存位置',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths.length) return { canceled: true }
    const res = svc.backupToDir(r.filePaths[0])
    return { canceled: false, ...res }
  })

  ipcMain.handle('backup:listBackups', () => svc.listBackups())

  ipcMain.handle('backup:restore', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { canceled: true }
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['取消', '确认恢复'],
      defaultId: 0,
      cancelId: 0,
      title: '恢复数据',
      message: '当前数据将被备份内容覆盖，确定继续？',
      detail: '恢复前会自动保存一份当前数据库副本，用于回退。',
    })
    if (r.response !== 1) return { canceled: true }
    const pick = await dialog.showOpenDialog(win, {
      title: '选择备份目录',
      properties: ['openDirectory'],
    })
    if (pick.canceled || !pick.filePaths.length) return { canceled: true }
    const res = svc.restoreFromBackup(pick.filePaths[0])
    return { canceled: false, ...res }
  })

  ipcMain.handle('backup:deleteBackup', (_e, file: string) => svc.deleteBackup(file))
}

export function startAutoBackupJob(getWindow: () => BrowserWindow | null) {
  svc.startAutoBackupJob(getWindow)
}
