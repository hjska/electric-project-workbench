import fs from 'node:fs'
import path from 'node:path'
import { app, shell, BrowserWindow } from 'electron'
import { getDb } from '../db/index'

/**
 * 工程资料文件夹。
 *
 * 设计意图：项目台账里除「软件内登记的数据」外，还有大量图纸 / PLC 程序 /
 * 说明书 / 试验报告等**以文件形式存在**的资料。这些不适合塞进 SQLite，
 * 也不适合放在 %APPDATA% 那种隐藏目录里 —— 用户要能随手打开、直接往里丢文件。
 *
 * 因此：每个项目在「资料根目录」下拥有一个独立文件夹（两级分类结构），
 * 路径记录在 project.folder_path。软件不做文件托管，只负责建目录、打开目录、
 * 浏览目录 —— 增删改文件仍由用户在资源管理器里自由进行。
 */

export interface FolderNode {
  name: string
  children?: string[]
}

export interface FolderSetting {
  root: string
  tree: FolderNode[]
  createReadme: boolean
}

/** 两级分类结构：一级用数字前缀保证排序，二级按电气工程资料类型细分 */
export const DEFAULT_FOLDER_TREE: FolderNode[] = [
  { name: '01-图纸', children: ['设计图纸', '变更图纸', '竣工图纸'] },
  { name: '02-程序', children: ['PLC程序', '触摸屏组态', '变频器与仪表参数'] },
  { name: '03-设备资料', children: ['设备清单', '说明书与样本', '合格证与检测报告'] },
  { name: '04-施工资料', children: ['施工方案与技术交底', '现场照片', '隐蔽工程记录'] },
  { name: '05-验收竣工', children: ['试验报告', '验收单', '竣工资料'] },
  { name: '06-往来文件', children: ['收文', '发文'] },
  { name: '99-其他', children: [] },
]

const README_NAME = '_资料说明.txt'
const SETTING_KEY = 'project_folder'
const MAX_NAME_LEN = 70

// ---------------------------------------------------------------- 设置读写

/** 默认根目录：优先 D 盘（资料与系统盘分离），否则退回「文档」 */
function defaultRoot(): string {
  try {
    if (process.platform === 'win32' && fs.existsSync('D:\\')) return 'D:\\电气项目资料'
  } catch { /* ignore */ }
  try {
    return path.join(app.getPath('documents'), '电气项目资料')
  } catch {
    return path.join(process.cwd(), '电气项目资料')
  }
}

function normalizeTree(input: any): FolderNode[] | null {
  if (!Array.isArray(input) || input.length === 0) return null
  const out: FolderNode[] = []
  for (const node of input) {
    if (!node || typeof node.name !== 'string' || !node.name.trim()) return null
    const children = Array.isArray(node.children)
      ? node.children.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim())
      : []
    out.push({ name: node.name.trim(), children })
  }
  return out.length ? out : null
}

export function getFolderSetting(): FolderSetting {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING_KEY) as { value: string } | undefined
  let parsed: any = {}
  if (row?.value) {
    try { parsed = JSON.parse(row.value) } catch { /* 配置损坏则回退默认 */ }
  }
  // 环境变量优先级最高：供自动化测试与便携部署重定向资料目录，
  // 避免测试脚本把目录建到用户真实的资料盘上。
  const envRoot = process.env.PROJECT_FOLDER_ROOT?.trim()
  return {
    root: envRoot || (typeof parsed.root === 'string' && parsed.root.trim() ? parsed.root.trim() : defaultRoot()),
    tree: normalizeTree(parsed.tree) ?? DEFAULT_FOLDER_TREE,
    createReadme: parsed.createReadme !== false,
  }
}

