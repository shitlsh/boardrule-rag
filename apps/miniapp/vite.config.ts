import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  // 解决 towxml 中 require 用法的兼容问题
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})
