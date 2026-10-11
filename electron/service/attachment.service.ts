import { getDb } from '../db/index'
import { getDataRoot, dataPath } from './paths'
import path from 'node:path'
import fs from 'node:fs'

const EXT_WHITELIST = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'pdf', 'dwg', 'dxf', 'xls', 'xlsx', 'doc', 'docx']
const MAX_SIZE = 50 * 1024 * 1024 // 50MB

function attachmentsRoot() {
  const dir = dataPath('attachments')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function guessCategory(ext: string) {
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return '照片'
  if (['dwg', 'dxf', 'pdf'].includes(ext)) return '图纸'
  if (['xls', 'xlsx', 'doc', 'docx'].includes(ext)) return '文档'
  return '其他'
}

export function listAttachments(q: { projectId: number; refType?: string; refId?: number; category?: string }) {
  const db = getDb()
  const where: string[] = ['project_id = ?']
  const params: any[] = [q.projectId]
  if (q.refType) { where.push('ref_type = ?'); params.push(q.refType) }
  if (q.refId !== undefined && q.refId !== null) { where.push('ref_id = ?'); params.push(q.refId) }
  if (q.category) { where.push('category = ?'); params.push(q.category) }
  const dbRoot = attachmentsRoot()
  return (db.prepare(`SELECT * FROM attachment WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC`).all(...params) as any[])
    .map((r) => ({ ...r, abs_path: dataPath(r.rel_path) }))
}

/** 从一堆原始文件路径登记附件（R17~R19） */
export function importFiles(projectId: number, filePaths: string[], opts: { refType: string; refId?: number | null; category?: string; description?: string }) {
  const db = getDb()
  const dir = path.join(attachmentsRoot(), String(projectId))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const results: any[] = []
  const errors: { file: string; message: string }[] = []

  for (const src of filePaths) {
    try {
      const stat = fs.statSync(src)
      const ext = path.extname(src).slice(1).toLowerCase()
      const name = path.basename(src)

      if (stat.size > MAX_SIZE) throw new Error(`文件超过 50MB 限制`)
      if (!EXT_WHITELIST.includes(ext)) throw new Error(`不支持的文件类型 .${ext}`)

      const uuid = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      const fileName = `${uuid}.${ext}`
      const dest = path.join(dir, fileName)
      fs.copyFileSync(src, dest)

      const relPath = path.relative(getDataRoot(), dest).split(path.sep).join('/')
      const info = db.prepare(`INSERT INTO attachment
        (project_id, ref_type, ref_id, file_name, rel_path, file_ext, file_size, category, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        projectId, opts.refType, opts.refId ?? null, name, relPath, ext, stat.size,
        opts.category || guessCategory(ext), opts.description ?? null,
      )
      results.push(db.prepare('SELECT * FROM attachment WHERE id = ?').get(Number(info.lastInsertRowid)))
    } catch (e: any) {
      errors.push({ file: path.basename(src), message: e.message })
    }
  }
  return { added: results.length, results, errors }
}

export function updateAttachment(id: number, data: { description?: string; category?: string }) {
  const db = getDb()
  db.prepare('UPDATE attachment SET description = COALESCE(?, description), category = COALESCE(?, category) WHERE id = ?')
    .run(data.description ?? null, data.category ?? null, id)
  return db.prepare('SELECT * FROM attachment WHERE id = ?').get(id)
}

/** R20 删除记录同时删物理文件 */
export function removeAttachment(id: number) {
  const db = getDb()
  const row = db.prepare('SELECT rel_path FROM attachment WHERE id = ?').get(id) as { rel_path: string } | undefined
  if (row) {
    const abs = dataPath(row.rel_path)
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs)
    } catch { /* 文件可能已被手动删除，忽略 */ }
  }
  db.prepare('DELETE FROM attachment WHERE id = ?').run(id)
  return { deleted: true }
}

export function getAttachmentAbsPath(id: number) {
  const row = getDb().prepare('SELECT rel_path FROM attachment WHERE id = ?').get(id) as { rel_path: string } | undefined
  if (!row) throw new Error('附件不存在')
  return dataPath(row.rel_path)
}