export function saveFolderSetting(patch: Partial<FolderSetting>): FolderSetting {
  const db = getDb()
  const cur = getFolderSetting()
  const next: FolderSetting = {
    root: typeof patch.root === 'string' && patch.root.trim() ? patch.root.trim() : cur.root,
    tree: patch.tree === undefined ? cur.tree : (normalizeTree(patch.tree) ?? cur.tree),
    createReadme: patch.createReadme === undefined ? cur.createReadme : !!patch.createReadme,
  }
  db.prepare('INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SETTING_KEY, JSON.stringify(next))
  return next
}

// ---------------------------------------------------------------- 命名

/** 清洗单个目录名：去掉 Windows 非法字符，避免结尾点/空格，规避保留设备名 */
export function sanitizeSegment(raw: string): string {
  let s = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!s) s = '未命名'
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(s)) s = `_${s}`
  return s
}

/** 项目文件夹名：`编号_名称`。编号在前，便于按工程编号排序查找 */
export function projectFolderName(p: { code: string; name: string }): string {
  const raw = `${sanitizeSegment(p.code)}_${sanitizeSegment(p.name)}`
  return raw.length > MAX_NAME_LEN ? raw.slice(0, MAX_NAME_LEN).replace(/[. ]+$/, '') : raw
}

// ---------------------------------------------------------------- 创建

function writeReadme(dir: string, tree: FolderNode[], project: { code: string; name: string }): void {
  const file = path.join(dir, README_NAME)
  // 已存在说明用户可能改过，不再覆盖
  if (fs.existsSync(file)) return
  const lines: string[] = [
    `项目：${project.code}  ${project.name}`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '本文件夹由「电气项目管理台」自动创建，用于存放本工程的图纸、程序及各类资料。',
    '可以直接把文件放进来，也可以自行增删子文件夹，软件不做任何限制。',
    '',
    '建议存放位置：',
  ]
  for (const n of tree) {
    lines.push(`  ${n.name}/`)
    for (const c of n.children ?? []) lines.push(`      ${c}/`)
  }
  lines.push('')
  lines.push('（本说明文件可随意删除）')
  // 带 BOM 的 UTF-8，保证记事本等老工具打开不乱码
  fs.writeFileSync(file, '\ufeff' + lines.join('\r\n'), 'utf8')
}

/** 建立目录树，并把绝对路径写回 project.folder_path */
export function ensureProjectFolder(project: { id: number; code: string; name: string }): string {
  const s = getFolderSetting()
  fs.mkdirSync(s.root, { recursive: true })

  const dir = path.join(s.root, projectFolderName(project))
  fs.mkdirSync(dir, { recursive: true })

  for (const node of s.tree) {
    const first = path.join(dir, node.name)
    fs.mkdirSync(first, { recursive: true })
    for (const child of node.children ?? []) {
      fs.mkdirSync(path.join(first, child), { recursive: true })
    }
  }

  if (s.createReadme) {
    try { writeReadme(dir, s.tree, project) } catch { /* 说明文件写不了不影响主流程 */ }
  }

  getDb().prepare('UPDATE project SET folder_path = ? WHERE id = ?').run(dir, project.id)
  clearFolderCache()
  return dir
}

// ---------------------------------------------------------------- 查询

export interface ProjectFolderInfo {
  path: string | null
  exists: boolean
  root: string
  recreated: boolean
}

/**
 * 取项目资料文件夹。
 * folder_path 存在但磁盘上没了（用户挪走/删了）时清空记录，按需在根目录重建。
 */
export function getProjectFolder(id: number, opts: { createIfMissing?: boolean } = {}): ProjectFolderInfo {
  const db = getDb()
  const row = db.prepare('SELECT id, code, name, folder_path FROM project WHERE id = ?')
    .get(id) as { id: number; code: string; name: string; folder_path: string | null } | undefined
  if (!row) throw new Error('项目不存在')

  const root = getFolderSetting().root

  if (row.folder_path && fs.existsSync(row.folder_path)) {
    return { path: row.folder_path, exists: true, root, recreated: false }
  }

  // 路径失效：清掉旧记录，避免一直指向不存在的目录
  if (row.folder_path) db.prepare('UPDATE project SET folder_path = NULL WHERE id = ?').run(id)

  if (opts.createIfMissing) {
    const p = ensureProjectFolder({ id: row.id, code: row.code, name: row.name })
    return { path: p, exists: true, root, recreated: !!row.folder_path }
  }
  return { path: null, exists: false, root, recreated: false }
}

