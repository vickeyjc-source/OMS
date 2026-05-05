import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const backendPort = process.env.BACKEND_PORT || process.env.VITE_BACKEND_PORT || '8081'

// Plugin: serve portal landing page at "/" in dev, redirect to /app
function portalPlugin() {
  return {
    name: 'ciflux-portal',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          const portalPath = path.resolve(__dirname, '..', 'portal', 'index.html')
          if (fs.existsSync(portalPath)) {
            res.setHeader('Content-Type', 'text/html')
            res.end(fs.readFileSync(portalPath, 'utf-8'))
            return
          }
        }
        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [
    react({
      include: '**/*.{jsx,js}',
    }),
    portalPlugin(),
  ],
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.[jt]sx?$/,
    exclude: []
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx'
      }
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'build',
    emptyOutDir: true
  }
})
