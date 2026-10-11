/**
 * 生成演示数据 + 截图，用于验证真实使用场景下的界面表现
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const SANDBOX = path.join(ROOT, 'data-demo')

// 每次从空库开始，否则第二次运行会撞「项目编号已存在」
try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch { /* ignore */ }

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DEMO_SEED = '1'
// 演示数据用独立数据目录，不污染开发库 data/
env.DATA_ROOT = SANDBOX
// 资料文件夹重定向到沙箱，避免演示数据在用户真实资料盘上建目录
env.PROJECT_FOLDER_ROOT = path.join(SANDBOX, 'projects')

const child = spawn(ELECTRON, [ROOT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d.toString()) })
child.stderr.on('data', (d) => { const s = d.toString(); out += s; process.stderr.write(s) })
const timer = setTimeout(() => { if (!child.killed) child.kill(); console.log('\n[demo] 超时') }, 120000)
child.on('exit', (c) => {
  clearTimeout(timer)
  console.log(`\n[demo] 退出 code=${c}`)
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch { /* ignore */ }
})
