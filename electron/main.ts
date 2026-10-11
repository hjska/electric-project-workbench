import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { initDatabase, getDatabasePath, migrateSchema } from './db/index'
import { registerProjectIpc } from './ipc/project.ipc'
import { registerEquipmentIpc } from './ipc/equipment.ipc'
import { registerMaterialIpc } from './ipc/material.ipc'
import { registerProcessIpc } from './ipc/process.ipc'
import { registerReportIpc } from './ipc/report.ipc'
import { registerMilestoneIpc } from './ipc/milestone.ipc'
import { registerIssueIpc } from './ipc/issue.ipc'
import { registerAttachmentIpc } from './ipc/attachment.ipc'
import { registerStatsIpc } from './ipc/stats.ipc'
import { registerExportIpc } from './ipc/export-register.ipc'
import { registerBackupIpc, startAutoBackupJob } from './ipc/backup.ipc'
import { registerFolderIpc } from './ipc/folder.ipc'
import {
  unwatchAllProjectFolders, browseProjectFolder, listRecentChanges, getFolderStats, clearFolderCache,
} from './service/folder.service'
import { createProject as svcCreateProject, removeProject as svcRemoveProject } from './service/project.service'

const __dirname_ = path.dirname(fileURLToPath(import.meta.url))

/**
 * 资源目录：dist-electron/main.cjs 位于项目根下的 dist-electron/，
 * 打包后位于 resources/app.asar/dist-electron/，其上一级同样是「资源根」。
 * 用于定位 dist/ 前端产物与 schema.sql 等只读资源。
 */
const APP_ROOT = path.resolve(__dirname_, '..')

/**
 * 数据目录：存放 SQLite 数据库、附件、备份。
 *
 * 开发态：放在项目根下 data/，方便查看。
 * 打包态：绝不能放在安装目录（可能在 Program Files，且 app.asar 只读），
 * 必须使用系统规定的用户数据目录（%APPDATA%\<应用名>）。
 */
function resolveDataRoot(): string {
  // 外部显式指定优先：自动化测试 / 演示沙箱需要把数据写到独立目录，
  // 避免污染开发库或用户真实数据。
  const fromEnv = process.env.DATA_ROOT?.trim()
  if (fromEnv) return fromEnv
  return app.isPackaged ? app.getPath('userData') : path.join(APP_ROOT, 'data')
}

process.env.APP_ROOT = APP_ROOT
process.env.DATA_ROOT = resolveDataRoot()

/**
 * 图形兼容性兜底：
 * 部分环境（远程桌面、虚拟机、无独显、受限沙箱）下 GPU 进程会崩溃，
 * 导致 Electron 直接启动失败。此时回退到软件渲染，保证应用仍能打开。
 * 可通过环境变量 FORCE_SOFTWARE_RENDER=0 强制启用硬件加速。
 */
if (process.env.FORCE_SOFTWARE_RENDER !== '0') {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('no-sandbox')
  app.disableHardwareAcceleration()
}

/**
 * 注册 app:// 自定义协议加载前端资源。
 * 原因：打包后页面用 <script type="module"> 加载，file:// 协议下会被 CORS 策略拦截，
 * 导致界面白屏。自定义标准协议可正常支持 ES module。
 * 必须在 app ready 之前调用 registerSchemesAsPrivileged。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
])

const DIST_DIR = path.join(APP_ROOT, 'dist')

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    // app://local/xxx -> dist/xxx
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const filePath = path.join(DIST_DIR, rel)

    // 安全：禁止越出 dist 目录
    if (!path.resolve(filePath).startsWith(path.resolve(DIST_DIR))) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!fs.existsSync(filePath)) {
      // 未命中的静态资源回退到 index.html（支持前端路由）
      const fallback = path.join(DIST_DIR, 'index.html')
      if (fs.existsSync(fallback)) {
        return net.fetch(pathToFileURL(fallback).toString())
      }
      return new Response('Not Found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  // 开发态显式设置窗口图标；打包态 exe 已内嵌图标，无需再指定。
  const devIcon = path.join(APP_ROOT, 'build', 'icon.ico')
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '电气项目管理台',
    show: false,
    autoHideMenuBar: true,
    ...(!app.isPackaged && fs.existsSync(devIcon) ? { icon: devIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname_, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 捕获渲染进程错误，便于定位白屏等问题
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`[renderer] ${message} (${sourceId}:${line})`)
    }
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] 页面加载失败 code=${code} ${desc} url=${url}`)
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // 通过自定义协议加载，避免 file:// 下 ES module 被 CORS 拦截导致白屏
    mainWindow.loadURL('app://local/index.html')
  }

  // 自动化验证模式：渲染完成后截图并退出
  if (process.env.GUI_VERIFY === '1') {
    runGuiVerify(mainWindow)
  }
  // 端到端业务链路验证
  if (process.env.E2E_VERIFY === '1') {
    runE2EVerify(mainWindow)
  }
  // 演示数据填充 + 界面截图
  if (process.env.DEMO_SEED === '1') {
    runDemoSeed(mainWindow)
  }
  // 数据层冒烟测试（在 Electron 运行时执行，避免 better-sqlite3 ABI 不匹配）
  if (process.env.SMOKE_TEST === '1') {
    runSmokeTest()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** GUI 自动化验证：依次打开各页面截图，用于无人值守检测界面是否正常渲染 */
