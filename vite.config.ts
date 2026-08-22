import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { ServerResponse } from 'node:http'

// wllama's multi-threaded WASM build needs SharedArrayBuffer, which requires
// cross-origin isolation (COOP/COEP). Same headers as the official wllama demo.
function crossOriginIsolation(): Plugin {
  const setHeaders = (res: ServerResponse) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  }
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        setHeaders(res)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        setHeaders(res)
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/wllama-demo-react/' : '/',
  plugins: [react(), crossOriginIsolation()],
})
