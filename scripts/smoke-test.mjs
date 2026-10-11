/**
 * 数据层冒烟测试启动器。
 *
 * better-sqlite3 是按 Electron ABI 编译的原生模块，无法在纯 Node 下加载，
 * 因此本脚本改为拉起 Electron，由主进程内的 runSmokeTest() 执行断言。
 * 使用独立测试库 data-test/app.db，不污染正式数据。
 *
 * 运行：npm run test:smoke   （需先 npm run build）
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.SMOKE_TEST = '1'

const child = spawn(ELECTRON, [ROOT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
child.stdout.on('data', (d) => {
  out += d.toString()
  process.stdout.write(d.toString())
})
child.stderr.on('data', (d) => {
  const s = d.toString()
  if (!s.includes('DevTools') && !s.includes('GPU')) process.stderr.write(s)
})

const timer = setTimeout(() => {
  if (!child.killed) child.kill()
  console.log('\n[smoke] 超时')
}, 60000)

child.on('exit', (code) => {
  clearTimeout(timer)
  console.log(`\n[smoke] 进程退出 code=${code}`)
  process.exit(out.includes('SMOKE_ALL_PASS') ? 0 : 1)
})
