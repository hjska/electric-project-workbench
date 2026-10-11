import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import * as svc from '../service/attachment.service'

export function registerAttachmentIpc() {
  ipcMain.handle('attachment:list', (_e, query) => svc.listAttachments(query))

  ipcMain.handle('attachment:pickAndUpload', async (e, projectId: number, refType: string, refId: number | null, category?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { added: 0, results: [], errors: [] }
    const r = await dialog.showOpenDialog(win, {
      title: '选择要上传的附件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '允许的文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'pdf', 'dwg', 'dxf', 'xls', 'xlsx', 'doc', 'docx'] }],
    })
    if (r.canceled || !r.filePaths.length) return { added: 0, results: [], errors: [] }
    return svc.importFiles(projectId, r.filePaths, { refType, refId, category })
  })

  ipcMain.handle('attachment:update', (_e, id: number, data) => svc.updateAttachment(id, data))
  ipcMain.handle('attachment:remove', (_e, id: number) => svc.removeAttachment(id))

  ipcMain.handle('attachment:open', async (_e, id: number) => {
    const abs = svc.getAttachmentAbsPath(id)
    const err = await shell.openPath(abs)
    return err === '' ? { ok: true } : { ok: false, message: err }
  })

  ipcMain.handle('attachment:reveal', (_e, id: number) => {
    const abs = svc.getAttachmentAbsPath(id)
    shell.showItemInFolder(abs)
    return true
  })

  ipcMain.handle('attachment:exportList', (_e, projectId: number) => svc.listAttachments({ projectId }))
}