/** 把 relativ 拼到 base 之下，并拒绝一切越界路径 */
function resolveInside(base: string, rel: string): string {
  const b = path.resolve(base)
  const t = path.resolve(b, rel || '.')
  const diff = path.relative(b, t)
  if (diff.startsWith('..') || path.isAbsolute(diff)) throw new Error('路径越界，已拒绝访问')
  return t
}

// ---------------------------------------------------------------- 磁盘扫描
//
// 用户是**直接在资源管理器里**把图纸 / 程序 / 照片丢进这些文件夹的，
// 软件不托管文件，因此「里面有多少东西、最近什么时候动过」只能实时扫盘得出。

/** 扫描上限：防止用户塞进几十万个文件时把界面卡死 */
const SCAN_MAX_FILES = 20000
const SCAN_MAX_DEPTH = 8
const SCAN_TTL = 4000

export interface ScanSummary {
  /** 文件总数（含所有层级） */
  files: number
  /** 子目录总数 */
  dirs: number
  /** 占用空间（字节） */
  size: number
  /** 子树内最近一次改动时间（毫秒，0 表示无文件） */
  latestMtimeMs: number
  /** 最近改动的文件名 */
  latestName: string
  /** 最近改动文件的相对路径（相对项目文件夹） */
  latestRelPath: string
  /** 是否因超出上限而提前结束 */
  truncated: boolean
}

function emptyScan(): ScanSummary {
  return { files: 0, dirs: 0, size: 0, latestMtimeMs: 0, latestName: '', latestRelPath: '', truncated: false }
}

/** 递归汇总目录内容，把每个文件都计入（文件明细由 walkFiles 负责收集） */
function scanDir(base: string, dir: string, depth: number, acc: ScanSummary): void {
  if (acc.truncated) return
  if (depth > SCAN_MAX_DEPTH) { acc.truncated = true; return }
  let items: fs.Dirent[]
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch { return } // 权限不足或目录刚被移走
  for (const d of items) {
    if (acc.files >= SCAN_MAX_FILES) { acc.truncated = true; return }
    const full = path.join(dir, d.name)
    if (d.isDirectory()) {
      acc.dirs++
      scanDir(base, full, depth + 1, acc)
    } else if (d.isFile()) {
      acc.files++
      try {
        const st = fs.statSync(full)
        acc.size += st.size
        if (st.mtimeMs > acc.latestMtimeMs) {
          acc.latestMtimeMs = st.mtimeMs
          acc.latestName = d.name
          acc.latestRelPath = path.relative(base, full).split(path.sep).join('/')
        }
      } catch { /* 竞态，忽略 */ }
    }
  }
}

// 目录汇总缓存：Windows 下**子文件的改动不会刷新父目录的 mtime**，
// 因此无法用 mtime 做失效判断，只能靠短 TTL + 变更事件主动清空。
const scanCache = new Map<string, { at: number; value: ScanSummary }>()

function scanCached(base: string, dir: string): ScanSummary {
  const now = Date.now()
  const hit = scanCache.get(dir)
  if (hit && now - hit.at < SCAN_TTL) return hit.value
  const acc = emptyScan()
  scanDir(base, dir, 0, acc)
  if (scanCache.size > 400) scanCache.clear()
  scanCache.set(dir, { at: now, value: acc })
  return acc
}

/** 文件明细（供「最近改动」使用），同样带上限保护 */
function walkFiles(
  base: string,
  dir: string,
  depth: number,
  out: FolderFileItem[],
  limit: number,
): boolean {
  if (out.length >= limit) return true
  if (depth > SCAN_MAX_DEPTH) return true
  let items: fs.Dirent[]
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch { return false }
  let truncated = false
  for (const d of items) {
    if (out.length >= limit) return true
    const full = path.join(dir, d.name)
    if (d.isDirectory()) {
      if (walkFiles(base, full, depth + 1, out, limit)) truncated = true
    } else if (d.isFile()) {
      try {
        const st = fs.statSync(full)
        const rel = path.relative(base, full).split(path.sep).join('/')
        out.push({
          name: d.name,
          relPath: rel,
          size: st.size,
          mtimeMs: st.mtimeMs,
          birthtimeMs: st.birthtimeMs || st.ctimeMs,
          ext: path.extname(d.name).slice(1).toLowerCase(),
          topCategory: rel.includes('/') ? rel.split('/')[0] : '(根目录)',
        })
      } catch { /* ignore */ }
    }
  }
  return truncated
}

