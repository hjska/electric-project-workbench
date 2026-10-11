/**
 * 打包版端到端验证。
 *
 * 与 e2e-verify.cjs 的区别：本脚本验证的是**打包后的 exe**（而非开发态 Electron），
 * 即真正交付给用户的二进制文件。做法是启动打包好的应用并注入 E2E_VERIFY=1，
 * 主进程内已编译好的 runE2EVerify() 会走完整 IPC → service → SQLite 链路。
 *
 * 用法：node scripts/pkg-verify.cjs [打包输出目录，默认 release]
 *
 * 数据目录与资料文件夹都重定向到 data-test/ 沙箱：
 *   - DATA_ROOT            否则打包版会写进用户真实的 %APPDATA%，污染正式数据
 *   - PROJECT_FOLDER_ROOT  避免测试把目录建到用户真实的资料盘上
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const outDir = process.argv[2] || 'release'
const exe = path.join(ROOT, outDir, 'win-unpacked', '电气项目管理台.exe')

if (!fs.existsSync(exe)) {
  console.error(`[pkg] 未找到打包产物：${exe}`)
  console.error('[pkg] 请先执行 npm run dist')
  process.exit(1)
}

console.log(`[pkg] 目标：${exe}`)

// 每次从空库开始，断言才能用确切数字
try { fs.rmSync(path.join(ROOT, 'data-test'), { recursive: true, force: true }) } catch { /* ignore */ }

const env = { ...process.env }
// 这两个变量会让 Electron 以纯 Node 运行 / 拒绝启动，必须清除
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
env.E2E_VERIFY = '1'
// 数据目录重定向到沙箱，否则打包版会写进用户真实的 %APPDATA%
env.DATA_ROOT = path.join(ROOT, 'data-test', 'db-pkg')
// 资料文件夹重定向到项目内沙箱，避免测试污染用户真实资料盘
env.PROJECT_FOLDER_ROOT = path.join(ROOT, 'data-test', 'projects-pkg')

const child = spawn(exe, [], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
child.stdout.on('data', (d) => {
  out += d.toString()
  process.stdout.write(d.toString())
})
child.stderr.on('data', (d) => {
  const s = d.toString()
  // 过滤 Chromium 无关噪音
  if (!s.includes('registration_protocol') && !s.includes('CreateFile')) {
    process.stderr.write(s)
  }
})

const timer = setTimeout(() => {
  if (!child.killed) child.kill()
  console.log('\n[pkg] 超时')
}, 150000)

child.on('exit', (code) => {
  clearTimeout(timer)
  console.log(`\n[pkg] 进程退出 code=${code}`)
  try { fs.rmSync(path.join(ROOT, 'data-test'), { recursive: true, force: true }) } catch { /* ignore */ }
  process.exit(out.includes('E2E_ALL_PASS') ? 0 : 1)
})
