import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  project: {
    list: (query?: any) => invoke('project:list', query),
    get: (id: number) => invoke('project:get', id),
    create: (data: any) => invoke('project:create', data),
    update: (id: number, data: any) => invoke('project:update', id, data),
    remove: (id: number) => invoke('project:remove', id),
    options: () => invoke('project:options'),
  },
  equipment: {
    list: (query: any) => invoke('equipment:list', query),
    get: (id: number) => invoke('equipment:get', id),
    create: (data: any) => invoke('equipment:create', data),
    update: (id: number, data: any) => invoke('equipment:update', id, data),
    remove: (id: number) => invoke('equipment:remove', id),
    importRows: (projectId: number, rows: any[]) => invoke('equipment:import', projectId, rows),
    exportRows: (projectId: number) => invoke('equipment:exportRows', projectId),
  },
  material: {
    list: (q?: any) => invoke('material:list', q ?? {}),
    stats: (q?: any) => invoke('material:stats', q ?? {}),
    groupByProject: (q?: any) => invoke('material:groupByProject', q ?? {}),
    groupBySupplier: (q?: any) => invoke('material:groupBySupplier', q ?? {}),
    facets: (q?: any) => invoke('material:facets', q ?? {}),
    batchStatus: (ids: number[], patch: any) => invoke('material:batchStatus', ids, patch),
    removeMany: (ids: number[]) => invoke('material:removeMany', ids),
    create: (d: any) => invoke('material:create', d),
    update: (id: number, d: any) => invoke('material:update', id, d),
    remove: (id: number) => invoke('material:remove', id),
  },
  process: {
    list: (projectId: number) => invoke('process:list', projectId),
    create: (data: any) => invoke('process:create', data),
    update: (id: number, data: any) => invoke('process:update', id, data),
    remove: (id: number) => invoke('process:remove', id),
    reorder: (items: { id: number; seq_no: number }[]) => invoke('process:reorder', items),
  },
  report: {
    list: (query: any) => invoke('report:list', query),
    create: (data: any, overwrite?: boolean) => invoke('report:create', data, overwrite),
    update: (id: number, data: any) => invoke('report:update', id, data),
    remove: (id: number) => invoke('report:remove', id),
  },
  milestone: {
    list: (projectId: number) => invoke('milestone:list', projectId),
    create: (data: any) => invoke('milestone:create', data),
    update: (id: number, data: any) => invoke('milestone:update', id, data),
    remove: (id: number) => invoke('milestone:remove', id),
  },
  issue: {
    list: (query: any) => invoke('issue:list', query),
    create: (data: any) => invoke('issue:create', data),
    update: (id: number, data: any) => invoke('issue:update', id, data),
    remove: (id: number) => invoke('issue:remove', id),
  },
  attachment: {
    list: (query: any) => invoke('attachment:list', query),
    pickAndUpload: (projectId: number, refType: string, refId: number | null, category?: string) =>
      invoke('attachment:pickAndUpload', projectId, refType, refId, category),
    update: (id: number, data: any) => invoke('attachment:update', id, data),
    remove: (id: number) => invoke('attachment:remove', id),
    open: (id: number) => invoke('attachment:open', id),
    revealInFolder: (id: number) => invoke('attachment:reveal', id),
    exportList: (projectId: number) => invoke('attachment:exportList', projectId),
  },
  folder: {
    setting: () => invoke('folder:setting'),
    saveSetting: (patch: any) => invoke('folder:saveSetting', patch),
    defaultTree: () => invoke('folder:defaultTree'),
    info: (projectId: number) => invoke('folder:info', projectId),
    ensure: (projectId: number) => invoke('folder:ensure', projectId),
    browse: (projectId: number, relPath?: string) => invoke('folder:browse', projectId, relPath ?? ''),
    open: (projectId: number, relPath?: string) => invoke('folder:open', projectId, relPath ?? ''),
    reveal: (projectId: number, relPath?: string) => invoke('folder:reveal', projectId, relPath ?? ''),
    mkdir: (projectId: number, relPath: string, name: string) => invoke('folder:mkdir', projectId, relPath, name),
    recentChanges: (projectId: number, opts?: any) => invoke('folder:recentChanges', projectId, opts ?? {}),
    stats: (projectId: number) => invoke('folder:stats', projectId),
    watch: (projectId: number) => invoke('folder:watch', projectId),
    unwatch: (projectId: number) => invoke('folder:unwatch', projectId),
    /** 订阅磁盘变化（用户直接往文件夹里丢文件时触发），返回取消订阅函数 */
    onChanged: (cb: (payload: any) => void) => {
      const handler = (_e: any, payload: any) => cb(payload)
      ipcRenderer.on('folder:changed', handler)
      return () => { ipcRenderer.removeListener('folder:changed', handler) }
    },
    openRoot: () => invoke('folder:openRoot'),
    ensureAll: () => invoke('folder:ensureAll'),
  },
  stats: {
    dashboard: () => invoke('stats:dashboard'),
    projectSummary: (projectId: number) => invoke('stats:projectSummary', projectId),
  },
  report_export: {
    projectSummary: (projectId: number) => invoke('export:projectSummary', projectId),
    process: (projectId: number) => invoke('export:process', projectId),
    equipment: (projectId: number) => invoke('export:equipment', projectId),
    issue: (projectId: number) => invoke('export:issue', projectId),
  },
  backup: {
    settings: () => invoke('backup:settings'),
    saveSettings: (s: any) => invoke('backup:saveSettings', s),
    runNow: () => invoke('backup:runNow'),
    listBackups: () => invoke('backup:listBackups'),
    restore: () => invoke('backup:restore'),
    deleteBackup: (file: string) => invoke('backup:deleteBackup', file),
  },
  app: {
    getInfo: () => invoke('app:getInfo'),
  },
  shell: {
    showItemInFolder: (p: string) => invoke('shell:showItemInFolder', p),
    openPath: (p: string) => invoke('shell:openPath', p),
    selectDirectory: () => invoke('dialog:selectDirectory'),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