// ---------------------------------------------------------------- 浏览

export interface FolderEntry {
  name: string
  isDir: boolean
  size: number
  /** 修改时间（ISO 字符串，磁盘实时读取，用户外部改动也会反映出来） */
  mtime: string
  /** 修改时间（毫秒时间戳，供排序用） */
  mtimeMs: number
  /** 创建时间（毫秒时间戳，取不到时退化为状态变更时间） */
  ctimeMs: number
  /** 距今多少天，前端用于高亮「最近改动」 */
  ageDays?: number
  ext: string
  /** ↓ 仅目录：子树内文件总数 */
  childCount?: number
  /** ↓ 仅目录：子树内最近改动时间（毫秒） */
  latestMtimeMs?: number
  /** ↓ 仅目录：子树内最近改动的文件名 */
  latestName?: string
  /** ↓ 仅目录：子树占用空间 */
  treeSize?: number
  /** ↓ 仅目录：统计是否被上限截断 */
  truncated?: boolean
}

export function browseProjectFolder(id: number, relPath = '') {
  const info = getProjectFolder(id, { createIfMissing: true })
  const base = info.path!
  const target = resolveInside(base, relPath)
  if (!fs.existsSync(target)) throw new Error('目录不存在')
  if (!fs.statSync(target).isDirectory()) throw new Error('目标不是目录')

  const now = Date.now()
  const entries: FolderEntry[] = fs.readdirSync(target, { withFileTypes: true }).map((d) => {
    const full = path.join(target, d.name)
    const isDir = d.isDirectory()
    let size = 0
    let mtimeMs = 0
    let ctimeMs = 0
    try {
      const st = fs.statSync(full)
      size = st.size
      mtimeMs = st.mtimeMs
      ctimeMs = st.birthtimeMs || st.ctimeMs
    } catch { /* 权限或竞态，忽略 */ }
    const e: FolderEntry = {
      name: d.name,
      isDir,
      size,
      mtime: mtimeMs ? new Date(mtimeMs).toISOString() : '',
      mtimeMs,
      ctimeMs,
      ageDays: mtimeMs ? Math.floor((now - mtimeMs) / 86400000) : undefined,
      ext: isDir ? '' : path.extname(d.name).slice(1).toLowerCase(),
    }
    if (isDir) {
      // 目录自己不显示大小，改显示「里面有几个文件、最后一次什么时候动过」，
      // 这样不用点进去也能看出哪个分类有新资料。
      const s = scanCached(base, full)
      e.childCount = s.files
      e.latestMtimeMs = s.latestMtimeMs
      e.latestName = s.latestName
      e.treeSize = s.size
      e.truncated = s.truncated
    }
    return e
  })

  // 目录在前，接着按名称排序（numeric 让 01/02/10 顺序正确）
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  })

  const rel = path.relative(base, target).split(path.sep).join('/')
  const summary = scanCached(base, target)
  return { base, relPath: rel, absPath: target, entries, summary }
}

// ---------------------------------------------------------------- 打开 / 定位

export async function openProjectFolderPath(id: number, relPath = '') {
  const info = getProjectFolder(id, { createIfMissing: true })
  const target = resolveInside(info.path!, relPath)
  if (!fs.existsSync(target)) throw new Error('文件或目录不存在')
  const err = await shell.openPath(target)
  return err === '' ? { ok: true, path: target } : { ok: false, message: err, path: target }
}

export function revealProjectFolderPath(id: number, relPath = '') {
  const info = getProjectFolder(id, { createIfMissing: true })
  const target = resolveInside(info.path!, relPath)
  if (!fs.existsSync(target)) throw new Error('文件或目录不存在')
  // 目录直接打开；文件则在资源管理器中选中
  if (fs.statSync(target).isDirectory()) shell.openPath(target)
  else shell.showItemInFolder(target)
  return { ok: true, path: target }
}