function runGuiVerify(win: BrowserWindow) {
  const shotDir = process.env.SHOT_DIR || path.join(APP_ROOT, 'screenshots')
  if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true })

  const capture = async (name: string) => {
    try {
      const image = await win.webContents.capturePage()
      fs.writeFileSync(path.join(shotDir, `${name}.png`), image.toPNG())
      console.log(`[verify] 截图: ${name}.png`)
    } catch (e) {
      console.error(`[verify] 截图失败 ${name}:`, e)
    }
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  win.webContents.once('did-finish-load', async () => {
    await wait(3500) // 等待 React 挂载与图表渲染

    // 收集渲染进程错误
    await capture('01-dashboard')

    // 通过 executeJavaScript 检查界面实际渲染状态
    const diag = await win.webContents.executeJavaScript(`
      (() => {
        const root = document.getElementById('root')
        const menuItems = document.querySelectorAll('.ant-menu-item').length
        const cards = document.querySelectorAll('.ant-card').length
        const title = document.title
        return {
          hash: location.hash,
          title,
          rootChildren: root ? root.children.length : -1,
          rootHTMLLength: root ? root.innerHTML.length : 0,
          menuItems,
          cards,
          bodyText: document.body.innerText.slice(0, 300),
        }
      })()
    `)
    console.log('[verify] 渲染诊断:', JSON.stringify(diag, null, 2))

    // 依次切换到各页面截图
    const routes = ['/projects', '/backup', '/settings']
    for (let i = 0; i < routes.length; i++) {
      await win.webContents.executeJavaScript(`location.hash = '#${routes[i]}'`)
      await wait(1200)
      await capture(`0${i + 2}${routes[i].replace('/', '-')}`)
    }

    // 回到项目页，打开新建项目弹窗截图
    await win.webContents.executeJavaScript(`location.hash = '#/projects'`)
    await wait(1000)
    const modalOpened = await win.webContents.executeJavaScript(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const target = btns.find(b => b.innerText.includes('新建项目'))
        if (target) { target.click(); return true }
        return false
      })()
    `)
    if (modalOpened) {
      await wait(900)
      await capture('05-new-project-modal')
    }

    console.log('[verify] 验证完成，退出应用')
    setTimeout(() => app.quit(), 500)
  })
}

/** 端到端验证：在渲染进程真实调用 window.api，验证 IPC→service→SQLite 全链路 */
function runE2EVerify(win: BrowserWindow) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const log = (...a: any[]) => console.log('[e2e]', ...a)

  win.webContents.once('did-finish-load', async () => {
    await wait(2500)
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const R = { steps: [], pass: 0, fail: 0 }
          const ok = (name, cond, extra) => {
            R.steps.push({ name, ok: !!cond, extra })
            cond ? R.pass++ : R.fail++
          }
          const stamp = Date.now().toString().slice(-6)

          // 1. 创建项目
          const p = await window.api.project.create({
            code: 'E2E-' + stamp, name: 'E2E测试项目', manager: '测试员',
            start_date: '2026-01-01', plan_end_date: '2026-12-31',
            status: '施工中', owner_unit: '测试甲方',
          })
          ok('创建项目', p && p.id > 0, 'id=' + (p && p.id))

          // 2. 项目编号唯一性
          let dupErr = ''
          try {
            await window.api.project.create({ code: 'E2E-' + stamp, name: '重复', manager: 'x',
              start_date: '2026-01-01', plan_end_date: '2026-02-01', status: '未开工' })
          } catch (e) { dupErr = e.message || '' }
          ok('R1 编号唯一拦截', dupErr.length > 0, dupErr)

          // 3. 日期校验
          let dateErr = ''
          try {
            await window.api.project.create({ code: 'E2E-D-' + stamp, name: '日期错', manager: 'x',
              start_date: '2026-06-01', plan_end_date: '2026-01-01', status: '未开工' })
          } catch (e) { dateErr = e.message || '' }
          ok('R2 竣工日期校验', dateErr.includes('不得早于'), dateErr)

          // 4. 新增设备
          const eq = await window.api.equipment.create({
            project_id: p.id, name: '高压开关柜', model: 'KYN28-12', unit: '台',
            quantity: 2, unit_price: 35000, arrival_status: '未到货', accept_status: '未验收',
          })
          ok('新增设备', eq && eq.id > 0)

          // 5. R6 已到货必须填实际到货日期
          let arrivalErr = ''
          try {
            await window.api.equipment.create({ project_id: p.id, name: '缺日期设备', unit: '台',
              quantity: 1, arrival_status: '已到货', accept_status: '未验收' })
          } catch (e) { arrivalErr = e.message || '' }
          ok('R6 到货日期必填', arrivalErr.includes('实际到货日期'), arrivalErr)

          // 6. 新增工序
          const proc = await window.api.process.create({
            project_id: p.id, name: '电缆敷设', plan_qty: 500, qty_unit: '米',
            plan_start: '2026-01-01', plan_end: '2026-06-30', weight: 3, status: '未开始',
          })
          ok('新增工序', proc && proc.id > 0)

          // 7. 记日报
          const rep = await window.api.report.create({
            project_id: p.id, process_id: proc.id, report_date: '2026-02-01',
            day_qty: 200, unit: '米', weather: '晴', worker_count: 8, recorder: '测试员',
          })
          ok('记日报', rep && rep.report && rep.report.id > 0)
          ok('R10 累计自动重算=200', rep && rep.process && rep.process.done_qty === 200,
             'done_qty=' + (rep && rep.process && rep.process.done_qty))
          ok('R11 完成率=40%', rep && rep.process && Math.abs(rep.process.done_qty / 500 - 0.4) < 1e-9)

          // 8. R9 同日重复日报
          const rep2 = await window.api.report.create({
            project_id: p.id, process_id: proc.id, report_date: '2026-02-01',
            day_qty: 50, unit: '米',
          })
          ok('R9 同日日报拦截', rep2 && rep2.code === 'DUPLICATE_REPORT', JSON.stringify(rep2))

          // 9. 覆盖模式
          const rep3 = await window.api.report.create({
            project_id: p.id, process_id: proc.id, report_date: '2026-02-01',
            day_qty: 250, unit: '米',
          }, true)
          ok('覆盖模式生效', rep3 && rep3.process && rep3.process.done_qty === 250,
             'done_qty=' + (rep3 && rep3.process && rep3.process.done_qty))
          ok('累计完成量回填 cum_qty=250', rep3 && rep3.report && rep3.report.cum_qty === 250,
             'cum_qty=' + (rep3 && rep3.report && rep3.report.cum_qty))

          // 10. 问题闭环校验
          let issueErr = ''
          try {
            await window.api.issue.create({ project_id: p.id, description: '测试问题',
              report_date: '2026-02-01', status: '已闭环' })
          } catch (e) { issueErr = e.message || '' }
          ok('R13 闭环必填处理措施', issueErr.includes('处理措施'), issueErr)

          // 11. 正常问题
          const iss = await window.api.issue.create({ project_id: p.id, description: '桥架缺接地',
            severity: '重要', report_date: '2026-02-01', status: '待处理' })
          ok('创建问题', iss && iss.id > 0)

          // 12. 里程碑
          const ms = await window.api.milestone.create({ project_id: p.id, name: '送电验收',
            plan_date: '2026-06-30', status: '未开始', process_ids: [proc.id] })
          ok('创建里程碑', ms && ms.id > 0)

          // 12b. 甘特视图（二期 M3-5）数据链路：工序时间轴字段 + 里程碑可定位
          const ganttRows = await window.api.process.list(p.id)
          const g0 = ganttRows.find((x) => x.id === proc.id)
          ok('甘特：工序带计划/实际区间与完成率',
            !!(g0 && g0.plan_start === '2026-01-01' && g0.plan_end === '2026-06-30'
               && g0.actual_start === '2026-02-01' && typeof g0.ratio === 'number'),
            JSON.stringify(g0 && { ps: g0.plan_start, pe: g0.plan_end, as: g0.actual_start, r: g0.ratio }))
          const ganttMs = await window.api.milestone.list(p.id)
          ok('甘特：里程碑计划日期可用于时间轴定位',
            ganttMs.length >= 1 && ganttMs.some((m) => m.plan_date === '2026-06-30'),
            'n=' + ganttMs.length)

          // 12c. 甘特视图真实渲染（切到工序 Tab + 甘特视图，断言 ECharts 画布已生成）
          try {
            location.hash = '#/projects/' + p.id
            await new Promise((r) => setTimeout(r, 1800))
            const procTab = Array.from(document.querySelectorAll('.ant-tabs-tab'))
              .find((x) => (x.innerText || '').includes('工序进度'))
            if (procTab) procTab.click()
            await new Promise((r) => setTimeout(r, 1500))
            const ganttSeg = Array.from(document.querySelectorAll('.ant-segmented-item-label'))
              .find((x) => (x.innerText || '').trim().includes('甘特'))
            if (ganttSeg) ganttSeg.click()
            await new Promise((r) => setTimeout(r, 2200))
            const gcv = document.querySelector('canvas')
            ok('甘特视图渲染出 ECharts 画布',
              !!gcv && gcv.width > 0 && gcv.height > 0,
              gcv ? gcv.width + 'x' + gcv.height : 'no canvas')
            // 像素抽样：确认真的画出了条形（而非空白画布）
            let colored = 0
            try {
              const cx = gcv.getContext('2d')
              const img = cx.getImageData(0, 0, gcv.width, gcv.height).data
              for (let i = 0; i < img.length; i += 4 * 37) {
                if (img[i + 3] > 0 && (img[i] < 245 || img[i + 1] < 245 || img[i + 2] < 245)) colored++
              }
            } catch (e) { /* 取像素失败按 0 记 */ }
            ok('甘特图实际绘制出工序条形', colored > 50, 'coloredPixels=' + colored)
            await new Promise((r) => setTimeout(r, 400))
            location.hash = '#/dashboard'
            await new Promise((r) => setTimeout(r, 800))
          } catch (e) {
            ok('甘特视图渲染出 ECharts 画布', false, e && e.message)
          }

          // 13. 统计接口
          const dash = await window.api.stats.dashboard()
          ok('仪表盘统计', dash && dash.cards && typeof dash.cards.buildingCount === 'number')

          // 14. 项目详情含汇总
          const detail = await window.api.project.get(p.id)
          ok('项目详情含汇总', detail && detail.summary && detail.summary.equipmentTotal === 1,
             'equipmentTotal=' + (detail && detail.summary && detail.summary.equipmentTotal))

          // 15. 项目列表进度计算（覆盖后 250/500 = 50%）
          const list = await window.api.project.list({})
          const mine = list.find(x => x.id === p.id)
          ok('项目进度计算', mine && mine.progress === 50, 'progress=' + (mine && mine.progress))

          // 15b. 总物料管理（跨项目）
          const localDate = (off) => {
            const t = new Date(Date.now() + off * 86400000)
            const z = (n) => String(n).padStart(2, '0')
            return t.getFullYear() + '-' + z(t.getMonth() + 1) + '-' + z(t.getDate())
          }
          const p2 = await window.api.project.create({
            code: 'E2E-M-' + stamp, name: '物料汇总项目B', manager: '测试员',
            start_date: '2026-01-01', plan_end_date: '2026-12-31', status: '施工中',
          })

          const meOverdue = await window.api.material.create({
            project_id: p2.id, name: '干式变压器', model: 'SCB13-' + stamp, unit: '台',
            quantity: 2, unit_price: 128000, supplier: '甲供货商', brand: '示例电气',
            contract_arrival_date: localDate(-30), arrival_status: '未到货', accept_status: '未验收',
            location: '1号库',
          })
          const meArrived = await window.api.material.create({
            project_id: p2.id, name: '低压配电柜', model: 'GGD-' + stamp, unit: '面',
            quantity: 6, unit_price: 9000, supplier: '乙供货商',
            contract_arrival_date: localDate(-10), actual_arrival_date: localDate(-5),
            arrival_status: '已到货', accept_status: '未验收',
          })
          const meUpcoming = await window.api.material.create({
            project_id: p2.id, name: '密集型母线槽', model: 'CMC-' + stamp, unit: '米',
            quantity: 80, unit_price: 1650, supplier: '甲供货商',
            contract_arrival_date: localDate(3), arrival_status: '未到货', accept_status: '未验收',
          })
          ok('总表内指定项目新增物料', meOverdue && meOverdue.id > 0 && meArrived.id > 0 && meUpcoming.id > 0)

          const all = await window.api.material.list({})
          ok('物料总表跨项目汇总', all.length === 4, 'rows=' + all.length)
          ok('总表行带项目归属', all.every(r => !!r.project_code && !!r.project_name))
          ok('总表行带金额计算',
            Math.abs(all.find(r => r.name === '干式变压器').amount - 256000) < 1e-6)
          const overdueRow = all.find(r => r.name === '干式变压器')
          ok('逾期未到货被标记', overdueRow.is_overdue === 1 && overdueRow.days_to_contract === -30,
            'days=' + overdueRow.days_to_contract)
          const arrivedRow = all.find(r => r.name === '低压配电柜')
          ok('已到货待验收被标记', arrivedRow.is_overdue === 0 && arrivedRow.pending_accept === 1)
          ok('无合同日期不算逾期', all.find(r => r.name === '高压开关柜').is_overdue === 0)

          const overdueList = await window.api.material.list({ view: 'overdue' })
          ok('到货监控：逾期未到货清单', overdueList.length === 1 && overdueList[0].name === '干式变压器',
            'n=' + overdueList.length)
          const upcomingList = await window.api.material.list({ view: 'upcoming' })
          ok('到货监控：7天内应到货', upcomingList.length === 1 && upcomingList[0].name === '密集型母线槽',
            'n=' + upcomingList.length)
          const paList = await window.api.material.list({ view: 'pending_accept' })
          ok('到货监控：待到货验收', paList.length === 1 && paList[0].name === '低压配电柜', 'n=' + paList.length)

          const kwList = await window.api.material.list({ keyword: 'SCB13-' + stamp })
          ok('总表按关键字跨项目搜索', kwList.length === 1 && kwList[0].project_code === p2.code, 'n=' + kwList.length)
          ok('总表按项目筛选', (await window.api.material.list({ projectId: p2.id })).length === 3)
          ok('总表按到货状态筛选', (await window.api.material.list({ arrival: ['未到货'] })).length === 3)
          ok('总表按供货商筛选', (await window.api.material.list({ supplier: '甲供货商' })).length === 2)

          const st = await window.api.material.stats({})
          ok('物料概览统计条目数', st.items === 4, 'items=' + st.items)
          ok('物料概览统计合计数量', st.total_qty === 90, 'qty=' + st.total_qty)
          ok('物料概览统计合计金额', Math.abs(st.total_amount - 512000) < 1e-6, 'amount=' + st.total_amount)
          ok('物料概览统计到货率', st.arrived_qty === 6 && st.arrival_rate === 7,
            st.arrived_qty + '/' + st.total_qty + ' = ' + st.arrival_rate + '%')
          ok('物料概览统计逾期与待验收', st.overdue === 1 && st.pending_accept === 1,
            'overdue=' + st.overdue + ' pending=' + st.pending_accept)
          ok('物料概览统计覆盖范围', st.project_count === 2 && st.supplier_count === 2,
            'proj=' + st.project_count + ' sup=' + st.supplier_count)
          ok('概览随筛选条件收敛',
            (await window.api.material.stats({ projectId: p2.id })).items === 3)

          const gp = await window.api.material.groupByProject({})
          ok('按项目汇总包含全部项目', gp.length === 2, 'n=' + gp.length)
          const gpB = gp.find(r => r.code === p2.code)
          ok('按项目汇总金额正确', Math.abs(gpB.amount - 442000) < 1e-6, 'amount=' + gpB.amount)
          ok('按项目汇总到货量正确', gpB.arrived_qty === 6 && gpB.items === 3, JSON.stringify(gpB))
          ok('按项目汇总风险计数正确', gpB.overdue === 1 && gpB.pending_accept === 1 && gpB.not_arrived === 2)

          const gs = await window.api.material.groupBySupplier({})
          ok('按供货商汇总分组', gs.length === 2, 'n=' + gs.length)
          ok('按供货商汇总金额降序', gs.every((s, i) => i === 0 || gs[i - 1].amount >= s.amount))
          const supA = gs.find(s => s.name === '甲供货商')
          ok('按供货商汇总数量与金额正确',
            supA && supA.items === 2 && Math.abs(supA.amount - 388000) < 1e-6, supA && String(supA.amount))

          const facets = await window.api.material.facets()
          ok('筛选维度可选值（供货商）', facets.suppliers.length === 2, facets.suppliers.join(','))
          ok('筛选维度可选值（品牌）', facets.brands.length === 1, facets.brands.join(','))

          // 15c. 日常备品：不归属任何项目的物料
          const meCommon = await window.api.material.create({
            project_id: null, name: '绝缘胶带', model: 'J-20-' + stamp, unit: '卷',
            quantity: 50, unit_price: 8, supplier: '丙五金行', brand: '通用',
            contract_arrival_date: localDate(30), arrival_status: '未到货', accept_status: '未验收',
            location: '备件库A',
          })
          ok('可新增不归属任何项目的「日常备品」',
            meCommon && meCommon.id > 0 && meCommon.project_id === null, JSON.stringify(meCommon))

          let dupCommonErr = ''
          try {
            await window.api.material.create({
              project_id: null, name: '绝缘胶带', model: 'J-20-' + stamp, unit: '卷', quantity: 1,
            })
          } catch (e) { dupCommonErr = e.message || '' }
          ok('备品同样受「同名同型号」唯一约束', /UNIQUE/i.test(dupCommonErr), dupCommonErr)

          const commonList = await window.api.material.list({ common: true })
          ok('备品可按归属单独筛选',
            commonList.length === 1 && commonList[0].is_common === 1 && commonList[0].project_name === null,
            'n=' + commonList.length)

          const allWithCommon = await window.api.material.list({})
          ok('总表默认包含日常备品', allWithCommon.length === 5, 'rows=' + allWithCommon.length)
          ok('备品排在项目物料之后', allWithCommon[allWithCommon.length - 1].is_common === 1)
          ok('项目物料仍带项目归属',
            allWithCommon.slice(0, 4).every(r => !!r.project_code && !!r.project_name))

          const stC = await window.api.material.stats({})
          ok('备品计入物料条目但不计入项目数',
            stC.items === 5 && stC.common_items === 1 && stC.project_count === 2,
            'items=' + stC.items + ' common=' + stC.common_items + ' proj=' + stC.project_count)
          ok('备品数量进入合计数量', stC.total_qty === 140, 'qty=' + stC.total_qty)

          const gpC = await window.api.material.groupByProject({})
          const commonGroup = gpC.find((r) => r.is_common === 1)
          ok('按项目汇总多出一条「日常备品」分组',
            gpC.length === 3 && !!commonGroup && commonGroup.items === 1 && commonGroup.qty === 50,
            JSON.stringify(commonGroup))
          ok('只看备品时项目汇总只剩备品一条',
            (await window.api.material.groupByProject({ common: true })).length === 1)

          const gsC = await window.api.material.groupBySupplier({})
          const supC = gsC.find((s) => s.name === '丙五金行')
          ok('备品供货商进入按供货商汇总',
            gsC.length === 3 && !!supC && supC.items === 1 && supC.common_items === 1 && supC.project_count === 0,
            JSON.stringify(supC))

          const bsC = await window.api.material.batchStatus([meCommon.id], { accept_status: '合格' })
          ok('备品的违规批量修改同样被跳过（未到货不能验收）',
            bsC.updated === 0 && bsC.skipped.length === 1 && bsC.skipped[0].reason.includes('验收'),
            JSON.stringify(bsC.skipped))
          const bsC2 = await window.api.material.batchStatus([meCommon.id], { arrival_status: '已到货' })
          ok('备品可参与批量改状态', bsC2.updated === 1 && bsC2.skipped.length === 0, JSON.stringify(bsC2))

          await window.api.material.update(meUpcoming.id, { ...meUpcoming, quantity: 100 })
          const afterEdit = await window.api.material.list({ projectId: p2.id })
          ok('总表内跨项目直接编辑', afterEdit.find(r => r.id === meUpcoming.id).quantity === 100)

          const bs1 = await window.api.material.batchStatus([meOverdue.id], { arrival_status: '已到货', actual_arrival_date: localDate(-1) })
          ok('批量改到货状态', bs1.updated === 1 && bs1.skipped.length === 0, JSON.stringify(bs1))
          ok('批量改为已到货后不再算逾期',
            (await window.api.material.list({ view: 'overdue' })).length === 0)
          const bs2 = await window.api.material.batchStatus([meOverdue.id, meArrived.id], { accept_status: '合格' })
          ok('批量改验收状态', bs2.updated === 2 && bs2.skipped.length === 0, JSON.stringify(bs2))
          const bs3 = await window.api.material.batchStatus([meArrived.id], { arrival_status: '未到货' })
          ok('违反业务规则的批量修改被跳过并给出原因',
            bs3.updated === 0 && bs3.skipped.length === 1 && bs3.skipped[0].reason.includes('验收'),
            JSON.stringify(bs3.skipped))
          const bs4 = await window.api.material.batchStatus([999999], { accept_status: '合格' })
          ok('批量修改跳过不存在的物料', bs4.updated === 0 && bs4.skipped.length === 1)

          const rm = await window.api.material.removeMany([meUpcoming.id])
          ok('批量删除物料', rm.deleted === 1 && (await window.api.material.list({ projectId: p2.id })).length === 2)

          await window.api.project.remove(p2.id)
          ok('删除项目后其物料一并从总表消失',
            (await window.api.material.list({ projectId: p2.id })).length === 0)
          ok('删除项目后总表只剩其他项目与备品',
            (await window.api.material.list({})).length === 2,
            'rows=' + (await window.api.material.list({})).length)
          ok('删除项目不影响日常备品',
            (await window.api.material.list({ common: true })).length === 1)

          // 备品 ↔ 项目 双向改归属
          const meCommonNow = (await window.api.material.list({ common: true }))[0]
          await window.api.material.update(meCommonNow.id, { ...meCommonNow, project_id: p.id })
          ok('日常备品可随时指派给项目',
            (await window.api.material.list({ common: true })).length === 0
            && (await window.api.material.list({ projectId: p.id })).length === 2)
          await window.api.material.update(meCommonNow.id, { ...meCommonNow, project_id: null })
          ok('物料也可退回日常备品池',
            (await window.api.material.list({ common: true })).length === 1
            && (await window.api.material.list({ projectId: p.id })).length === 1)

          // 16. 资料文件夹：创建项目时自动生成
          const fInfo = await window.api.folder.info(p.id)
          ok('创建项目时自动建资料文件夹', !!fInfo.path && fInfo.exists, fInfo.path)

          const rootBrowse = await window.api.folder.browse(p.id, '')
          const expected = ['01-图纸', '02-程序', '03-设备资料', '04-施工资料', '05-验收竣工', '06-往来文件', '99-其他']
          ok('一级分类目录齐全', expected.every(n => rootBrowse.entries.some(e => e.name === n && e.isDir)),
             '实得 ' + rootBrowse.entries.filter(e => e.isDir).length + ' 个目录')

          const subBrowse = await window.api.folder.browse(p.id, '01-图纸')
          ok('二级分类目录已生成', subBrowse.entries.some(e => e.name === '设计图纸' && e.isDir))

          const mk = await window.api.folder.mkdir(p.id, '01-图纸', '临时目录')
          const subBrowse2 = await window.api.folder.browse(p.id, '01-图纸')
          ok('可新建子文件夹', subBrowse2.entries.some(e => e.name === mk.name && e.isDir))

          let escErr = ''
          try { await window.api.folder.browse(p.id, '../../..') } catch (e) { escErr = e.message || '' }
          ok('越界路径被拒绝', escErr.includes('越界'), escErr)

          // 16b. 文件识别：读取的是真实磁盘内容，带改动时间
          const readme = rootBrowse.entries.find(e => e.name === '_资料说明.txt')
          ok('能识别文件夹里的现有文件', !!readme && !readme.isDir, readme && readme.name)
          ok('文件带修改时间', !!(readme && readme.mtimeMs > 0 && !!readme.mtime), readme && readme.mtime)
          ok('文件带创建时间', !!(readme && readme.ctimeMs > 0))

          const emptyCat = rootBrowse.entries.find(e => e.name === '03-设备资料')
          ok('目录带子树文件数统计', !!emptyCat && emptyCat.childCount === 0,
             'childCount=' + (emptyCat && emptyCat.childCount))

          const fStats = await window.api.folder.stats(p.id)
          ok('资料概览统计文件数', fStats.fileCount >= 1, 'fileCount=' + fStats.fileCount)
          ok('资料概览列出全部分类', fStats.categories.length >= 7, 'categories=' + fStats.categories.length)
          ok('资料概览给出最近改动', fStats.latestMtimeMs > 0, fStats.latestRelPath)

          const recent = await window.api.folder.recentChanges(p.id, { limit: 20 })
          ok('最近改动清单可用', recent.items.length >= 1 && recent.items[0].mtimeMs > 0,
             'items=' + recent.items.length)
          ok('最近改动按时间倒序',
             recent.items.every((it, i) => i === 0 || recent.items[i - 1].mtimeMs >= it.mtimeMs))
          ok('最近改动带分类归属', !!recent.items[0].topCategory, recent.items[0].topCategory)

          // 17. 改名后文件夹跟随重命名
          await window.api.project.update(p.id, {
            code: 'E2E-' + stamp, name: 'E2E改名项目', manager: '测试员',
            start_date: '2026-01-01', plan_end_date: '2026-12-31', status: '施工中',
          })
          const renamed = await window.api.folder.info(p.id)
          ok('项目改名后资料文件夹跟随', !!renamed.path && renamed.path.includes('E2E改名项目') && renamed.exists,
             renamed.path)

          // 18. 清理
          const del = await window.api.project.remove(p.id)
          ok('级联删除项目', del && del.deleted === true)
          ok('删除项目返回保留的文件夹路径', !!(del && del.folderKept), del && del.folderKept)

          // 19. 清理后确认
          const after = await window.api.equipment.list({ projectId: p.id })
          ok('级联后设备已清空', Array.isArray(after) && after.length === 0)

          R.folderPath = renamed.path
          return R
        })()
      `)

      // 主进程侧补充校验（渲染进程拿不到 fs）：删除项目后资料文件夹是否保留
      if (result.folderPath) {
        const kept = fs.existsSync(result.folderPath)
        result.steps.push({ name: '删除项目后资料文件夹保留在磁盘', ok: kept, extra: kept ? result.folderPath : '已被误删' })
        kept ? result.pass++ : result.fail++
        try { fs.rmSync(result.folderPath, { recursive: true, force: true }) } catch { /* 清理测试目录 */ }
      }

      // ===== 主进程侧：模拟「用户绕过软件，直接把文件丢进资料文件夹」 =====
      // 渲染进程没有 fs 权限，这一步必须在主进程做，才能真实验证「自己识别文件」。
      try {
        const stamp2 = Date.now().toString().slice(-6)
        const tp = svcCreateProject({
          code: 'E2E-FS-' + stamp2, name: '外部文件识别', manager: '测试员',
          start_date: '2026-01-01', plan_end_date: '2026-12-31', status: '施工中',
        } as any) as any
        const tid: number = tp.id
        const tdir: string = tp.folder_path
        const push = (name: string, cond: any, extra?: string) => {
          result.steps.push({ name, ok: !!cond, extra })
          cond ? result.pass++ : result.fail++
        }

        push('外部写入前该目录为空', browseProjectFolder(tid, '02-程序/PLC程序').entries.length === 0)

        // 等价于用户在资源管理器里把文件拖进去
        const f1 = path.join(tdir, '02-程序', 'PLC程序', 'S7-1500_主程序_V1.3.awl')
        const f2 = path.join(tdir, '05-验收竣工', '试验报告', '接地电阻测试报告.pdf')
        fs.mkdirSync(path.dirname(f1), { recursive: true })
        fs.writeFileSync(f1, '// PLC program', 'utf8')
        fs.writeFileSync(f2, '%PDF-1.4 placeholder', 'utf8')

        // 清扫描缓存，等价于 watcher 捕获到磁盘变化后的动作
        clearFolderCache()

        const b1 = browseProjectFolder(tid, '02-程序/PLC程序')
        const got = b1.entries.find((e) => e.name === 'S7-1500_主程序_V1.3.awl')
        push('直接放进文件夹的文件被识别', !!got, got && got.name)
        push('识别到文件修改时间', !!(got && got.mtimeMs > 0), got && new Date(got.mtimeMs).toISOString())
        push('文件扩展名解析正确', !!(got && got.ext === 'awl'), got && got.ext)
        push('文件大小被读取', !!(got && got.size > 0), got && String(got.size))

        const parent = browseProjectFolder(tid, '02-程序')
        const sub = parent.entries.find((e) => e.name === 'PLC程序')
        push('父目录汇总出子目录文件数', !!(sub && sub.childCount === 1), 'childCount=' + (sub && sub.childCount))
        push('父目录汇总出最近改动', (sub?.latestMtimeMs ?? 0) > 0, sub && sub.latestName)

        const rec = listRecentChanges(tid, { limit: 10 })
        push('最近改动包含新放入的文件',
          rec.items.some((i) => i.relPath.endsWith('接地电阻测试报告.pdf')),
          rec.items[0] && rec.items[0].relPath)
        push('最近改动按时间倒序',
          rec.items.every((it, i) => i === 0 || rec.items[i - 1].mtimeMs >= it.mtimeMs))
        push('最近改动归属到正确分类',
          rec.items.some((i) => i.topCategory === '05-验收竣工'),
          rec.items.map((i) => i.topCategory).join(','))

        const st = getFolderStats(tid)
        push('资料概览统计到外部文件', st.fileCount >= 3, 'fileCount=' + st.fileCount)
        push('资料概览分类明细正确',
          st.categories.some((c) => c.name === '02-程序' && c.fileCount === 1),
          st.categories.map((c) => c.name + ':' + c.fileCount).join(' '))

        // 再次改动文件 → 修改时间必须前进
        const before = got!.mtimeMs
        await new Promise((r) => setTimeout(r, 1100))
        fs.writeFileSync(f1, '// PLC program v2', 'utf8')
        clearFolderCache()
        const got2 = browseProjectFolder(tid, '02-程序/PLC程序')
          .entries.find((e) => e.name === 'S7-1500_主程序_V1.3.awl')
        push('再次改动后修改时间随之更新', !!(got2 && got2.mtimeMs > before),
          new Date(before).toISOString() + ' → ' + (got2 ? new Date(got2.mtimeMs).toISOString() : '—'))

        // 清理测试项目与目录
        svcRemoveProject(tid)
        try { fs.rmSync(tdir, { recursive: true, force: true }) } catch { /* ignore */ }
      } catch (e: any) {
        result.steps.push({ name: '外部文件识别用例执行', ok: false, extra: e?.message || String(e) })
        result.fail++
      }

      console.log('\n===== 端到端验证结果 =====')
      for (const s of result.steps) {
        console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}${s.extra ? '  → ' + s.extra : ''}`)
      }
      console.log(`\n  合计：${result.pass} 通过 / ${result.fail} 失败`)
      console.log(result.fail === 0 ? '\nE2E_ALL_PASS\n' : '\nE2E_HAS_FAILURE\n')
    } catch (e) {
      console.error('[e2e] 执行异常:', e)
    }
    setTimeout(() => app.quit(), 400)
  })
}

/**
 * 数据层冒烟测试：校验建表、约束、唯一索引与级联删除。
 * 运行在 Electron 运行时内（better-sqlite3 已按 Electron ABI 编译），
 * 使用独立测试库 data-test/app.db，不污染正式数据。
 */
function runSmokeTest() {
  const ROOT = APP_ROOT
  const TEST_DIR = path.join(ROOT, 'data-test')
  const TEST_DB = path.join(TEST_DIR, 'app.db')
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEST_DIR, { recursive: true })

  // 让 db 层使用测试库（当前实现为独立文件，不影响正式库）

  let pass = 0
  let fail = 0
  const steps: { name: string; ok: boolean; extra?: string }[] = []
  const check = (name: string, fn: () => void) => {
    try {
      fn()
      pass++
      steps.push({ name, ok: true })
    } catch (e: any) {
      fail++
      steps.push({ name, ok: false, extra: e?.message })
    }
  }
  const assert = (cond: any, msg?: string) => {
    if (!cond) throw new Error(msg || '断言失败')
  }

  try {
    // 使用与正式运行完全相同的初始化逻辑
    const schemaSql = fs.readFileSync(path.join(APP_ROOT, 'dist-electron', 'schema.sql'), 'utf8')
    const db = new Database(TEST_DB)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(schemaSql)

    console.log('\n=== 数据层冒烟测试 ===\n')
    console.log('[1] 建表检查')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name)
    for (const t of [
      'project', 'equipment', 'process', 'process_link', 'daily_report',
      'milestone', 'milestone_process', 'issue', 'attachment', 'meta', 'app_settings',
    ]) {
      check(`表 ${t} 已创建`, () => assert(tables.includes(t), `缺少表 ${t}`))
    }

    console.log('\n[2] 项目台账与规则')
    const insProject = db.prepare(
      'INSERT INTO project (code,name,manager,start_date,plan_end_date,status,owner_unit) VALUES (?,?,?,?,?,?,?)'
    )
    check('插入项目成功', () =>
      insProject.run('PRJ-2026-001', '3#配电室改造', '张三', '2026-10-01', '2026-12-31', '施工中', 'XX厂')
    )
    check('R1 项目编号唯一索引生效', () => {
      let threw = false
      try {
        insProject.run('PRJ-2026-001', '重复编号', '李四', '2026-10-01', '2026-12-31', '未开工', 'YY厂')
      } catch {
        threw = true
      }
      assert(threw, '重复编号未被拦截')
    })

    console.log('\n[3] 外键约束与级联删除')
    const pid = (db.prepare('SELECT id FROM project WHERE code=?').get('PRJ-2026-001') as any).id
    check('外键：设备可挂到项目', () =>
      db.prepare('INSERT INTO equipment (project_id,name,unit,quantity) VALUES (?,?,?,?)').run(pid, '高压柜', '台', 2)
    )
    check('外键：project_id 为空即「日常备品」（不挂项目）', () => {
      const info = db
        .prepare('INSERT INTO equipment (project_id,name,unit,quantity) VALUES (NULL,?,?,?)')
        .run('备品绝缘胶带', '卷', 50)
      assert(Number(info.lastInsertRowid) > 0, 'project_id 为空未被接受')
    })
    check('外键：非法 project_id 被拒绝', () => {
      let threw = false
      try {
        db.prepare('INSERT INTO equipment (project_id,name,unit,quantity) VALUES (?,?,?,?)').run(99999, '孤儿', '台', 1)
      } catch {
        threw = true
      }
      assert(threw, '非法外键未被拒绝')
    })

    console.log('\n[4] 工序与日报')
    const procId = db
      .prepare(
        'INSERT INTO process (project_id,name,plan_qty,qty_unit,plan_start,plan_end,weight,status) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(pid, '电缆敷设', 500, '米', '2026-02-01', '2026-06-30', 5, '未开始').lastInsertRowid
    check('插入工序成功', () => assert(Number(procId) > 0))
    check('日报唯一索引（工序+日期）生效', () => {
      const ins = db.prepare(
        'INSERT INTO daily_report (project_id,process_id,report_date,day_qty,unit) VALUES (?,?,?,?,?)'
      )
      ins.run(pid, procId, '2026-02-01', 100, '米')
      let threw = false
      try {
        ins.run(pid, procId, '2026-02-01', 50, '米')
      } catch {
        threw = true
      }
      assert(threw, '同日同工序重复日报未被拦截')
    })

    console.log('\n[5] CHECK 约束（数值合法性）')
    check('设备数量 CHECK(quantity > 0) 生效', () => {
      let threw = false
      try {
        db.prepare('INSERT INTO equipment (project_id,name,unit,quantity) VALUES (?,?,?,?)').run(pid, '零数量设备', '台', 0)
      } catch {
        threw = true
      }
      assert(threw, 'quantity=0 未被拒绝')
    })
    check('设备单价 CHECK(unit_price >= 0) 生效', () => {
      let threw = false
      try {
        db.prepare('INSERT INTO equipment (project_id,name,unit,quantity,unit_price) VALUES (?,?,?,?,?)').run(
          pid, '负单价设备', '台', 1, -5
        )
      } catch {
        threw = true
      }
      assert(threw, 'unit_price=-5 未被拒绝')
    })
    // 注：项目/设备状态等枚举字段的合法性由 service 层 ENUM 字典校验（已在端到端测试覆盖），
    // DDL 层不设 CHECK，便于后续扩展枚举值。
    check('枚举字段由 service 层校验（DDL 不限）', () => {
      const ok = insProject.run('PRJ-X-001', '自定义状态', 'x', '2026-10-01', '2026-12-31', '待复核', 'x')
      assert(Number(ok.lastInsertRowid) > 0, 'DDL 层不应拦截枚举值')
    })

    console.log('\n[6] 日常备品（project_id 为空）')
    check('备品的「同名同型号」唯一约束生效', () => {
      let threw = false
      try {
        db.prepare('INSERT INTO equipment (project_id,name,unit,quantity) VALUES (NULL,?,?,?)').run('备品绝缘胶带', '卷', 1)
      } catch {
        threw = true
      }
      assert(threw, '备品重复插入未被拦截（唯一索引可能没带上 IFNULL(project_id,0)）')
    })
    check('备品与外键约束共存（非法 project_id 仍被拒绝）', () => {
      let threw = false
      try {
        db.prepare('INSERT INTO equipment (project_id,name,unit,quantity) VALUES (?,?,?,?)').run(88888, '假项目设备', '台', 1)
      } catch {
        threw = true
      }
      assert(threw, '非法 project_id 未被拒绝')
    })

    console.log('\n[7] 级联删除')
    db.pragma('foreign_keys = ON')
    db.prepare('DELETE FROM project WHERE id=?').run(pid)
    check('删除项目后设备级联清空', () => {
      const left = (db.prepare('SELECT COUNT(*) AS c FROM equipment WHERE project_id=?').get(pid) as any).c
      assert(left === 0, `残留设备 ${left} 条`)
    })
    check('删除项目后工序级联清空', () => {
      const left = (db.prepare('SELECT COUNT(*) AS c FROM process WHERE project_id=?').get(pid) as any).c
      assert(left === 0, `残留工序 ${left} 条`)
    })
    check('删除项目不影响日常备品', () => {
      const left = (db.prepare('SELECT COUNT(*) AS c FROM equipment WHERE project_id IS NULL').get() as any).c
      assert(left === 1, `备品被误删，剩 ${left} 条`)
    })

    db.close()

    // ------------------------------------------------------------------
    console.log('\n[8] 老库升级：v2 → v3（equipment.project_id 放开为可空）')
    const legacyPath = path.join(TEST_DIR, 'legacy-v2.db')
    const legacy = new Database(legacyPath)
    legacy.pragma('foreign_keys = ON')
    // 复刻 v2 时代的表结构：project_id NOT NULL，唯一索引不用 IFNULL
    legacy.exec(`
      CREATE TABLE project (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, manager TEXT NOT NULL,
        start_date TEXT NOT NULL, plan_end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '未开工', folder_path TEXT
      );
      CREATE TABLE equipment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        name TEXT NOT NULL, model TEXT, unit TEXT NOT NULL DEFAULT '台',
        quantity REAL NOT NULL CHECK(quantity > 0), unit_price REAL DEFAULT 0,
        arrival_status TEXT NOT NULL DEFAULT '未到货',
        accept_status TEXT NOT NULL DEFAULT '未验收',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE UNIQUE INDEX uk_equip_natural ON equipment(project_id, name, IFNULL(model,''));
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta(key,value) VALUES ('schema_version','2');
      INSERT INTO project (code,name,manager,start_date,plan_end_date)
        VALUES ('LEGACY-1','老库项目','老王','2026-01-01','2026-12-31');
      INSERT INTO equipment (project_id,name,model,quantity,unit_price)
        VALUES (1,'老设备','M-1',3,120);
      INSERT INTO equipment (project_id,name,model,quantity)
        VALUES (1,'老设备2',NULL,1);
    `)
    migrateSchema(legacy)
    check('升级后 project_id 允许为空', () => {
      const cols = legacy.prepare('PRAGMA table_info(equipment)').all() as any[]
      const pidCol = cols.find((c) => c.name === 'project_id')
      assert(pidCol && pidCol.notnull === 0, 'project_id 仍是 NOT NULL')
    })
    check('升级保留原有设备数据', () => {
      const n = (legacy.prepare('SELECT COUNT(*) c FROM equipment').get() as any).c
      const row = legacy.prepare("SELECT * FROM equipment WHERE name='老设备'").get() as any
      assert(n === 2, `设备数 ${n} ≠ 2`)
      assert(row && row.quantity === 3 && row.unit_price === 120 && row.project_id === 1, '字段未被完整迁移')
    })
    check('升级保留指向项目的级联删除', () => {
      legacy.prepare('DELETE FROM project WHERE id=1').run()
      const n = (legacy.prepare('SELECT COUNT(*) c FROM equipment').get() as any).c
      assert(n === 0, `级联删除失效，残留 ${n} 条`)
    })
    check('升级后 schema_version 升到 3', () => {
      const v = (legacy.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as any).value
      assert(v === '3', 'schema_version=' + v)
    })
    check('升级后可插入日常备品并受唯一约束', () => {
      const ins = legacy.prepare('INSERT INTO equipment (project_id,name,unit,quantity) VALUES (NULL,?,?,?)')
      ins.run('备品螺丝', '个', 100)
      let threw = false
      try {
        ins.run('备品螺丝', '个', 1)
      } catch {
        threw = true
      }
      assert(threw, '升级后备品重复未被拦截')
    })
    check('迁移可重复执行（幂等）', () => {
      migrateSchema(legacy)
      const cols = legacy.prepare('PRAGMA table_info(equipment)').all() as any[]
      assert(cols.find((c) => c.name === 'project_id')?.notnull === 0, '重复迁移后结构被破坏')
    })
    legacy.close()
  } catch (e: any) {
    fail++
    steps.push({ name: '冒烟测试执行异常', ok: false, extra: e?.message })
  }

  console.log('\n===== 冒烟测试结果 =====')
  for (const s of steps) {
    console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}${s.extra ? '  → ' + s.extra : ''}`)
  }
  console.log(`\n  合计：${pass} 通过 / ${fail} 失败`)
  console.log(fail === 0 ? '\nSMOKE_ALL_PASS\n' : '\nSMOKE_HAS_FAILURE\n')

  setTimeout(() => app.quit(), 200)
}

