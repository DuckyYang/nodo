import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') },
        external: [
          'electron',
          'express',
          'cors',
          'mysql2',
          'typeorm',
          'reflect-metadata',
          'bcryptjs',
          'jsonwebtoken',
          'electron-store',
          'axios',
          'langchain',
          '@langchain/core',
          '@langchain/openai',
          '@langchain/langgraph',
          '@langchain/langgraph-checkpoint',
          '@langchain/langgraph-checkpoint-postgres',
          'pg',
          'deepagents'
        ]
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'electron/server/_shared'),
        '@main': resolve(__dirname, 'electron')
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    css: {
      // 使用 sass 现代 API，避免 legacy-js-api 弃用警告
      preprocessorOptions: {
        scss: { api: 'modern' }
      }
    },
    plugins: [
      vue(),
      AutoImport({
        resolvers: [ElementPlusResolver()],
        imports: ['vue', 'vue-router', 'pinia', 'vue-i18n']
      }),
      Components({
        resolvers: [ElementPlusResolver()]
      })
    ],
    server: {
      port: 5173
    }
  }
})
