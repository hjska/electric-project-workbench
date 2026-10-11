// 与 electron/preload.ts 暴露的 api 对齐的类型声明
export interface ProjectRow {
  id?: number
  code: string
  name: string
  address?: string
  owner_unit?: string
  build_unit?: string
  supervise_unit?: string
  manager: string
  phone?: string
  contract_amount?: number | null
  start_date: string
  plan_end_date: string
  actual_end_date?: string | null
  status: string
  remark?: string
  /** 工程资料文件夹绝对路径（由主进程维护） */
  folder_path?: string | null
  /** 建文件夹失败的提示，仅在创建项目返回时出现 */
  folderWarning?: string | null
  progress?: number
  arrival_rate?: number
  equipment_count?: number
  open_issue_count?: number
  summary?: {
    progress: number
    equipmentTotal: number
    arrivalRate: number
    openIssue: number
    overdueProcess: number
  }
}

export interface EquipmentRow {
  id?: number
  /** null = 日常备品（暂不归属任何项目） */
  project_id: number | null
  name: string
  model?: string
  tag_no?: string
  brand?: string
  supplier?: string
  unit: string
  quantity: number
  unit_price?: number
  contract_arrival_date?: string | null
  actual_arrival_date?: string | null
  arrival_status: string
  accept_status: string
  location?: string
  remark?: string
}

/* ===== 总物料管理（跨项目） ===== */

/** 总表行：设备字段 + 项目归属 + 计算列。日常备品的项目字段为 null。 */
export interface MaterialRow extends EquipmentRow {
  project_code: string | null
  project_name: string | null
  project_status: string | null
  /** 1 = 日常备品（未分配项目） */
  is_common: number
  /** 数量 × 单价 */
  amount: number
  /** 合同到货日期距今天数（负数=已逾期），无合同日期为 null */
  days_to_contract: number | null
  /** 1 = 逾期未到货 */
  is_overdue: number
  /** 1 = 已到货但未验收 */
  pending_accept: number
}

/** 与总表同过滤条件下的汇总指标 */
export interface MaterialStats {
  items: number
  total_qty: number
  total_amount: number
  arrived_qty: number
  not_arrived: number
  partial: number
  arrived: number
  pending_accept: number
  unqualified: number
  overdue: number
  upcoming: number
  /** 日常备品条目数（不计入 project_count） */
  common_items: number
  common_qty: number
  project_count: number
  supplier_count: number
  /** 按数量加权的到货率 */
  arrival_rate: number
}

export interface MaterialProjectGroup {
  /** 日常备品分组的 id 固定为 0 */
  id: number
  code: string
  name: string
  status: string
  /** 1 = 日常备品虚拟分组 */
  is_common?: number
  items: number
  qty: number
  amount: number
  arrived_qty: number
  not_arrived: number
  partial?: number
  pending_accept: number
  unqualified: number
  overdue: number
  last_updated?: string | null
}

export interface MaterialSupplierGroup {
  name: string
  project_count: number
  items: number
  qty: number
  amount: number
  /** 其中属于日常备品的条目数 */
  common_items: number
  not_arrived: number
  overdue: number
  pending_accept: number
  unqualified: number
}

export interface MaterialFacets {
  suppliers: string[]
  brands: string[]
}

export interface MaterialBatchResult {
  updated: number
  total: number
  skipped: { id: number; name: string; project_name?: string; reason: string }[]
}

export type MaterialView = 'all' | 'overdue' | 'upcoming' | 'pending_accept' | 'unqualified'

export interface ProcessRow {
  id?: number
  project_id: number
  seq_no: number
  name: string
  plan_qty: number
  qty_unit: string
  done_qty: number
  plan_start: string
  plan_end: string
  actual_start?: string | null
  actual_end?: string | null
  weight: number
  owner?: string
  status: string
  remark?: string
  ratio?: number
  report_count?: number
}

export interface ReportRow {
  id?: number
  project_id: number
  process_id: number
  process_name?: string
  report_date: string
  day_qty: number
  cum_qty?: number
  unit: string
  weather?: string
  worker_count?: number
  recorder?: string
  site_note?: string
}

export interface MilestoneRow {
  id?: number
  project_id: number
  name: string
  plan_date: string
  actual_date?: string | null
  status: string
  description?: string
  process_ids?: number[]
  process_count?: number
  isOverdue?: boolean
}

