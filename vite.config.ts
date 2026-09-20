import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Offline after first load: precache the app shell, the engine, the opening book and the sounds.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,wav,wasm,json}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Chess Sensei',
        short_name: 'Chess Sensei',
        description: 'Play Stockfish at your level and review every game.',
        display: 'standalone',
        background_color: '#0e0f12',
        theme_color: '#0e0f12',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // The coach endpoint lives in scripts/serve.mjs (the Dock app's server); reach it from dev too.
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:5180' } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
