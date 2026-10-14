/*
 * Headless smoke test: renders the React app in happy-dom with a mocked API
 * and walks through the shell + a few pages, reporting runtime errors.
 * No backend or browser is required.
 *
 * Usage: npm run smoke -- [/pathname ...]      (default: /locations /users /audit-logs)
 *        DUMP=4000 npm run smoke -- /users     (print the first 4000 chars of page HTML)
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
// happy-dom swaps the timer globals for its own; Vite needs Node's (unref etc.)
Object.assign(globalThis, nodeTimers)

// happy-dom lacks a few APIs
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
}
if (!window.scrollTo) window.scrollTo = () => {}
window.URL.createObjectURL = () => 'blob:http://localhost:5173/mock-download'
window.URL.revokeObjectURL = () => {}
// Downloads: do not navigate the happy-dom window
const nativeAnchorClick = window.HTMLAnchorElement.prototype.click
window.HTMLAnchorElement.prototype.click = function click() {
  if (this.hasAttribute('download') || String(this.href).startsWith('blob:')) {
    downloads.push(this.getAttribute('download') || this.href)
    return undefined
  }
  return nativeAnchorClick.call(this)
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const errors = []
const downloads = []
const origError = console.error
console.error = (...args) => {
  const text = args.map((a) => (a && a.stack) || String(a)).join(' ')
  errors.push(text)
  origError('[console.error]', text.slice(0, 600))
}
process.on('unhandledRejection', (reason) => {
  errors.push('unhandledRejection: ' + ((reason && reason.stack) || reason))
  origError('[unhandledRejection]', (reason && reason.stack) || reason)
})
window.addEventListener('error', (event) => {
  errors.push('window.error: ' + (event.error?.stack || event.message))
})

/* ------------------------------------------------------------- fixtures */
const now = new Date().toISOString()
const permissionNames = [
  'View User', 'Create User', 'Update User', 'Delete User',
  'View Role', 'View Permission', 'View Role Permission Assignment',
  'View User Role Assignment', 'View User Location Assignment', 'View Access Summary',
  'View Own Security Settings', 'View Location', 'Create Location', 'Update Location', 'Delete Location',
  'View Location Accounting Day Setting', 'View Material Balance Template', 'View Asset Type', 'View Asset',
  'View Calibration Template', 'View Asset Calibration', 'View Asset Assignment', 'View Flowmeter Config',
  'View Company Report Profile', 'View Database Browser', 'View Audit Log', 'View System Notification',
  'View Backup', 'View Export Operations', 'View Barge Seal Master', 'View Operation Type', 'View Tank Operation',
  'View Vessel Operation', 'View Movement Mapping', 'View Operation Template', 'View Operation Workflow Policy',
  'Create Operation Entry', 'View My Tasks', 'View Operation Transaction', 'View Shuttle Tracking', 'View FSO Tracking',
  'View Dashboard', 'Manage Dashboard', 'View Location Operation Availability', 'View Flowmeter Record',
  'View Tank Stock Ledger', 'View Tank Operation Summary', 'View Out-Turn Summary', 'View Out-Turn Report',
  'View Material Balance Report',
]
const me = {
  id: 1,
  full_name: 'System Administrator',
  username: 'admin',
  email: 'admin@example.com',
  status: 'Active',
  roles: [{ id: 1, role_name: 'Admin', description: 'Administrator', status: 'Active' }],
  permissions: permissionNames.map((name, i) => ({ id: i + 1, permission_name: name, module_name: 'Core', status: 'Active' })),
  assigned_location_codes: [],
  all_locations_access: 'Yes',
}
const users = Array.from({ length: 57 }, (_, i) => ({
  id: i + 1,
  full_name: `User ${i + 1}`,
  username: `user${i + 1}`,
  email: `user${i + 1}@example.com`,
  phone: '',
  department: i % 2 ? 'Operations' : 'Finance',
  designation: 'Officer',
  status: i % 5 === 0 ? 'Inactive' : 'Active',
  created_at: now,
  updated_at: now,
}))
const locations = Array.from({ length: 43 }, (_, i) => ({
  id: i + 1,
  location_name: `Terminal ${i + 1}`,
  location_code: `LOC${String(i + 1).padStart(3, '0')}`,
  location_type: i % 3 === 0 ? 'Terminal' : i % 3 === 1 ? 'Depot' : 'Refinery',
  parent_location_code: i > 2 ? 'LOC001' : null,
  description: `Location number ${i + 1}`,
  status: i % 7 === 0 ? 'Inactive' : 'Active',
  created_at: now,
  updated_at: now,
}))
const auditLogs = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  module_name: 'Location Master',
  action: i % 2 ? 'Create' : 'Update',
  entity_type: 'Location',
  entity_id: i + 1,
  record_identifier: `LOC${String(i + 1).padStart(3, '0')}`,
  performed_by: 'admin',
  performed_by_user_id: 1,
  performed_at: now,
  remarks: 'test',
  old_values: null,
  new_values: null,
}))