export interface IssueRow {
  id?: number
  project_id: number
  process_id?: number | null
  process_name?: string
  description: string
  severity: string
  reporter?: string
  report_date: string
  owner?: string
  due_date?: string | null
  status: string
  solution?: string | null
  close_date?: string | null
  isOverdue?: boolean
}

export interface AttachmentRow {
  id: number
  project_id: number
  ref_type: string
  ref_id?: number | null
  file_name: string
  rel_path: string
  abs_path?: string
  file_ext?: string
  file_size: number
  category: string
  description?: string
  created_at: string
}

/** —— 工程资料文件夹 —— */
export interface FolderNode {
  name: string
  children?: string[]
}

export interface FolderSetting {
  root: string
  tree: FolderNode[]
  createReadme: boolean
}

export interface ProjectFolderInfo {
  path: string | null
  exists: boolean
  root: string
  recreated: boolean
}

export interface FolderEntry {
  name: string
  isDir: boolean
  size: number
  /** 修改时间（ISO，磁盘实时读取） */
  mtime: string
  mtimeMs: number
  ctimeMs: number
  /** 距今天数，用于「最近改动」高亮 */
  ageDays?: number
  ext: string
  /** 仅目录：子树内文件总数 */
  childCount?: number
  /** 仅目录：子树内最近改动时间（毫秒） */
  latestMtimeMs?: number
  /** 仅目录：子树内最近改动的文件名 */
  latestName?: string
  /** 仅目录：子树占用空间 */
  treeSize?: number
  /** 仅目录：统计是否因超出上限被截断 */
  truncated?: boolean
}

export interface FolderScanSummary {
  files: number
  dirs: number
  size: number
  latestMtimeMs: number
  latestName: string
  latestRelPath: string
  truncated: boolean
}

export interface FolderBrowseResult {
  base: string
  relPath: string
  absPath: string
  entries: FolderEntry[]
  summary: FolderScanSummary
}

export interface FolderChangeItem {
  name: string
  /** 相对项目资料文件夹，/ 分隔 */
  relPath: string
  size: number
  mtimeMs: number
  birthtimeMs: number
  ext: string
  /** 所属一级分类，根目录下文件为「(根目录)」 */
  topCategory: string
  mtime: string
  ctime: string
  ageDays: number
  /** 是否在「新」阈值天数内改动过 */
  isNew: boolean
}

export interface FolderRecentResult {
  base: string
  scanned: number
  truncated: boolean
  newDays: number
  items: FolderChangeItem[]
}

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
  /** 最近 newDays 天内有改动的文件数 */
  recentCount: number
  newDays: number
  categories: FolderCategoryStat[]
  truncated: boolean
}

export interface FolderChangedEvent {
  projectId: number
  /** 合并后的变更事件条数 */
  changes: number
  at: number
  path: string
}

export interface DashboardData {
  cards: { buildingCount: number; overdueProcess: number; openIssue: number; monthArrival: number }
  projectProgress: { name: string; code: string; progress: number }[]
  arrivalDist: { name: string; value: number }[]
  trend: { date: string; count: number; qty: number }[]
  openIssues: any[]
}

export interface BackupSettings {
  autoEnabled: boolean
  time: string
  keep: number
}

