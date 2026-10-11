import { ipcMain } from 'electron'
import * as svc from '../service/folder.service'

export function registerFolderIpc() {
  ipcMain.handle('folder:setting', () => svc.getFolderSetting())
  ipcMain.handle('folder:saveSetting', (_e, patch) => svc.saveFolderSetting(patch ?? {}))
  ipcMain.handle('folder:defaultTree', () => svc.DEFAULT_FOLDER_TREE)

  ipcMain.handle('folder:info', (_e, projectId: number) => svc.getProjectFolder(projectId))
  ipcMain.handle('folder:ensure', (_e, projectId: number) => svc.getProjectFolder(projectId, { createIfMissing: true }))
  ipcMain.handle('folder:browse', (_e, projectId: number, relPath: string) => svc.browseProjectFolder(projectId, relPath ?? ''))
  ipcMain.handle('folder:open', (_e, projectId: number, relPath?: string) => svc.openProjectFolderPath(projectId, relPath ?? ''))
  ipcMain.handle('folder:reveal', (_e, projectId: number, relPath?: string) => svc.revealProjectFolderPath(projectId, relPath ?? ''))
  ipcMain.handle('folder:mkdir', (_e, projectId: number, relPath: string, name: string) =>
    svc.createSubFolder(projectId, relPath ?? '', name),
  )

  // 直接放在文件夹里的资料：实时识别 + 改动时间
  ipcMain.handle('folder:recentChanges', (_e, projectId: number, opts?: any) =>
    svc.listRecentChanges(projectId, opts ?? {}),
  )
  ipcMain.handle('folder:stats', (_e, projectId: number) => svc.getFolderStats(projectId))
  ipcMain.handle('folder:watch', (_e, projectId: number) => svc.watchProjectFolder(projectId))
  ipcMain.handle('folder:unwatch', (_e, projectId: number) => svc.unwatchProjectFolder(projectId))

  ipcMain.handle('folder:openRoot', () => svc.openRootFolder())
  ipcMain.handle('folder:ensureAll', () => svc.ensureAllProjectFolders())
}
