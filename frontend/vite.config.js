import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// `MOCK_API=1` runs the front end against scripts/mock-api.mjs, which lets the
// UI be exercised without PostgreSQL. Vite proxies /api to the mock server, so
// the browser only ever talks to the dev server (works behind any preview
// hostname). The production/Docker setup is unaffected: it passes
// VITE_API_BASE_URL explicitly and never sets MOCK_API.
const useMockApi = process.env.MOCK_API === '1'
const mockTarget = process.env.MOCK_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    ...(useMockApi
      ? {
          proxy: {
            '/api': {
              target: mockTarget,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, ''),
            },
          },
        }
      : {}),
  },
})