export async function openRootFolder() {
  const root = getFolderSetting().root
  try { fs.mkdirSync(root, { recursive: true }) } catch { /* ignore */ }
  const err = await shell.openPath(root)
  return err === '' ? { ok: true, path: root } : { ok: false, message: err, path: root }
}

// ---------------------------------------------------------------- 维护操作

export function createSubFolder(id: number, relPath: string, name: string) {
  const info = getProjectFolder(id, { createIfMissing: true })
  const parent = resolveInside(info.path!, relPath)
  if (!fs.existsSync(parent)) throw new Error('上级目录不存在')
  const safe = sanitizeSegment(name)
  const dir = path.join(parent, safe)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  clearFolderCache()
  return { name: safe, relPath: path.relative(info.path!, dir).split(path.sep).join('/') }
}

/** 项目编号/名称变更后，同步重命名文件夹（仅当文件夹仍是自动命名时） */
export function syncFolderOnRename(
  before: { code: string; name: string; folder_path?: string | null },
  after: { id: number; code: string; name: string; folder_path?: string | null },
): string | null {
  const cur = after.folder_path
  if (!cur) return null
  if (before.code === after.code && before.name === after.name) return null
  if (!fs.existsSync(cur)) return null

  // 只有「当前路径恰好等于按旧名自动生成的结果」才认为可安全重命名，
  // 否则说明用户自己改过目录名，不要多管闲事。
  const autoOld = path.join(path.dirname(cur), projectFolderName(before))
  if (path.resolve(autoOld) !== path.resolve(cur)) return null

  const next = path.join(path.dirname(cur), projectFolderName(after))
  if (path.resolve(next) === path.resolve(cur)) return null
  if (fs.existsSync(next)) return null // 目标已占用，宁可不动也不能合并

  fs.renameSync(cur, next)
  getDb().prepare('UPDATE project SET folder_path = ? WHERE id = ?').run(next, after.id)
  // 目录已经换位置，旧的监视句柄失效，重新挂到新路径
  rewatchMovedFolder(after.id, next)
  clearFolderCache()
  return next
}

/** 为所有项目校验/补建资料文件夹（存量项目升级用） */
export function ensureAllProjectFolders() {
  const db = getDb()
  const rows = db.prepare('SELECT id, code, name, folder_path FROM project ORDER BY id').all() as {
    id: number; code: string; name: string; folder_path: string | null
  }[]
  const created: string[] = []
  const skipped: string[] = []
  const failed: { code: string; message: string }[] = []

  for (const r of rows) {
    try {
      if (r.folder_path && fs.existsSync(r.folder_path)) {
        // 目录还在，但子目录结构可能是旧模板生成的 —— 补建缺失项
        ensureProjectFolder({ id: r.id, code: r.code, name: r.name })
        skipped.push(r.code)
      } else {
        created.push(ensureProjectFolder({ id: r.id, code: r.code, name: r.name }))
      }
    } catch (e: any) {
      failed.push({ code: r.code, message: e?.message || String(e) })
    }
  }
  return { total: rows.length, createdCount: created.length, skippedCount: skipped.length, created, failed }
}

// ---------------------------------------------------------------- 最近改动

/** 处于「新」状态的天数阈值，前端据此打标签 */
export const NEW_WITHIN_DAYS = 7

export interface FolderFileItem {
  name: string
  /** 相对项目文件夹的路径，用 / 分隔 */
  relPath: string
  size: number
  mtimeMs: number
  birthtimeMs: number
  ext: string
  /** 所属一级分类（01-图纸 / 02-程序 …）；直接放在根目录的文件归为「(根目录)」 */
  topCategory: string
}

/**
 * 整个项目的「最近改动」清单。
 *
 * 解决的实际问题：用户不走软件上传，而是直接在资源管理器里把图纸 / 程序
 * 丢进对应文件夹；过几天回来就忘了东西放哪了。这里按改动时间倒序一屏看完，
 * 一眼能看出「昨天新放进去的报告在 05-验收竣工/试验报告 里」。
 */
