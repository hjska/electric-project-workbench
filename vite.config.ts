import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'node:path'

// 主进程与 preload 统一输出 CommonJS：
// 通过在各自的 vite config 中显式设置 build.lib 的 formats 保证格式正确。
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
            lib: {
              entry: 'electron/main.ts',
              formats: ['cjs'],
              fileName: () => 'main.cjs',
            },
            rollupOptions: {
              // 只把「无法打包的原生模块」保留为运行时 require：
              //   electron         —— 由运行环境注入
              //   better-sqlite3   —— 含 .node 二进制，必须外部加载
              // 其余依赖（如 xlsx 及其 7 个传递依赖）一律打包进 main.cjs，
              // 避免打包时漏带导致启动报「Cannot find module」。
              external: ['electron', 'better-sqlite3'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        // 只把体量最大、无循环依赖的 echarts 单独拆出；
        // react/antd 不手动拆 chunk，避免跨 chunk 循环引用导致运行时 undefined。
        manualChunks(id) {
          if (id.includes('node_modules/echarts')) return 'echarts'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5178,
  },
})
