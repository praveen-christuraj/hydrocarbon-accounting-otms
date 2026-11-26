/**
 * Detects a backend that is older than this frontend build.
 *
 * A stale API build (Docker image built before a release, or an `uvicorn`
 * process from an older checkout) answers a route it does not know with 404.
 * Without this check the user sees a wall of console 404s for endpoints that
 * demonstrably exist in the repository. We probe `GET /health` once, compare
 * the route flags it reports, and surface a single actionable message.
 *
 * The probe is deliberately best-effort: any failure (offline, CORS, old
 * backend without the flags) resolves to "compatible" so it can never block
 * the application.
 */

const STALE_BACKEND_EVENT = 'hydrocarbon:stale-backend'
/** Paths this build needs; mirrors _REQUIRED_ROUTE_GROUPS in backend/app/main.py. */
export const REQUIRED_BACKEND_ROUTES = {
  analytics: '/analytics/lookups',
  analytics_records: '/analytics/my-dashboards/{id}/visual/{visual_id}/records',
  analytics_preview_records: '/analytics/run-preview/visual/{visual_id}/records',
  analytics_json_paths: '/analytics/json-paths',
  analytics_operation_fields: '/analytics/operation-fields',
}

let probePromise = null
let reported = false

const describeMissing = (missing) => missing
  .map((name) => `${name} (${REQUIRED_BACKEND_ROUTES[name] || name})`)
  .join(', ')

export const notifyStaleBackend = (detail) => {
  if (reported || typeof window === 'undefined') return
  reported = true
  window.dispatchEvent(new CustomEvent(STALE_BACKEND_EVENT, { detail }))
}

export const STALE_BACKEND_MESSAGE =
  'The backend answering this page is older than the frontend. Rebuild/restart the API ' +
  '(docker compose build backend && docker compose up -d backend, or restart uvicorn from this ' +
  'checkout), then reload.'

/**
 * Probe the running API build once per session.
 * Resolves to { compatible, missing, health } — never rejects.
 */
export const checkBackendBuild = ({ baseUrl = '', force = false } = {}) => {
  if (probePromise && !force) return probePromise
  probePromise = (async () => {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) return { compatible: true, missing: [], health: null }
      const health = await response.json().catch(() => null)
      const routes = health && typeof health.routes === 'object' ? health.routes : null
      if (!routes) return { compatible: true, missing: [], health }
      const missing = Object.keys(REQUIRED_BACKEND_ROUTES).filter((name) => routes[name] === false)
      return { compatible: missing.length === 0, missing, health }
    } catch {
      return { compatible: true, missing: [], health: null }
    }
  })()
  return probePromise
}

/**
 * Called by apiClient after an unexpected 404. Confirms via /health whether the
 * build is stale and, if so, raises one app-wide banner.
 */
export const reportPossibleStaleBackend = async (endpoint, baseUrl = '') => {
  const result = await checkBackendBuild({ baseUrl })
  if (result.compatible) return result
  notifyStaleBackend({
    endpoint,
    missing: result.missing,
    message: `${STALE_BACKEND_MESSAGE} Missing: ${describeMissing(result.missing)}.`,
  })
  return result
}

export const resetStaleBackendCheck = () => {
  probePromise = null
  reported = false
}
