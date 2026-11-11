/**
 * Regression test for StrictMode session bootstrap + concurrent refresh single-flighting:
 *   1. Unauthenticated cold mount hits POST /auth/session once (HTTP 200) and renders LoginPage with 0 HTTP 4xx/5xx.
 *   2. Authenticated reload under <React.StrictMode> double-mount hits POST /auth/session once (not twice!),
 *      preserves the in-memory access token, and runs every startup GET with Bearer auth and 0 HTTP 401s.
 *   3. Expired in-memory JWT triggers one proactive POST /auth/refresh shared across parallel apiGet calls with 0 HTTP 401s.
 *   4. formatApiError surfaces backend request_id when present.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(__dirname, '..')

const nodeTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
  clearImmediate: globalThis.clearImmediate,
  queueMicrotask: globalThis.queueMicrotask,
}
GlobalRegistrator.register({ url: 'http://localhost:5173/', width: 1440, height: 900 })
Object.assign(globalThis, nodeTimers)
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
}

const makeJwt = (expEpochSeconds) => {
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    user_id: 1,
    username: 'admin',
    exp: expEpochSeconds,
  })}.sig`
}

const mockUser = {
  id: 1,
  full_name: 'System Administrator',
  username: 'admin',
  email: 'admin@example.com',
  status: 'Active',
  is_admin: true,
  all_locations_access: 'Yes',
  assigned_location_codes: [],
  security: { force_password_change: false, password_expired: false },
  roles: [{ id: 1, role_name: 'Admin', status: 'Active' }],
  permissions: [
    'View User',
    'View Role',
    'View Permission',
    'View Role Permission Assignment',
    'View User Role Assignment',
    'View User Location Assignment',
    'View Location',
    'View Asset Type',
    'View Asset',
    'View Asset Calibration',
    'View Asset Assignment',
    'View Calibration Template',
    'View Operation Type',
    'View Location Operation Availability',
    'View Operation Template',
    'View Operation Transaction',
  ].map((name, idx) => ({
    id: idx + 1,
    permission_name: name,
    module_name: 'General',
    status: 'Active',
  })),
}

const checks = []
const check = (name, ok, extra = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

const sleep = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

const viteServer = await createServer({
  root: frontendRoot,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const authTokenMod = await viteServer.ssrLoadModule('/src/api/authToken.js')
  const apiClientMod = await viteServer.ssrLoadModule('/src/api/apiClient.js')
  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')
  const { ThemeProvider } = await viteServer.ssrLoadModule('/src/theme/ThemeProvider.jsx')
  const { ToastProvider } = await viteServer.ssrLoadModule('/src/components/common/Toast.jsx')
  const { ConfirmProvider } = await viteServer.ssrLoadModule('/src/components/common/ConfirmProvider.jsx')

  // Scenario A: formatApiError includes request_id when returned by 500 handler
  const formatted500 = apiClientMod.formatApiError({
    detail: 'An internal error occurred. Quote the request id when contacting support.',
    request_id: 'req-500-xyz',
  })
  check('formatApiError appends request_id', formatted500.includes('req-500-xyz'), formatted500)

  // Stateful mock backend enforcing strict refresh-cookie rotation (replaying a rotated cookie -> 401!)
  let activeRefreshCookie = null
  const rotatedCookies = new Set()
  let activeBearer = null
  let status401Count = 0
  let status4xx5xxCount = 0
  let sessionCallCount = 0
  let refreshCallCount = 0

  const jsonRes = (body, status = 200) => {
    if (status === 401) status401Count += 1
    if (status >= 400) status4xx5xxCount += 1
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input.url
    const { pathname } = new URL(rawUrl, 'http://127.0.0.1:8000')
    await sleep(10)

    if (pathname === '/health' || pathname === '/api/health') {
      return jsonRes({ status: 'healthy', admin_seeded: true })
    }

    if (pathname === '/auth/session') {
      sessionCallCount += 1
      if (!activeRefreshCookie) {
        return jsonRes({ authenticated: false }, 200)
      }
      const presented = activeRefreshCookie
      if (rotatedCookies.has(presented)) {
        activeBearer = null
        return jsonRes({ detail: 'Refresh token has been revoked' }, 401)
      }
      rotatedCookies.add(presented)
      activeRefreshCookie = `refresh-${Date.now()}-${Math.random()}`
      activeBearer = makeJwt(Math.floor(Date.now() / 1000) + 900)
      return jsonRes({
        authenticated: true,
        access_token: activeBearer,
        token_type: 'bearer',
        user: mockUser,
      })
    }

    if (pathname === '/auth/refresh') {
      refreshCallCount += 1
      if (!activeRefreshCookie) {
        return jsonRes({ detail: 'Refresh token is required' }, 400)
      }
      const presented = activeRefreshCookie
      if (rotatedCookies.has(presented)) {
        activeBearer = null
        return jsonRes({ detail: 'Refresh token has been revoked' }, 401)
      }
      rotatedCookies.add(presented)
      activeRefreshCookie = `refresh-${Date.now()}-${Math.random()}`
      activeBearer = makeJwt(Math.floor(Date.now() / 1000) + 900)
      return jsonRes({ access_token: activeBearer, token_type: 'bearer' })
    }

    const authHeader = init.headers?.Authorization || init.headers?.authorization || ''
    if (!activeBearer || authHeader !== `Bearer ${activeBearer}`) {
      return jsonRes({ detail: 'Invalid or missing token' }, 401)
    }

    if (pathname === '/auth/me') {
      return jsonRes({ user: mockUser })
    }
    if (
      pathname === '/users' ||
      pathname === '/roles' ||
      pathname === '/permissions' ||
      pathname === '/locations' ||
      pathname === '/asset-types' ||
      pathname === '/assets'
    ) {
      return jsonRes({ items: [], total: 0, skip: 0, limit: 200, has_more: false })
    }
    return jsonRes([])
  }

  // Scenario B: Cold mount with NO refresh cookie under <React.StrictMode>
  authTokenMod.clearAccessToken()
  const coldContainer = document.createElement('div')
  document.body.appendChild(coldContainer)
  const coldRoot = createRoot(coldContainer)
  coldRoot.render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(ToastProvider, null, React.createElement(ConfirmProvider, null, React.createElement(App)))
      )
    )
  )
  await sleep(120)
  check('cold StrictMode mount: single /auth/session call', sessionCallCount === 1, `calls=${sessionCallCount}`)
  check('cold StrictMode mount: zero 4xx/5xx network errors', status4xx5xxCount === 0, `errors=${status4xx5xxCount}`)
  check('cold StrictMode mount: login screen rendered', Boolean(coldContainer.querySelector('.login-page-new')))
  coldRoot.unmount()
  coldContainer.remove()
  await sleep(50)

  // Scenario C: Logged-in reload under <React.StrictMode> with rotating cookie
  sessionCallCount = 0
  refreshCallCount = 0
  status401Count = 0
  status4xx5xxCount = 0
  activeRefreshCookie = 'initial-valid-refresh-cookie'
  authTokenMod.clearAccessToken()

  const authContainer = document.createElement('div')
  document.body.appendChild(authContainer)
  const authRoot = createRoot(authContainer)
  authRoot.render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(ToastProvider, null, React.createElement(ConfirmProvider, null, React.createElement(App)))
      )
    )
  )
  await sleep(180)
  check('authenticated StrictMode reload: single /auth/session call', sessionCallCount === 1, `calls=${sessionCallCount}`)
  check('authenticated StrictMode reload: zero /auth/refresh retries needed', refreshCallCount === 0, `refreshes=${refreshCallCount}`)
  check('authenticated StrictMode reload: zero 401 responses across all startup loaders', status401Count === 0, `401s=${status401Count}`)
  check('authenticated StrictMode reload: app shell rendered', Boolean(authContainer.querySelector('.app-shell')))

  // Scenario D: Expired in-memory JWT proactively refreshes once across parallel API calls with zero 401s
  const expiredJwt = makeJwt(Math.floor(Date.now() / 1000) - 60)
  authTokenMod.saveAccessToken(expiredJwt)
  refreshCallCount = 0
  status401Count = 0
  await Promise.all([
    apiClientMod.apiGet('/users?skip=0&limit=200'),
    apiClientMod.apiGet('/roles?skip=0&limit=200'),
    apiClientMod.apiGet('/report-builder/my-reports'),
    apiClientMod.apiGet('/system-notifications/active'),
    apiClientMod.apiGet('/system-notifications/my'),
  ])
  check('expired JWT parallel burst: single proactive /auth/refresh', refreshCallCount === 1, `refreshes=${refreshCallCount}`)
  check('expired JWT parallel burst: zero 401 responses', status401Count === 0, `401s=${status401Count}`)

  authRoot.unmount()
  authContainer.remove()
  await sleep(50)
} finally {
  await viteServer.close()
  await GlobalRegistrator.unregister()
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n==== checks failed: ${failed.length} / ${checks.length}`)
if (failed.length > 0) {
  process.exit(1)
}
