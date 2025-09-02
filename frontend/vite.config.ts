import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { promises as fs } from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    {
      name: 'singlefile-dev-middleware',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/__singlefile', async (_req, res) => {
          try {
            const { build } = await import('vite')
            const rootDir = server.config.root || process.cwd()
            const outDir = path.join(rootDir, '.singlefile-dev')
            await build({
              root: rootDir,
              plugins: [react(), viteSingleFile()],
              build: {
                outDir,
                cssCodeSplit: false,
                assetsInlineLimit: 100000000,
                sourcemap: false,
                write: true,
                emptyOutDir: true,
                rollupOptions: {
                  input: path.join(rootDir, 'index.html')
                }
              }
            })
            const htmlPath = path.join(outDir, 'index.html')
            const html = await fs.readFile(htmlPath, 'utf8')
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(html)
          } catch (e: any) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end('Error generating single-file build: ' + (e?.message || e))
          }
        })
      }
    }
  ],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    sourcemap: false,
  }
})