declare global {
  interface Window {
    api: {
      project: {
        list: (q?: any) => Promise<ProjectRow[]>
        get: (id: number) => Promise<ProjectRow>
        create: (d: any) => Promise<ProjectRow>
        update: (id: number, d: any) => Promise<ProjectRow>
        remove: (id: number) => Promise<any>
        options: () => Promise<{ id: number; code: string; name: string; status: string }[]>
      }
      equipment: {
        list: (q: any) => Promise<EquipmentRow[]>
        get: (id: number) => Promise<EquipmentRow>
        create: (d: any) => Promise<EquipmentRow>
        update: (id: number, d: any) => Promise<EquipmentRow>
        remove: (id: number) => Promise<any>
        importRows: (projectId: number, rows: any[]) => Promise<any>
        exportRows: (projectId: number) => Promise<EquipmentRow[]>
      }
      material: {
        list: (q?: any) => Promise<MaterialRow[]>
        stats: (q?: any) => Promise<MaterialStats>
        groupByProject: (q?: any) => Promise<MaterialProjectGroup[]>
        groupBySupplier: (q?: any) => Promise<MaterialSupplierGroup[]>
        facets: (q?: any) => Promise<MaterialFacets>
        batchStatus: (ids: number[], patch: any) => Promise<MaterialBatchResult>
        removeMany: (ids: number[]) => Promise<{ deleted: number }>
        create: (d: any) => Promise<EquipmentRow>
        update: (id: number, d: any) => Promise<EquipmentRow>
        remove: (id: number) => Promise<any>
      }
      process: {
        list: (projectId: number) => Promise<ProcessRow[]>
        create: (d: any) => Promise<ProcessRow>
        update: (id: number, d: any) => Promise<ProcessRow>
        remove: (id: number) => Promise<any>
        reorder: (items: { id: number; seq_no: number }[]) => Promise<any>
      }
      report: {
        list: (q: any) => Promise<ReportRow[]>
        create: (d: any, overwrite?: boolean) => Promise<any>
        update: (id: number, d: any) => Promise<any>
        remove: (id: number) => Promise<any>
      }
      milestone: {
        list: (projectId: number) => Promise<MilestoneRow[]>
        create: (d: any) => Promise<MilestoneRow>
        update: (id: number, d: any) => Promise<MilestoneRow>
        remove: (id: number) => Promise<any>
      }
      issue: {
        list: (q: any) => Promise<IssueRow[]>
        create: (d: any) => Promise<IssueRow>
        update: (id: number, d: any) => Promise<IssueRow>
        remove: (id: number) => Promise<any>
      }
      attachment: {
        list: (q: any) => Promise<AttachmentRow[]>
        pickAndUpload: (projectId: number, refType: string, refId: number | null, category?: string) => Promise<any>
        update: (id: number, d: any) => Promise<AttachmentRow>
        remove: (id: number) => Promise<any>
        open: (id: number) => Promise<any>
        revealInFolder: (id: number) => Promise<any>
        exportList: (projectId: number) => Promise<AttachmentRow[]>
      }
      stats: {
        dashboard: () => Promise<DashboardData>
        projectSummary: (projectId: number) => Promise<any>
      }
      report_export: {
        projectSummary: (projectId: number) => Promise<any>
        process: (projectId: number) => Promise<any>
        equipment: (projectId: number) => Promise<any>
        issue: (projectId: number) => Promise<any>
      }
      backup: {
        settings: () => Promise<BackupSettings>
        saveSettings: (s: Partial<BackupSettings>) => Promise<BackupSettings>
        runNow: () => Promise<any>
        listBackups: () => Promise<{ dir: string; items: any[]; settings: BackupSettings; maxKeep: number }>
        restore: () => Promise<any>
        deleteBackup: (f: string) => Promise<any>
      }
      folder: {
        setting: () => Promise<FolderSetting>
        saveSetting: (patch: Partial<FolderSetting>) => Promise<FolderSetting>
        defaultTree: () => Promise<FolderNode[]>
        info: (projectId: number) => Promise<ProjectFolderInfo>
        ensure: (projectId: number) => Promise<ProjectFolderInfo>
        browse: (projectId: number, relPath?: string) => Promise<FolderBrowseResult>
        open: (projectId: number, relPath?: string) => Promise<{ ok: boolean; message?: string; path: string }>
        reveal: (projectId: number, relPath?: string) => Promise<{ ok: boolean; path: string }>
        mkdir: (projectId: number, relPath: string, name: string) => Promise<{ name: string; relPath: string }>
        recentChanges: (projectId: number, opts?: { limit?: number; days?: number }) => Promise<FolderRecentResult>
        stats: (projectId: number) => Promise<FolderStats>
        watch: (projectId: number) => Promise<{ watching: boolean; path: string | null }>
        unwatch: (projectId: number) => Promise<{ watching: boolean }>
        /** 订阅磁盘变化事件，返回取消订阅函数 */
        onChanged: (cb: (payload: FolderChangedEvent) => void) => () => void
        openRoot: () => Promise<{ ok: boolean; message?: string; path: string }>
        ensureAll: () => Promise<{ total: number; createdCount: number; skippedCount: number; created: string[]; failed: { code: string; message: string }[] }>
      }
      app: {
        getInfo: () => Promise<{ root: string; dbPath: string; version: string; attachmentsDir: string }>
      }
      shell: {
        showItemInFolder: (p: string) => Promise<any>
        openPath: (p: string) => Promise<any>
        selectDirectory: () => Promise<string | null>
      }
    }
  }
}
