/**
 * GUI 自动化验证：启动应用 → 等待渲染 → 截图 → 自动退出
 * 运行：node scripts/gui-verify.cjs
 * 产物：screenshots/*.png
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SHOT_DIR = path.join(ROOT, 'screenshots')

if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true })

// 清理旧截图
for (const f of fs.readdirSync(SHOT_DIR)) fs.unlinkSync(path.join(SHOT_DIR, f))

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.GUI_VERIFY = '1'
env.SHOT_DIR = SHOT_DIR

console.log('[verify] 启动 Electron...')
const child = spawn(ELECTRON, [ROOT], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => { stdout += d.toString(); process.stdout.write('[app] ' + d.toString()) })
child.stderr.on('data', (d) => { stderr += d.toString() })

const TIMEOUT = 45000
const timer = setTimeout(() => {
  console.log('\n[verify] 超时，强制结束')
  if (!child.killed) child.kill()
}, TIMEOUT)

child.on('exit', (code) => {
  clearTimeout(timer)
  console.log(`\n[verify] 进程退出，code=${code}`)

  const shots = fs.existsSync(SHOT_DIR) ? fs.readdirSync(SHOT_DIR) : []
  console.log(`[verify] 截图数量：${shots.length}`)
  shots.forEach((s) => {
    const size = fs.statSync(path.join(SHOT_DIR, s)).size
    console.log(`  - ${s} (${(size / 1024).toFixed(1)} KB)`)
  })

  // 输出错误摘要（过滤无害的 GPU 警告）
  const errLines = stderr.split('\n').filter((l) =>
    l.trim() &&
    !l.includes('registration_protocol_win') &&
    !l.includes('GPU') &&
    !l.includes('gpu_') &&
    !l.includes('dxdiag') &&
    !l.includes('DevTools'),
  )
  if (errLines.length) {
    console.log('\n[verify] 关键错误：')
    errLines.slice(0, 20).forEach((l) => console.log('  ' + l))
  }

  process.exit(shots.length > 0 ? 0 : 1)
})
