import { getDb } from '../db/index'
import { dataPath } from './paths'
import path from 'node:path'
import fs from 'node:fs'
import { closeDatabase, getDatabasePath, initDatabase } from '../db/index'

export interface BackupSettings {
  autoEnabled: boolean
  time: string // 'HH:mm'
  keep: number
}

const DEFAULT_SETTINGS: BackupSettings = { autoEnabled: true, time: '18:00', keep: 30 }

export function getBackupSettings(): BackupSettings {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('backup') as { value: string } | undefined
  if (!row) return { ...DEFAULT_SETTINGS }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveBackupSettings(s: Partial<BackupSettings>): BackupSettings {
  const db = getDb()
  const merged = { ...getBackupSettings(), ...s }
  db.prepare('INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('backup', JSON.stringify(merged))
  return merged
}

function backupsDir() {
  const dir = dataPath('backups')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function backupToDir(targetDir: string) {
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`

  // 关闭连接以保证文件一致（WAL checkpoint 后关闭）
  const dbPath = getDatabasePath()
  closeDatabase()

  const backupSub = path.join(targetDir, `backup_${stamp}`)
  if (!fs.existsSync(backupSub)) fs.mkdirSync(backupSub, { recursive: true })

  fs.copyFileSync(dbPath, path.join(backupSub, 'app.db'))
  // 复制附件目录
  const attachSrc = dataPath('attachments')
  if (fs.existsSync(attachSrc)) {
    copyDir(attachSrc, path.join(backupSub, 'attachments'))
  }

  // 重新初始化数据库连接
  initDatabase()

  return { path: backupSub, stamp }
}

function copyDir(src: string, dest: string) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

/** 保存到默认备份目录，并按 keep 数量清理旧备份 */
export function autoBackup() {
  const settings = getBackupSettings()
  const dir = backupsDir()
  const { path: saved } = backupToDir(dir)
  pruneBackups(dir, settings.keep)
  return saved
}

function pruneBackups(dir: string, keep: number) {
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('backup_'))
    .map((e) => ({ name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  items.slice(keep).forEach((it) => {
    try {
      fs.rmSync(path.join(dir, it.name), { recursive: true, force: true })
    } catch { /* ignore */ }
  })
}

export function listBackups() {
  const dir = backupsDir()
  const settings = getBackupSettings()
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('backup_'))
    .map((e) => {
      const full = path.join(dir, e.name)
      const st = fs.statSync(full)
      let size = 0
      try {
        size = dirSize(full)
      } catch { /* ignore */ }
      return { name: e.name, path: full, size, mtime: st.mtime.toISOString() }
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  return { dir, items, settings, maxKeep: settings.keep }
}

function dirSize(p: string): number {
  let total = 0
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name)
    if (entry.isDirectory()) total += dirSize(full)
    else total += fs.statSync(full).size
  }
  return total
}

/** 从备份目录恢复 */
export function restoreFromBackup(backupPath: string) {
  const dbPath = getDatabasePath()
  const srcDb = path.join(backupPath, 'app.db')
  if (!fs.existsSync(srcDb)) throw new Error('备份中未找到 app.db')

  // 先备份当前数据，防止误操作
  const safety = dataPath(`app_before_restore_${Date.now()}.db`)
  if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, safety)

  closeDatabase()
  fs.copyFileSync(srcDb, dbPath)
  const srcAttach = path.join(backupPath, 'attachments')
  if (fs.existsSync(srcAttach)) {
    const destAttach = dataPath('attachments')
    fs.rmSync(destAttach, { recursive: true, force: true })
    copyDir(srcAttach, destAttach)
  }
  initDatabase()
  return { ok: true, safety }
}

export function deleteBackup(backupPath: string) {
  const dir = backupsDir()
  if (!path.resolve(backupPath).startsWith(path.resolve(dir))) throw new Error('只能删除备份目录内的备份')
  fs.rmSync(backupPath, { recursive: true, force: true })
  return { deleted: true }
}

let timer: NodeJS.Timeout | null = null

/** 每天定时自动备份（每分钟检查一次，命中时间即执行，同日只执行一次） */
export function startAutoBackupJob(_getWindow: () => any) {
  if (timer) clearInterval(timer)
  let lastRunDate = ''
  timer = setInterval(() => {
    try {
      const settings = getBackupSettings()
      if (!settings.autoEnabled) return
      const now = new Date()
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const today = now.toISOString().slice(0, 10)
      if (hhmm === settings.time && lastRunDate !== today) {
        lastRunDate = today
        autoBackup()
      }
    } catch (e) {
      console.error('[auto-backup] failed:', e)
    }
  }, 60 * 1000)
}