export function listRecentChanges(id: number, opts: { limit?: number; days?: number } = {}) {
  const info = getProjectFolder(id, { createIfMissing: true })
  const base = info.path!
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 500)

  const files: FolderFileItem[] = []
  const truncated = walkFiles(base, base, 0, files, SCAN_MAX_FILES)

  const now = Date.now()
  let items = files
  if (opts.days && opts.days > 0) {
    const cutoff = now - opts.days * 86400000
    items = items.filter((f) => f.mtimeMs >= cutoff)
  }

  return {
    base,
    /** 扫描到的文件总数 */
    scanned: files.length,
    truncated,
    newDays: NEW_WITHIN_DAYS,
    items: items
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
      .map((f) => ({
        ...f,
        mtime: new Date(f.mtimeMs).toISOString(),
        ctime: f.birthtimeMs ? new Date(f.birthtimeMs).toISOString() : '',
        ageDays: Math.floor((now - f.mtimeMs) / 86400000),
        isNew: now - f.mtimeMs <= NEW_WITHIN_DAYS * 86400000,
      })),
  }
}

// ---------------------------------------------------------------- 资料概览

export interface FolderCategoryStat {
  name: string
  fileCount: number
  size: number
  latestMtimeMs: number
  latestName: string
}

export interface FolderStats {
  path: string | null
  exists: boolean
  root: string
  fileCount: number
  dirCount: number
  totalSize: number
  latestMtimeMs: number
  latestName: string
  latestRelPath: string
  /** 最近 N 天内有改动的文件数 */
  recentCount: number
  newDays: number
  categories: FolderCategoryStat[]
  truncated: boolean
}

const statsCache = new Map<string, { at: number; value: FolderStats }>()

/** 项目资料总览：文件数 / 占用空间 / 最近改动 / 各分类明细，供详情页头部展示 */
export function getFolderStats(id: number): FolderStats {
  const root = getFolderSetting().root
  const info = getProjectFolder(id, { createIfMissing: false })
  const base = info.exists ? info.path! : null

  const empty: FolderStats = {
    path: info.path, exists: false, root, fileCount: 0, dirCount: 0, totalSize: 0,
    latestMtimeMs: 0, latestName: '', latestRelPath: '', recentCount: 0,
    newDays: NEW_WITHIN_DAYS, categories: [], truncated: false,
  }
  if (!base) return empty

  const cached = statsCache.get(base)
  if (cached && Date.now() - cached.at < SCAN_TTL) return cached.value

  const files: FolderFileItem[] = []
  const truncated = walkFiles(base, base, 0, files, SCAN_MAX_FILES)
  const cutoff = Date.now() - NEW_WITHIN_DAYS * 86400000

  const byCat = new Map<string, FolderCategoryStat>()
  let totalSize = 0
  let latestMtimeMs = 0
  let latestName = ''
  let latestRelPath = ''
  let recentCount = 0

  for (const f of files) {
    totalSize += f.size
    if (f.mtimeMs >= cutoff) recentCount++
    if (f.mtimeMs > latestMtimeMs) {
      latestMtimeMs = f.mtimeMs
      latestName = f.name
      latestRelPath = f.relPath
    }
    let c = byCat.get(f.topCategory)
    if (!c) {
      c = { name: f.topCategory, fileCount: 0, size: 0, latestMtimeMs: 0, latestName: '' }
      byCat.set(f.topCategory, c)
    }
    c.fileCount++
    c.size += f.size
    if (f.mtimeMs > c.latestMtimeMs) { c.latestMtimeMs = f.mtimeMs; c.latestName = f.name }
  }

  // 空的一级分类也要列出来，用户才知道「这块还没放东西」
  try {
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory() && !byCat.has(d.name)) {
        byCat.set(d.name, { name: d.name, fileCount: 0, size: 0, latestMtimeMs: 0, latestName: '' })
      }
    }
  } catch { /* ignore */ }

  const categories = [...byCat.values()].sort((a, b) => {
    // 根目录散落文件排最后，其余按名称自然序
    const aStray = a.name.startsWith('(')
    const bStray = b.name.startsWith('(')
    if (aStray !== bStray) return aStray ? 1 : -1
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  })

  const value: FolderStats = {
    path: base,
    exists: true,
    root,
    fileCount: files.length,
    dirCount: scanCached(base, base).dirs,
    totalSize,
    latestMtimeMs,
    latestName,
    latestRelPath,
    recentCount,
    newDays: NEW_WITHIN_DAYS,
    categories,
    truncated,
  }
  if (statsCache.size > 60) statsCache.clear()
  statsCache.set(base, { at: Date.now(), value })
  return value
}