/** 演示数据填充 + 各页面截图 */
function runDemoSeed(win: BrowserWindow) {
  const shotDir = process.env.SHOT_DIR || path.join(APP_ROOT, 'screenshots')
  if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true })
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const capture = async (name: string) => {
    try {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(shotDir, `${name}.png`), img.toPNG())
      console.log(`[demo] 截图 ${name}.png`)
    } catch (e) {
      console.error(`[demo] 截图失败 ${name}`, e)
    }
  }

  win.webContents.once('did-finish-load', async () => {
    await wait(2500)
    try {
      const seedResult = await win.webContents.executeJavaScript(`
        (async () => {
          const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0,10) }
          const log = []

          // ---- 项目 1：配电室改造（施工中，进度过半）----
          const p1 = await window.api.project.create({
            code: 'PRJ-2026-001', name: '3#配电室改造工程', manager: '张建国',
            address: '城东工业园区 3 号厂房', owner_unit: '城东制造有限公司',
            build_unit: '恒信电力安装工程公司', supervise_unit: '中正监理咨询',
            phone: '13800138000', contract_amount: 1860000,
            start_date: d(-60), plan_end_date: d(60), status: '施工中',
          })
          log.push('项目1 id=' + p1.id)

          const equip1 = [
            ['高压开关柜','KYN28-12','AH1','正泰','华东电气','台',6,38000,'已到货','合格'],
            ['干式变压器','SCB13-1000','T1','特变电工','华东电气','台',2,156000,'已到货','合格'],
            ['低压配电柜','GGD-2000A','AA1','正泰','华东电气','套',8,42000,'部分到货','未验收'],
            ['电力电缆','YJV22-8.7/15kV-3x240','—','远东电缆','远东电缆','米',1200,286,'已到货','合格'],
            ['接地扁钢','-40x4 镀锌','—','华通金属','华通金属','米',600,28,'未到货','未验收'],
            ['母线槽','CMC-2500A','—','施耐德','施耐德经销','米',80,1650,'未到货','未验收'],
            ['电流互感器','LZZBJ9-10','TA1','正泰','华东电气','只',12,680,'已到货','不合格'],
          ]
          for (const [name, model, tag, brand, sup, unit, qty, price, arr, acc] of equip1) {
            await window.api.equipment.create({
              project_id: p1.id, name, model, tag_no: tag, brand, supplier: sup,
              unit, quantity: qty, unit_price: price,
              arrival_status: arr, accept_status: acc,
              actual_arrival_date: arr === '未到货' ? null : (arr === '部分到货' ? d(-18) : d(-30)),
              contract_arrival_date: arr === '未到货' ? d(-20) : d(-38),
              location: arr === '未到货' ? '—' : '现场仓库',
            })
          }

          const procs1 = [
            ['土建基础施工', 1, '项', 1, '已完成', 12, -60, -45],
            ['电缆桥架安装', 1, '米', 320, '已完成', 10, -45, -25],
            ['高压柜就位安装', 6, '台', 6, '已完成', 15, -25, -10],
            ['二次接线', 1, '项', 1, '进行中', 20, -10, 15],
            ['低压柜就位安装', 8, '套', 3, '进行中', 12, -8, 20],
            ['变压器安装调试', 2, '台', 0, '未开始', 15, 5, 30],
            ['接地系统施工', 600, '米', 0, '未开始', 8, 10, 40],
            ['系统联调送电', 1, '项', 0, '未开始', 20, 40, 60],
          ]
          const procIds = []
          for (const [name, qty, unit, , status, weight, s, e] of procs1) {
            const pr = await window.api.process.create({
              project_id: p1.id, name, plan_qty: qty, qty_unit: unit,
              plan_start: d(s), plan_end: d(e), weight, status,
              owner: ['王师傅','李工','赵班长'][procIds.length % 3],
            })
            procIds.push(pr.id)
          }

          // 日报（让前两个工序完成、第三/四个进行中）
          await window.api.report.create({ project_id: p1.id, process_id: procIds[0], report_date: d(-50), day_qty: 1, unit: '项', weather: '晴', worker_count: 6, recorder: '张建国', site_note: '基础浇筑完成，养护中' })
          await window.api.report.create({ project_id: p1.id, process_id: procIds[1], report_date: d(-40), day_qty: 180, unit: '米', weather: '多云', worker_count: 8, recorder: '李工' })
          await window.api.report.create({ project_id: p1.id, process_id: procIds[1], report_date: d(-30), day_qty: 140, unit: '米', weather: '阴', worker_count: 8, recorder: '李工' })
          await window.api.report.create({ project_id: p1.id, process_id: procIds[2], report_date: d(-15), day_qty: 4, unit: '台', weather: '晴', worker_count: 10, recorder: '赵班长' })
          await window.api.report.create({ project_id: p1.id, process_id: procIds[2], report_date: d(-12), day_qty: 2, unit: '台', weather: '晴', worker_count: 10, recorder: '赵班长', site_note: '柜体就位完成，等待二次接线' })
          await window.api.report.create({ project_id: p1.id, process_id: procIds[3], report_date: d(-5), day_qty: 0.4, unit: '项', weather: '小雨', worker_count: 6, recorder: '王师傅' })
          await window.api.report.create({ project_id: p1.id, process_id: procIds[4], report_date: d(-3), day_qty: 3, unit: '套', weather: '晴', worker_count: 8, recorder: '李工' })

          // 里程碑
          await window.api.milestone.create({ project_id: p1.id, name: '高压柜就位完成', plan_date: d(-10), actual_date: d(-12), status: '已达成', description: '6 台高压柜全部就位并验收' })
          await window.api.milestone.create({ project_id: p1.id, name: '低压系统安装完成', plan_date: d(20), status: '进行中' })
          await window.api.milestone.create({ project_id: p1.id, name: '系统送电验收', plan_date: d(60), status: '未开始' })

          // 问题
          await window.api.issue.create({ project_id: p1.id, process_id: procIds[2], description: '高压柜基础预埋件位置偏差 15mm，需调整', severity: '重要', reporter: '中正监理', report_date: d(-20), owner: '王师傅', due_date: d(5), status: '处理中' })
          await window.api.issue.create({ project_id: p1.id, process_id: procIds[1], description: '桥架跨接线缺失 3 处，不符合规范要求', severity: '一般', reporter: '张建国', report_date: d(-28), owner: '李工', due_date: d(-8), status: '已闭环', solution: '已补装跨接线并复查合格', close_date: d(-10) })
          await window.api.issue.create({ project_id: p1.id, process_id: procIds[3], description: '部分二次线缆规格与图纸不符，需重新采购', severity: '紧急', reporter: '赵班长', report_date: d(-4), owner: '采购部', due_date: d(-1), status: '待处理' })

          // ---- 项目 2：生产线扩产（未开工，物资已开始采购）----
          const p2 = await window.api.project.create({
            code: 'PRJ-2026-002', name: '2#生产线电气扩容', manager: '刘明',
            owner_unit: '城东制造有限公司', build_unit: '恒信电力安装工程公司',
            start_date: d(15), plan_end_date: d(135), status: '未开工',
            contract_amount: 960000,
          })
          const equip2 = [
            ['PLC控制系统','S7-1500','PLC1','西门子','西门子代理','套',1,168000,-12,'未到货','未验收'],
            ['动力配电箱','XL-21','AP1','正泰','华东电气','台',12,6800,-6,'未到货','未验收'],
            ['变频控制柜','ACS880-37','AC1','ABB','ABB代理','台',4,86000,2,'未到货','未验收'],
            ['低压电力电缆','YJV-0.6/1kV-4x185','—','远东电缆','远东电缆','米',860,168,4,'未到货','未验收'],
          ]
          for (const [name, model, tag, brand, sup, unit, qty, price, off, arr, acc] of equip2) {
            await window.api.equipment.create({
              project_id: p2.id, name, model, tag_no: tag, brand, supplier: sup,
              unit, quantity: qty, unit_price: price,
              arrival_status: arr, accept_status: acc,
              actual_arrival_date: arr === '未到货' ? null : d(off),
              contract_arrival_date: d(off),
              location: '—',
            })
          }

          // ---- 项目 3：已竣工 ----
          const p3 = await window.api.project.create({
            code: 'PRJ-2025-018', name: '厂区照明系统改造', manager: '陈伟',
            owner_unit: '城东制造有限公司', build_unit: '恒信电力安装工程公司',
            start_date: d(-200), plan_end_date: d(-80), actual_end_date: d(-85),
            status: '已竣工', contract_amount: 320000,
          })
          for (const [name, model, tag, brand, sup, unit, qty, price] of [
            ['LED投光灯','TG-200W','—','飞利浦','明辉照明','套',180,860],
            ['照明配电箱','XL-21照明','AL1','正泰','明辉照明','台',6,4200],
          ]) {
            await window.api.equipment.create({
              project_id: p3.id, name, model, tag_no: tag, brand, supplier: sup,
              unit, quantity: qty, unit_price: price,
              arrival_status: '已到货', accept_status: '合格',
              actual_arrival_date: d(-150), contract_arrival_date: d(-160),
              location: '已移交业主',
            })
          }
          const pr3 = await window.api.process.create({
            project_id: p3.id, name: '灯具安装', plan_qty: 180, qty_unit: '套',
            plan_start: d(-160), plan_end: d(-100), weight: 5, status: '已完成',
          })
          await window.api.report.create({ project_id: p3.id, process_id: pr3.id, report_date: d(-110), day_qty: 180, unit: '套', weather: '晴', worker_count: 5, recorder: '陈伟' })

          // ---- 日常备品：不归属任何项目的公共备件 ----
          const commonItems = [
            ['绝缘胶带', 'J-20', '—', '3M', '丙五金行', '卷', 50, 8, null, null, '未到货', '未验收', '备件库A'],
            ['行程开关', 'LX19-111', '—', '正泰', '丙五金行', '个', 30, 26, -40, -45, '已到货', '合格', '备件库B'],
            ['热继电器', 'JR36-20', '—', '施耐德', '华东电气', '个', 12, 58, null, 3, '未到货', '未验收', '备件库B'],
          ]
          for (const [name, model, tag, brand, sup, unit, qty, price, actOff, conOff, arr, acc, loc] of commonItems) {
            await window.api.equipment.create({
              project_id: null, name, model, tag_no: tag, brand, supplier: sup,
              unit, quantity: qty, unit_price: price,
              arrival_status: arr, accept_status: acc,
              actual_arrival_date: actOff === null ? null : d(actOff),
              contract_arrival_date: conOff === null ? null : d(conOff),
              location: loc,
            })
          }
          log.push('日常备品 ' + commonItems.length + ' 条')

          return { ok: true, p1: p1.id, folder1: p1.folder_path || null, projects: 3, log }
        })()
      `)
      console.log('[demo] 数据填充完成:', JSON.stringify(seedResult))

      // 往资料文件夹里放几个示例文件，让「资料文件夹」页签有真实内容可展示
      if (seedResult.folder1) {
        const samples: [string, string][] = [
          ['01-图纸/设计图纸/3#配电室一次系统图.dwg', '【示例】AutoCAD 图纸占位文件'],
          ['01-图纸/设计图纸/配电室平面布置图.pdf', '【示例】PDF 图纸占位文件'],
          ['01-图纸/变更图纸/低压柜排列变更单-01.pdf', '【示例】变更单占位文件'],
          ['02-程序/PLC程序/S7-1500_主程序_V1.2.zip', '【示例】PLC 程序备份占位'],
          ['02-程序/触摸屏组态/HMI画面组态备份.zip', '【示例】组态备份占位'],
          ['02-程序/变频器与仪表参数/变频器参数表.xlsx', '【示例】参数表占位文件'],
          ['03-设备资料/说明书与样本/KYN28-12开关柜说明书.pdf', '【示例】说明书占位文件'],
          ['03-设备资料/合格证与检测报告/变压器出厂试验报告.pdf', '【示例】试验报告占位文件'],
          ['04-施工资料/现场照片/高压柜就位-01.jpg', '【示例】现场照片占位文件'],
          ['04-施工资料/施工方案与技术交底/电气安装施工方案.docx', '【示例】施工方案占位文件'],
          ['05-验收竣工/试验报告/接地电阻测试报告.pdf', '【示例】试验报告占位文件'],
          ['06-往来文件/收文/监理通知单-007.pdf', '【示例】往来文件占位'],
        ]
        for (const [rel, text] of samples) {
          try {
            const full = path.join(seedResult.folder1, rel)
            fs.mkdirSync(path.dirname(full), { recursive: true })
            fs.writeFileSync(full, text, 'utf8')
          } catch { /* 示例文件写不了不影响截图 */ }
        }
        console.log('[demo] 已写入示例资料文件')
      }

      // ==== 截图：依次访问各页面 ====
      await wait(800)
      await capture('D1-仪表盘')

      await win.webContents.executeJavaScript(`location.hash = '#/projects'`)
      await wait(1200)
      await capture('D2-项目列表')

      await win.webContents.executeJavaScript(`location.hash = '#/projects/' + ${seedResult.p1}`)
      await wait(1500)
      await capture('D3-项目详情-设备')

      // 切到工序 Tab
      await win.webContents.executeJavaScript(`
        (() => { const t = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(x => x.innerText.includes('工序进度')); if (t) t.click(); return !!t })()
      `)
      await wait(1400)
      await capture('D4-项目详情-工序')

      // 展开一个工序看日报历史
      await win.webContents.executeJavaScript(`
        (() => { const b = document.querySelector('.ant-table-row-expand-icon'); if (b) { b.click(); return true } return false })()
      `)
      await wait(1000)
      await capture('D5-工序日报历史')

      // 问题 Tab
      await win.webContents.executeJavaScript(`
        (() => { const t = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(x => x.innerText.includes('问题记录')); if (t) t.click(); return !!t })()
      `)
      await wait(1400)
      await capture('D6-问题记录')

      // 里程碑 Tab
      await win.webContents.executeJavaScript(`
        (() => { const t = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(x => x.innerText.includes('里程碑')); if (t) t.click(); return !!t })()
      `)
      await wait(1400)
      await capture('D7-里程碑')

      // 资料文件夹 Tab
      await win.webContents.executeJavaScript(`
        (() => { const t = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(x => x.innerText.includes('资料文件夹')); if (t) t.click(); return !!t })()
      `)
      await wait(1600)
      await capture('D8-项目详情-资料文件夹')

      // 进入「01-图纸 / 设计图纸」子目录，展示文件列表
      const clickRow = (label: string) => win.webContents.executeJavaScript(`
        (() => {
          const rows = Array.from(document.querySelectorAll('.ant-table-row'))
          const r = rows.find(x => x.innerText.includes(${JSON.stringify(label)}))
          const a = r && r.querySelector('a')
          if (a) { a.click(); return true }
          return false
        })()
      `)
      await clickRow('01-图纸')
      await wait(1500)
      await clickRow('设计图纸')
      await wait(1500)
      await capture('D9-资料文件夹-子目录')

      // 资料文件夹 → 「最近改动」视图：展示直接丢进文件夹的文件与改动时间
      await win.webContents.executeJavaScript(`
        (() => {
          const el = Array.from(document.querySelectorAll('.ant-segmented-item-label'))
            .find(x => x.innerText.trim() === '最近改动')
          if (el) { el.click(); return true }
          return false
        })()
      `)
      await wait(1700)
      await capture('D10-资料文件夹-最近改动')

      // 设置页：资料文件夹配置
      await win.webContents.executeJavaScript(`location.hash = '#/settings'`)
      await wait(1600)
      await capture('D11-设置-资料文件夹')

      // 物料管理：跨项目总表（列较多，截图时最大化以便一屏看全关键列）
      win.maximize()
      await win.webContents.executeJavaScript(`location.hash = '#/materials'`)
      await wait(2000)
      await capture('D12-物料管理-总表')

      // 物料管理：到货监控（只看逾期未到货）
      await win.webContents.executeJavaScript(`
        (() => {
          const el = Array.from(document.querySelectorAll('.ant-segmented-item-label'))
            .find(x => x.innerText.trim() === '逾期未到货')
          if (el) { el.click(); return true }
          return false
        })()
      `)
      await wait(1500)
      await capture('D13-物料管理-到货监控')

      // 物料管理：按项目汇总
      await win.webContents.executeJavaScript(`
        (() => { const t = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(x => x.innerText.includes('按项目汇总')); if (t) t.click(); return !!t })()
      `)
      await wait(1700)
      await capture('D14-物料管理-按项目汇总')

      // 物料管理：按供货商汇总（催货视角）
      await win.webContents.executeJavaScript(`
        (() => { const t = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(x => x.innerText.includes('按供货商汇总')); if (t) t.click(); return !!t })()
      `)
      await wait(1700)
      await capture('D15-物料管理-按供货商汇总')

      // 物料管理：日常备品（不归属任何项目的公共备件）
      await win.webContents.executeJavaScript(`
        (() => { const t = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(x => x.innerText.includes('物料总表')); if (t) t.click(); return !!t })()
      `)
      await wait(1200)
      await win.webContents.executeJavaScript(`
        (() => {
          const el = Array.from(document.querySelectorAll('.ant-segmented-item-label')).find(x => x.innerText.trim() === '全部')
          if (el) { el.click(); return true }
          return false
        })()
      `)
      await wait(900)
      await win.webContents.executeJavaScript(`
        (() => {
          const sel = document.querySelectorAll('.ant-select-selector')[0]
          if (!sel) return false
          sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
          return true
        })()
      `)
      await wait(700)
      const commonPicked = await win.webContents.executeJavaScript(`
        (() => {
          const opt = Array.from(document.querySelectorAll('.ant-select-item-option'))
            .find(x => (x.innerText || '').includes('日常备品'))
          if (opt) { opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true }
          return false
        })()
      `)
      console.log('[demo] 备品筛选选中:', commonPicked)
      await wait(1600)
      await capture('D16-物料管理-日常备品')

      // 工序甘特视图（二期 M3-5）：回到项目详情 → 工序 Tab → 甘特视图
      await win.webContents.executeJavaScript(`location.hash = '#/projects/' + ${seedResult.p1}`)
      await wait(1600)
      await win.webContents.executeJavaScript(`
        (() => { const t = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(x => x.innerText.includes('工序进度')); if (t) t.click(); return !!t })()
      `)
      await wait(1500)
      const ganttPicked = await win.webContents.executeJavaScript(`
        (() => {
          const el = Array.from(document.querySelectorAll('.ant-segmented-item-label'))
            .find(x => x.innerText.trim().includes('甘特'))
          if (el) { el.click(); return true }
          return false
        })()
      `)
      console.log('[demo] 甘特视图切换:', ganttPicked)
      await wait(2200)
      await capture('D17-工序甘特视图')

      // 回仪表盘（有数据后的效果）
      win.unmaximize()
      await wait(500)
      await win.webContents.executeJavaScript(`location.hash = '#/dashboard'`)
      await wait(2200)
      await capture('D18-仪表盘-有数据')
    } catch (e) {
      console.error('[demo] 执行异常:', e)
    }
    console.log('[demo] 完成')
    setTimeout(() => app.quit(), 400)
  })
}

