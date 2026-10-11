import { dialog, BrowserWindow } from 'electron'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

/** 弹出保存对话框并写 xlsx（R15 文件名规则由调用方给出 baseName） */
export async function saveSheets(
  sender: Electron.WebContents,
  baseName: string,
  sheets: { name: string; rows: any[] }[],
) {
  const win = BrowserWindow.fromWebContents(sender)
  if (!win) return { canceled: true }
  const r = await dialog.showSaveDialog(win, {
    title: '导出 Excel',
    defaultPath: baseName,
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  })
  if (r.canceled || !r.filePath) return { canceled: true }

  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{ 提示: '暂无数据' }])
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31))
  }
  XLSX.writeFile(wb, r.filePath)
  return { canceled: false, path: r.filePath }
}

export function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}
