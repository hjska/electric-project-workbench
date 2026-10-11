CREATE TABLE IF NOT EXISTS project (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  address       TEXT,
  owner_unit    TEXT,
  build_unit    TEXT,
  supervise_unit TEXT,
  manager       TEXT    NOT NULL,
  phone         TEXT,
  contract_amount REAL,
  start_date    TEXT    NOT NULL,
  plan_end_date TEXT    NOT NULL,
  actual_end_date TEXT,
  status        TEXT    NOT NULL DEFAULT '未开工',
  remark        TEXT,
  -- 工程资料文件夹绝对路径（图纸/程序/资料存放处，由 folder.service 维护）
  folder_path   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_project_status ON project(status);

-- project_id 允许为空：为空表示「日常备品」——暂时不归属任何项目的公共备件/库存。
-- 这类物料只在「物料管理」里维护，不计入任何项目的设备清单与到货率。
CREATE TABLE IF NOT EXISTS equipment (
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
CREATE INDEX IF NOT EXISTS idx_equip_project ON equipment(project_id);
CREATE INDEX IF NOT EXISTS idx_equip_arrival ON equipment(arrival_status, accept_status);
-- 自然键唯一：同一归属（项目 / 日常备品）下不允许同名同型号。
-- 必须用 IFNULL(project_id,0)：SQLite 的唯一索引把 NULL 视为互不相等，
-- 直接写 project_id 会让「日常备品」可以无限重复插入。
CREATE UNIQUE INDEX IF NOT EXISTS uk_equip_natural ON equipment(IFNULL(project_id,0), name, IFNULL(model,''));

CREATE TABLE IF NOT EXISTS process (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  seq_no        INTEGER NOT NULL DEFAULT 0,
  name          TEXT    NOT NULL,
  plan_qty      REAL    NOT NULL DEFAULT 0,
  qty_unit      TEXT    NOT NULL DEFAULT '项',
  done_qty      REAL    NOT NULL DEFAULT 0,
  plan_start    TEXT    NOT NULL,
  plan_end      TEXT    NOT NULL,
  actual_start  TEXT,
  actual_end    TEXT,
  weight        REAL    NOT NULL DEFAULT 1,
  owner         TEXT,
  status        TEXT    NOT NULL DEFAULT '未开始',
  remark        TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_process_project ON process(project_id, seq_no);

CREATE TABLE IF NOT EXISTS process_link (
  process_id     INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
  pre_process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
  PRIMARY KEY (process_id, pre_process_id)
);

CREATE TABLE IF NOT EXISTS daily_report (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  process_id    INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
  report_date   TEXT    NOT NULL,
  day_qty       REAL    NOT NULL,
  cum_qty       REAL    NOT NULL DEFAULT 0,
  unit          TEXT    NOT NULL DEFAULT '项',
  weather       TEXT,
  worker_count  INTEGER DEFAULT 0,
  recorder      TEXT,
  site_note     TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_report_proc_date ON daily_report(process_id, report_date);
CREATE INDEX IF NOT EXISTS idx_report_project_date ON daily_report(project_id, report_date);

CREATE TABLE IF NOT EXISTS milestone (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  plan_date     TEXT    NOT NULL,
  actual_date   TEXT,
  status        TEXT    NOT NULL DEFAULT '未开始',
  description   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS milestone_process (
  milestone_id INTEGER NOT NULL REFERENCES milestone(id) ON DELETE CASCADE,
  process_id   INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
  PRIMARY KEY (milestone_id, process_id)
);

CREATE TABLE IF NOT EXISTS issue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  process_id    INTEGER REFERENCES process(id) ON DELETE SET NULL,
  description   TEXT    NOT NULL,
  severity      TEXT    NOT NULL DEFAULT '一般',
  reporter      TEXT,
  report_date   TEXT    NOT NULL,
  owner         TEXT,
  due_date      TEXT,
  status        TEXT    NOT NULL DEFAULT '待处理',
  solution      TEXT,
  close_date    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_issue_project_status ON issue(project_id, status);

CREATE TABLE IF NOT EXISTS attachment (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  ref_type      TEXT    NOT NULL,
  ref_id        INTEGER,
  file_name     TEXT    NOT NULL,
  rel_path      TEXT    NOT NULL UNIQUE,
  file_ext      TEXT,
  file_size     INTEGER NOT NULL DEFAULT 0,
  category      TEXT    NOT NULL DEFAULT '其他',
  description   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_attach_project ON attachment(project_id);
CREATE INDEX IF NOT EXISTS idx_attach_ref ON attachment(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
