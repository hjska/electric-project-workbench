/**
 * 端到端业务链路验证（在真实 Electron 渲染进程中执行）
 * 通过 window.api 走完整 IPC → service → SQLite 链路
 *
 * 数据目录与资料文件夹都重定向到 data-test/ 沙箱：
 *   - DATA_ROOT            独立数据库，避免测试数据混进开发库 data/
 *   - PROJECT_FOLDER_ROOT  避免测试把目录建到用户真实的资料盘上
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SANDBOX = path.join(ROOT, 'data-test', 'projects')

// 每次从空库开始，断言才能用确切数字（不依赖历史遗留数据）
try { fs.rmSync(path.join(ROOT, 'data-test'), { recursive: true, force: true }) } catch { /* ignore */ }

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.E2E_VERIFY = '1'
env.DATA_ROOT = path.join(ROOT, 'data-test', 'db')
env.PROJECT_FOLDER_ROOT = SANDBOX

const child = spawn(ELECTRON, [ROOT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d.toString()) })
child.stderr.on('data', (d) => { out += d.toString() })

const timer = setTimeout(() => { if (!child.killed) child.kill(); console.log('\n[e2e] 超时') }, 150000)

child.on('exit', (code) => {
  clearTimeout(timer)
  console.log(`\n[e2e] 进程退出 code=${code}`)
  try { fs.rmSync(path.join(ROOT, 'data-test'), { recursive: true, force: true }) } catch { /* ignore */ }
  process.exit(out.includes('E2E_ALL_PASS') ? 0 : 1)
})