const paged = (items, url) => {
  const u = new URL(url, 'http://x')
  const skip = Number(u.searchParams.get('skip') || 0)
  const limit = Number(u.searchParams.get('limit') || 50)
  return { items: items.slice(skip, skip + limit), total: items.length, skip, limit, has_more: skip + limit < items.length }
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const apiCalls = []
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const method = (init.method || 'GET').toUpperCase()
  const path = url.replace(/^https?:\/\/[^/]+/, '')
  apiCalls.push(`${method} ${path}`)
  if (path.startsWith('/auth/me')) return jsonResponse(me)
  if (path.startsWith('/auth/logout')) return jsonResponse({ ok: true })
  if (path.startsWith('/users')) {
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      const created = { ...body, id: users.length + 1, created_at: now, updated_at: now }
      users.push(created)
      return jsonResponse(created, 201)
    }
    return jsonResponse(paged(users, path))
  }
  if (path.startsWith('/locations')) {
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      const created = { ...body, id: locations.length + 1, created_at: now, updated_at: now }
      locations.push(created)
      return jsonResponse(created, 201)
    }
    return jsonResponse(paged(locations, path))
  }
  if (path.startsWith('/audit-logs')) return jsonResponse(paged(auditLogs, path))
  if (path.startsWith('/system-notifications/active')) return jsonResponse([])
  if (path.startsWith('/system-notifications/my')) return jsonResponse([])
  if (path.startsWith('/roles')) return jsonResponse(paged([{ id: 1, role_name: 'Admin', description: 'Administrator', status: 'Active', created_at: now, updated_at: now }], path))
  if (path.startsWith('/permissions')) return jsonResponse(paged(me.permissions.map((p) => ({ ...p, description: '', created_at: now, updated_at: now })), path))
  // generic fallbacks
  if (method === 'GET') {
    return jsonResponse(path.includes('summary') || path.includes('config') ? {} : [])
  }
  return jsonResponse({})
}

