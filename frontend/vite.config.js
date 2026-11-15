import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  envDir: '..',
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)([\\/]|$)/,
              priority: 10,
            },
            {
              name: 'leaflet',
              test: /[\\/]node_modules[\\/](leaflet|react-leaflet)([\\/]|$)/,
              priority: 5,
            },
            {
              name: 'charts',
              test: /[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)([\\/]|$)/,
              priority: 4,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