function registerAllIpc() {
  registerProjectIpc()
  registerEquipmentIpc()
  registerMaterialIpc()
  registerProcessIpc()
  registerReportIpc()
  registerMilestoneIpc()
  registerIssueIpc()
  registerAttachmentIpc()
  registerStatsIpc()
  registerExportIpc()
  registerBackupIpc()
  registerFolderIpc()

  // 通用：在文件管理器中定位文件
  ipcMain.handle('shell:showItemInFolder', (_e, fullPath: string) => {
    shell.showItemInFolder(fullPath)
    return true
  })
  ipcMain.handle('shell:openPath', async (_e, fullPath: string) => {
    const err = await shell.openPath(fullPath)
    return err === '' ? { ok: true } : { ok: false, message: err }
  })
  ipcMain.handle('app:getInfo', () => ({
    root: APP_ROOT,
    dataRoot: resolveDataRoot(),
    dbPath: getDatabasePath(),
    version: app.getVersion(),
    attachmentsDir: path.join(resolveDataRoot(), 'attachments'),
  }))
  ipcMain.handle('dialog:selectDirectory', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}

app.whenReady().then(() => {
  try {
    // 注册 app:// 协议（必须在窗口创建前）
    registerAppProtocol()

    // 确保数据目录存在（打包态为 %APPDATA%，开发态为项目根/data）
    const dataDir = resolveDataRoot()
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    const attachDir = path.join(dataDir, 'attachments')
    if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true })

    initDatabase()
    registerAllIpc()
    createWindow()
    startAutoBackupJob(() => mainWindow)
  } catch (e: any) {
    // 桌面应用无控制台，启动期异常必须弹窗告知，否则表现为「双击没反应」。
    console.error('[main] 启动失败:', e)
    dialog.showErrorBox('电气项目管理台 启动失败', `${e?.message || e}\n\n${e?.stack || ''}`)
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前关闭资料文件夹的磁盘监视句柄，避免残留
app.on('before-quit', () => {
  try { unwatchAllProjectFolders() } catch { /* ignore */ }
})
