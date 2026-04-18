import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  base: '/mallet/',
  build: {
    outDir: '../mallet',
    emptyOutDir: true,
  },
  server: {
    allowedHosts: ['dev.artanis.ai'],
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'serve-parent-images',
      configureServer(server) {
        // Serve /img/* from the parent directory (matches production GitHub Pages layout)
        server.middlewares.use((req, res, next) => {
          // Redirect /mallet to /mallet/
          if (req.url === '/mallet') {
            res.writeHead(301, { Location: '/mallet/' })
            res.end()
            return
          }
          if (req.url?.startsWith('/img/')) {
            const filePath = path.resolve(__dirname, '..', req.url.slice(1))
            if (fs.existsSync(filePath)) {
              const ext = path.extname(filePath).slice(1)
              const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon', webp: 'image/webp' }
              res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
              fs.createReadStream(filePath).pipe(res)
              return
            }
          }
          next()
        })
      },
    },
  ],
})
