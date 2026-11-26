import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// `MOCK_API=1` runs the front end against scripts/mock-api.mjs, which lets the
// UI be exercised without PostgreSQL. Vite proxies /api to the mock server, so
// the browser only ever talks to the dev server (works behind any preview
// hostname). The production/Docker setup is unaffected: it passes
// VITE_API_BASE_URL explicitly and never sets MOCK_API.
//
// `DEV_API_PROXY=1` proxies /api to a real backend that was started the same
// way the front end was (`API_PROXY_TARGET` points at it).
//
// When VITE_API_BASE_URL is a same-origin relative path (/api) the browser can
// only be answered correctly through a proxy. Starting Vite without one used
// to resolve /api/... to the SPA HTML shell (200 text/html) for GETs and to
// 404 for everything else, which looked like "the backend is broken". Fail
// loudly instead.
const resolveApiBaseUrl = (env) => String(env.VITE_API_BASE_URL || process.env.VITE_API_BASE_URL || '').trim()

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const useMockApi =
    process.env.MOCK_API === '1' ||
    process.env.DEV_API_PROXY === '1' ||
    Boolean(process.env.API_PROXY_TARGET) ||
    Boolean(env.API_PROXY_TARGET)
  const proxyTarget =
    process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || process.env.MOCK_API_TARGET || 'http://127.0.0.1:8000'

  if (command === 'serve' && !useMockApi) {
    const apiBaseUrl = resolveApiBaseUrl(env)
    if (apiBaseUrl.startsWith('/') && !apiBaseUrl.startsWith('//')) {
      throw new Error(
        `VITE_API_BASE_URL is "${apiBaseUrl}" (a same-origin path) but no /api proxy is configured.\n` +
          'Every API call would hit the Vite dev server and fail with 404 (or return the HTML shell).\n' +
          'Fix one of these:\n' +
          '  • npm run dev:mock            (in-memory mock API)\n' +
          '  • DEV_API_PROXY=1 API_PROXY_TARGET=http://127.0.0.1:8000 npm run dev\n' +
          '  • set VITE_API_BASE_URL to the full backend origin, e.g. http://127.0.0.1:8000',
      )
    }
  }

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      ...(useMockApi
        ? {
            proxy: {
              '/api': {
                target: proxyTarget,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
              },
            },
          }
        : {}),
    },
  }
})
