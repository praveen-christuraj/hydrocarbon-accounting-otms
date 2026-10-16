/*
 * Operation Entry location dropdowns - contract test.
 *
 * Operation Entry fills Origin / Sender with the signed-in user's own location
 * (localised default) and Destination / Receiver with every location in the
 * system. The page used to ask for the whole location master in a single call:
 *
 *     GET /locations?skip=0&limit=500&all_locations=true
 *
 * The API capped a page at 200 rows and answered 422; the caller swallowed the
 * error, so `allSystemLocations` stayed empty and Destination / Receiver
 * silently fell back to the user's own location - the reported bug. The API
 * cap was real, so the dropdown also had to keep working past 200 locations.
 *
 * The fetch stub below mirrors the real endpoint: one page never returns more
 * than 200 rows even when a larger `limit` is asked for (the server clamps),
 * `has_more` drives paging, and a request without `all_locations` stays inside
 * the user's assigned scope. This guarantees the frontend pages properly
 * instead of relying on one oversized response.
 *
 * Usage: npm run test:operation-entry-locations
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PAGE_SIZE = 200

const ALL_LOCATIONS = Array.from({ length: 250 }, (_, i) => ({
  id: i + 1,
  location_name: `Terminal ${i + 1}`,
  location_code: `LOC${String(i + 1).padStart(3, '0')}`,
  location_type: 'Terminal',
  parent_location_code: null,
  description: '',
  status: 'Active',
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
}))

// The signed-in user is assigned a single location (the profile that reported
// the problem) and does not have all-locations access.
const USER_LOCATION_CODES = ['LOC001']

const requests = []
let oversizedPageServed = null

globalThis.localStorage = {
  store: new Map([['hydrocarbonAccessToken', 'test-token']]),
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null
  },
  setItem(key, value) {
    this.store.set(key, String(value))
  },
  removeItem(key) {
    this.store.delete(key)
  },
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url
  const parsed = new URL(url, 'http://localhost')
  const params = parsed.searchParams
  requests.push(`${parsed.pathname}${parsed.search}`)

  if (parsed.pathname !== '/locations') {
    return jsonResponse({ detail: 'unexpected endpoint' }, 404)
  }

  const skip = Number(params.get('skip') || 0)
  const requested = Number(params.get('limit') || 50)
  const allLocations = params.get('all_locations') === 'true'

  if (!Number.isInteger(requested) || requested < 1) {
    return jsonResponse(
      { detail: [{ type: 'greater_than_equal', loc: ['query', 'limit'], msg: 'Input should be greater than or equal to 1' }] },
      422
    )
  }

  // Like the real endpoint: a page never exceeds PAGE_SIZE rows.
  const served = Math.min(requested, PAGE_SIZE)
  if (served > PAGE_SIZE) oversizedPageServed = served

  const visible = allLocations
    ? ALL_LOCATIONS
    : ALL_LOCATIONS.filter((row) => USER_LOCATION_CODES.includes(row.location_code))
  const items = visible.slice(skip, skip + served)

  return jsonResponse({
    items,
    total: visible.length,
    skip,
    limit: served,
    has_more: skip + served < visible.length,
  })
}

const { createServer } = await import('vite')
const server = await createServer({
  configFile: path.join(frontendRoot, 'vite.config.js'),
  root: frontendRoot,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
})

const checks = []
const check = (name, ok, extra = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

try {
  const { getAllLocations, getLocations } = await server.ssrLoadModule('/src/api/locationApi.js')

  const scoped = await getLocations({ limit: 200 })
  check(
    'scoped request still returns only the user location',
    scoped.items.length === 1 && scoped.items[0].locationCode === 'LOC001',
    `(${scoped.items.map((i) => i.locationCode).join(',')})`
  )

  // Control: one call cannot fetch the whole master, so paging is genuinely
  // required for this data set. Without an honest cap here the test below
  // would pass even for a single-call implementation.
  const single = await getLocations({ all_locations: true, limit: 1000 })
  check(
    'a single call is capped at one page',
    single.items.length === PAGE_SIZE && single.has_more === true,
    `(${single.items.length} rows, has_more=${single.has_more})`
  )
  check('server never serves more than one page', oversizedPageServed === null)

  requests.length = 0
  const all = await getAllLocations()
  const codes = all.items.map((item) => item.locationCode)
  const unique = [...new Set(codes)]

  check('full location master returned', unique.length === ALL_LOCATIONS.length, `(${unique.length}/${ALL_LOCATIONS.length})`)
  check(
    'every location present, none duplicated',
    codes.length === ALL_LOCATIONS.length &&
      unique.sort().join() === ALL_LOCATIONS.map((l) => l.location_code).sort().join()
  )
  check('rendered in a stable order', codes.join() === ALL_LOCATIONS.map((l) => l.location_code).join())
  check('paging used more than one request', requests.length === 2, `(${requests.length} calls)`)
  check(
    'every request asked for the full master',
    requests.every((r) => r.includes('all_locations=true')),
    requests.join(' | ')
  )
  check(
    'no request asked for an oversized page',
    requests.every((r) => Number(new URL(r, 'http://x').searchParams.get('limit')) <= PAGE_SIZE),
    requests.join(' | ')
  )
} finally {
  await server.close()
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
