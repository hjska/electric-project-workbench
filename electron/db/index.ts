import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const APP_ROOT = process.env.APP_ROOT || process.cwd()
const __dirname_ = path.dirname(fileURLToPath(import.meta.url))

let db: Database.Database | null = null

/**
 * 数据根目录惰性解析（见 service/paths.ts 的说明）：
 * ESM import 提升会早于主进程给 process.env.DATA_ROOT 赋值，
 * 因此这里不能在模块加载时固化常量。
 */
function getDataRoot(): string {
  return process.env.DATA_ROOT || path.join(process.env.APP_ROOT || APP_ROOT, 'data')
}

export function getDatabasePath(): string {
  return path.join(getDataRoot(), 'app.db')
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

/** 读取 schema.sql（打包后位于 dist-electron/schema.sql，开发时位于 electron/db/schema.sql） */
function loadSchema(): string {
  const candidates = [
    path.join(__dirname_, 'schema.sql'),
    path.join(__dirname_, '..', 'schema.sql'),
    path.join(APP_ROOT, 'electron', 'db', 'schema.sql'),
    path.join(APP_ROOT, 'resources', 'schema.sql'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  }
  throw new Error('未找到 schema.sql，无法初始化数据库')
}

const SCHEMA_VERSION = 3

/**
 * v3：equipment.project_id 放开为可空（支持「日常备品」——暂不归属任何项目的物料）。
 *
 * SQLite 没有「ALTER COLUMN 去掉 NOT NULL」的语法，只能重建表：
 * 建新表 → 拷数据 → 改名 → 重建索引。整体包在事务里，中途失败自动回滚。
 * 没有任何表的外键指向 equipment，所以关掉 foreign_keys 再重建不会误伤；
 * 指向 project 的外键与 ON DELETE CASCADE 语义保持不变。
 */
const EQUIPMENT_COLUMNS = [
  'id', 'project_id', 'name', 'model', 'tag_no', 'brand', 'supplier', 'unit',
  'quantity', 'unit_price', 'contract_arrival_date', 'actual_arrival_date',
  'arrival_status', 'accept_status', 'location', 'remark', 'created_at', 'updated_at',
]

function migrateEquipmentCommonItems(database: Database.Database): void {
  const cols = database.prepare('PRAGMA table_info(equipment)').all() as { name: string; notnull: number }[]
  const pid = cols.find((c) => c.name === 'project_id')
  if (!pid || pid.notnull === 0) return // 已经可空，无需迁移

  // 老库的列可能比现在少（历史上逐版加过列），所以按交集搬运，缺的列留默认值
  const src = new Set(cols.map((c) => c.name))
  const carry = EQUIPMENT_COLUMNS.filter((c) => src.has(c))
  const carryList = carry.join(', ')

  database.pragma('foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE equipment_v3 (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id    INTEGER REFERENCES project(id) ON DELETE CASCADE,
          name          TEXT    NOT NULL,
          model         TEXT,
          tag_no        TEXT,
          brand         TEXT,
          supplier      TEXT,
          unit          TEXT    NOT NULL DEFAULT '台',
          quantity      REAL    NOT NULL CHECK(quantity > 0),
          unit_price    REAL    DEFAULT 0 CHECK(unit_price >= 0),
          contract_arrival_date TEXT,
          actual_arrival_date   TEXT,
          arrival_status TEXT   NOT NULL DEFAULT '未到货',
          accept_status  TEXT   NOT NULL DEFAULT '未验收',
          location      TEXT,
          remark        TEXT,
          created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
          updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        );
        INSERT INTO equipment_v3 (${carryList}) SELECT ${carryList} FROM equipment;
        DROP TABLE equipment;
        ALTER TABLE equipment_v3 RENAME TO equipment;
        CREATE INDEX IF NOT EXISTS idx_equip_project ON equipment(project_id);
        CREATE INDEX IF NOT EXISTS idx_equip_arrival ON equipment(arrival_status, accept_status);
        CREATE UNIQUE INDEX IF NOT EXISTS uk_equip_natural ON equipment(IFNULL(project_id,0), name, IFNULL(model,''));
      `)
    })()
  } finally {
    database.pragma('foreign_keys = ON')
  }
}

/**
 * 幂等迁移（导出以便测试直接验证「老库升级」路径）。
 *
 * schema.sql 用的是 CREATE TABLE IF NOT EXISTS，对「已存在的库」不会补列、
 * 也不会改索引定义，因此结构性变更必须在这里显式处理，
 * 否则老用户升级后表结构对不上。
 */
export function migrateSchema(database: Database.Database): void {
  const cols = (database.prepare('PRAGMA table_info(project)').all() as { name: string }[]).map((c) => c.name)

  // v2：project.folder_path —— 工程资料文件夹路径
  if (!cols.includes('folder_path')) {
    database.exec('ALTER TABLE project ADD COLUMN folder_path TEXT')
  }

  // v3：equipment.project_id 可空 + 唯一索引改用 IFNULL(project_id,0)
  migrateEquipmentCommonItems(database)

  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value: string } | undefined
  if (!row) {
    database.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
  } else if (Number(row.value) < SCHEMA_VERSION) {
    database
      .prepare('UPDATE meta SET value = ? WHERE key = ?')
      .run(String(SCHEMA_VERSION), 'schema_version')
  }
}

export function initDatabase(): void {
  const dbPath = getDatabasePath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(loadSchema())
  migrateSchema(db)
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore */
    }
    db.close()
    db = null
  }
}