// ---------------------------------------------------------------- 实时监听

interface WatcherEntry {
  watcher: fs.FSWatcher | null
  timer: NodeJS.Timeout | null
  refs: number
  dir: string
  changes: number
}

const watchers = new Map<number, WatcherEntry>()

/** 主动清空扫描缓存：磁盘变了，之前的统计立刻作废 */
export function clearFolderCache(): void {
  scanCache.clear()
  statsCache.clear()
}

function emitFolderChanged(projectId: number, payload: Record<string, any>): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('folder:changed', { projectId, ...payload })
  }
}

function stopWatcher(projectId: number, force = false): void {
  const e = watchers.get(projectId)
  if (!e) return
  if (!force && --e.refs > 0) return
  try { e.watcher?.close() } catch { /* ignore */ }
  if (e.timer) clearTimeout(e.timer)
  watchers.delete(projectId)
}

function startWatcher(projectId: number, dir: string, refs: number): boolean {
  const entry: WatcherEntry = { watcher: null, timer: null, refs, dir, changes: 0 }
  let w: fs.FSWatcher
  try {
    w = fs.watch(dir, { recursive: true, persistent: false }, () => {
      entry.changes++
      if (entry.timer) return
      // 拖一批文件进来会触发几百次事件，合并成一次通知
      entry.timer = setTimeout(() => {
        entry.timer = null
        const n = entry.changes
        entry.changes = 0
        clearFolderCache()
        emitFolderChanged(projectId, { changes: n, at: Date.now(), path: dir })
      }, 600)
    })
  } catch {
    return false
  }
  entry.watcher = w
  watchers.set(projectId, entry)
  // 目录被删除 / 移动 / 盘符掉线时 watcher 会报错，静默收摊
  w.on('error', () => stopWatcher(projectId, true))
  return true
}

/** 文件夹改名后，把监视句柄指向新路径（保留原引用计数） */
function rewatchMovedFolder(projectId: number, nextDir: string): void {
  const old = watchers.get(projectId)
  if (!old) return
  const refs = old.refs
  stopWatcher(projectId, true)
  startWatcher(projectId, nextDir, refs)
}

/**
 * 监听项目资料文件夹。
 *
 * 用 fs.watch({ recursive: true }) 直接盯着磁盘：用户在资源管理器里新建 /
 * 拖入 / 覆盖 / 删除文件都会触发。一批操作会连发几百个事件，所以 debounce
 * 600ms 合并成一次刷新。采用引用计数，多个页签打开同一项目只挂一个 watcher。
 */
export function watchProjectFolder(projectId: number): { watching: boolean; path: string | null } {
  const existing = watchers.get(projectId)
  if (existing) {
    existing.refs++
    return { watching: !!existing.watcher, path: existing.dir || null }
  }

  const info = getProjectFolder(projectId, { createIfMissing: false })
  if (!info.exists || !info.path) return { watching: false, path: null }
  const dir = info.path

  return { watching: startWatcher(projectId, dir, 1), path: dir }
}

export function unwatchProjectFolder(projectId: number): { watching: boolean } {
  stopWatcher(projectId)
  return { watching: false }
}

/** 退出前统一关闭所有监视句柄 */
export function unwatchAllProjectFolders(): void {
  for (const id of [...watchers.keys()]) stopWatcher(id, true)
}
