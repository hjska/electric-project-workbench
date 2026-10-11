import path from 'node:path'

/**
 * 统一的路径解析。
 *
 * 环境变量由主进程入口设置：
 *   APP_ROOT  —— 只读资源根（dist/ 前端产物、schema.sql 等）
 *   DATA_ROOT —— 可写数据根（数据库、附件、备份）
 *
 * 开发态：DATA_ROOT = <项目根>/data
 * 打包态：DATA_ROOT = app.getPath('userData')，即 %APPDATA%\<应用名>
 *
 * ⚠️ 必须以「函数」形式惰性读取 process.env：
 * ESM 的 import 会被提升到模块顶层优先执行，若在模块加载时就固化常量，
 * 会早于主进程入口给 process.env.DATA_ROOT 赋值，导致拿到错误路径。
 */
export function getAppRoot(): string {
  return process.env.APP_ROOT || process.cwd()
}

export function getDataRoot(): string {
  return process.env.DATA_ROOT || path.join(getAppRoot(), 'data')
}

/** 数据根下的子路径（惰性解析） */
export function dataPath(...segments: string[]): string {
  return path.join(getDataRoot(), ...segments)
}
