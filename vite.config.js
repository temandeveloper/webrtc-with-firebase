import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        subpage: resolve(__dirname, 'subpage.html'),
        page: resolve(__dirname, 'page.html'),
      },
    },
  },
})