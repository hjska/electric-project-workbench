/**
 * 构建脚本：类型检查 → vite 构建 → 复制 schema.sql 到产物目录
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NODE = process.execPath

function run(cmd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}

// 1. 类型检查
run(`"${NODE}" node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`)
run(`"${NODE}" node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json`)

// 2. vite 构建（renderer + main + preload）
run(`"${NODE}" node_modules/vite/bin/vite.js build`)

// 3. 复制 schema.sql 到 dist-electron
const src = path.join(ROOT, 'electron', 'db', 'schema.sql')
const destDir = path.join(ROOT, 'dist-electron')
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
fs.copyFileSync(src, path.join(destDir, 'schema.sql'))
console.log('\n✓ 已复制 schema.sql → dist-electron/schema.sql')
console.log('\n✅ 构建完成\n')