/* --------------------------------------------------------------- render */
const { createServer } = await import('vite')
const server = await createServer({
  configFile: path.join(frontendRoot, 'vite.config.js'),
  root: frontendRoot,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { external: ['react', 'react-dom', 'react-router-dom', 'react-router'] },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const flush = async (ms = 60) => {
  for (let i = 0; i < 3; i += 1) {
    await sleep(ms)
    await new Promise((r) => setImmediate(r))
  }
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '')
const q = (sel) => document.querySelector(sel)
const qa = (sel) => Array.from(document.querySelectorAll(sel))
const click = (el) => {
  if (!el) throw new Error('click target missing')
  el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
  el.click()
}
const setValue = (el, value) => {
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
  el.dispatchEvent(new window.Event('change', { bubbles: true }))
}

const checks = []
const check = (name, ok, extra = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

try {
  window.localStorage.setItem('hydrocarbonAccessToken', 'smoke-token')
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)

  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { ThemeProvider } = await server.ssrLoadModule('/src/theme/ThemeProvider.jsx')
  const { ToastProvider } = await server.ssrLoadModule('/src/components/common/Toast.jsx')
  const { ConfirmProvider } = await server.ssrLoadModule('/src/components/common/ConfirmProvider.jsx')

  const reactRoot = createRoot(root)
  reactRoot.render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(ToastProvider, null, React.createElement(ConfirmProvider, null, React.createElement(App)))
    )
  )
  await flush(150)

  check('app shell rendered', Boolean(q('.app-shell')))
  check('top navigation rendered', qa('.top-nav-button').length > 3, `(${qa('.top-nav-button').length} groups)`)
  check('user menu rendered', Boolean(q('.user-menu-button')), text(q('.user-menu-button')))
  check('legacy navbar gone', !q('.navbar'))
  check('home tiles rendered', qa('.dashboard-tile').length > 5, `(${qa('.dashboard-tile').length} tiles)`)

  // Open a nav dropdown
  const navButton = qa('.top-nav-button')[0]
  click(navButton)
  await flush()
  check('dropdown opens on click', Boolean(q('.top-nav-menu')), text(q('.top-nav-menu')).slice(0, 80))
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flush()
  check('dropdown closes on Escape', !q('.top-nav-menu'))

  // Theme switching
  click(q('.user-menu-button'))
  await flush()
  check('user menu opens', Boolean(q('.user-menu-popover')))
  const darkOption = qa('.theme-switcher-option').find((b) => text(b) === 'Dark')
  click(darkOption)
  await flush()
  check('dark theme applied', document.documentElement.getAttribute('data-theme') === 'dark')
  const lightOption = qa('.theme-switcher-option').find((b) => text(b) === 'Light')
  click(lightOption)
  await flush()
  check('light theme applied', document.documentElement.getAttribute('data-theme') === 'light')
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flush()

  // Navigate to pages requested on the CLI (default set)
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['/locations', '/users', '/audit-logs']
  for (const path of pages) {
    const before = errors.length
    const link = qa('a[href]').find((a) => a.getAttribute('href') === path)
    if (link) {
      click(link)
    } else {
      // open the dropdown containing it
      let found = false
      for (const button of qa('.top-nav-button')) {
        click(button)
        await flush(30)
        const item = qa('.top-nav-menu a').find((a) => a.getAttribute('href') === path)
        if (item) {
          click(item)
          found = true
          break
        }
      }
      if (!found) {
        window.history.pushState({}, '', path)
        window.dispatchEvent(new window.PopStateEvent('popstate'))
      }
    }
    await flush(200)
    const title = text(q('.main-content h2'))
    check(`page ${path} renders`, window.location.pathname === path && Boolean(title), `title="${title}" errors=${errors.length - before}`)
    if (q('.pagination-controls')) {
      console.log('      pagination:', text(q('.pagination-summary')))
    }
    if (q('.data-filter-bar')) {
      console.log('      filter bar present; records:', text(q('.data-filter-summary')))
    }
    if (process.env.DUMP) {
      console.log(document.querySelector('.main-content').innerHTML.slice(0, Number(process.env.DUMP)))
    }

    if (path === '/locations') {
      // Filter bar interactions
      const search = q('.data-filter-search input')
      setValue(search, 'Depot')
      await flush(120)
      check('quick search filters rows', text(q('.data-filter-summary')).startsWith('Showing'), text(q('.data-filter-summary')))
      console.log('      pagination after search:', text(q('.pagination-summary')))
      setValue(search, '')
      await flush(120)

      click(qa('.filter-toggle').find((b) => text(b).includes('Advanced')))
      await flush()
      click(qa('.data-filter-panel-footer button')[0])
      await flush()
      const condition = q('.filter-condition')
      check('advanced condition row added', Boolean(condition))
      const [fieldSel, opSel] = condition.querySelectorAll('select')
      setValue(fieldSel, 'status')
      await flush()
      const valueControl = condition.querySelector('.filter-condition-value select, .filter-condition-value input')
      setValue(valueControl, 'Inactive')
      await flush(120)
      check('advanced filter applied', text(q('.data-filter-summary')).includes('1 filter'), text(q('.data-filter-summary')))
      click(q('.filter-clear'))
      await flush(120)
      check('clear all resets filters', !text(q('.data-filter-summary')).includes('filter'), text(q('.data-filter-summary')))

      click(qa('.filter-toggle').find((b) => text(b).includes('Date')))
      await flush()
      check('date filter panel has separate date and range groups', qa('.date-filter-group').length === 2)

      // Page size change
      const sizeSelect = q('.pagination-page-size select')
      setValue(sizeSelect, '50')
      await flush(120)
      check('page size 50 applied', text(q('.pagination-summary')).includes('1–43') || text(q('.pagination-summary')).includes('of 43'), text(q('.pagination-summary')))
      console.log('      table rows rendered:', qa('.main-content tbody tr').length)
      setValue(sizeSelect, '20')
      await flush(120)

      // Export menu
      click(q('.export-menu-button'))
      await flush()
      check('export menu lists xlsx/csv/pdf', qa('.export-menu-item').length === 3)
      const before = errors.length
      click(qa('.export-menu-item').find((b) => text(b).includes('CSV')))
      await flush(300)
      check('csv export runs without error', errors.length === before, text(q('.toast')))
      click(q('.export-menu-button'))
      await flush()
      click(qa('.export-menu-item').find((b) => text(b).includes('Excel')))
      await flush(600)
      check('xlsx export runs without error', errors.length === before, text(q('.toast')))
      click(q('.export-menu-button'))
      await flush()
      click(qa('.export-menu-item').find((b) => text(b).includes('PDF')))
      await flush(800)
      for (let i = 0; i < 20 && !qa('.toast').some((el) => text(el).includes('PDF')); i += 1) await flush(200)
      check('pdf export runs without error', errors.length === before && !q('.toast.tone-error'), qa('.toast').map(text).join(' | '))
    }
  }

  // Activity log
  click(q('.user-menu-button'))
  await flush()
  click(qa('.user-menu-item').find((b) => text(b).includes('Session activity')))
  await flush()
  check('activity panel opens', Boolean(q('.activity-panel')), `${qa('.activity-item').length} entries`)
  console.log('      first entries:', qa('.activity-item').slice(0, 4).map((e) => text(e)).join(' | ').slice(0, 300))

  console.log('\nDownloads:', downloads.join(', ') || 'none')
  console.log('API calls:', [...new Set(apiCalls)].slice(0, 40).join('\n  '))
} catch (error) {
  errors.push('harness: ' + (error.stack || error))
  console.error(error)
}

console.log('\n==== runtime errors:', errors.length)
errors.slice(0, 10).forEach((e, i) => console.log(`#${i + 1}`, e.slice(0, 800)))
console.log('==== checks failed:', checks.filter((c) => !c.ok).length, '/', checks.length)
await server.close()
process.exit(errors.length || checks.some((c) => !c.ok) ? 1 : 0)
