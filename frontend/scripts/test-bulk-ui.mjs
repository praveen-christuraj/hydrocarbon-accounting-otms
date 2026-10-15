/*
 * UI test for the bulk upload / bulk export controls.
 *
 * Boots scripts/mock-api.mjs, renders the real application in happy-dom with
 * fetch pointed at it, then drives the pages that carry the new controls.
 *
 *   npm run test:bulk:ui
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOCK_PORT = Number(process.env.MOCK_API_PORT || 8231)
const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`

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

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const errors = []
const downloads = []
const apiCalls = []
globalThis.URL.createObjectURL = () => 'blob:mock'
globalThis.URL.revokeObjectURL = () => {}
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}
if (!window.scrollTo) window.scrollTo = () => {}
const nativeAnchorClick = window.HTMLAnchorElement.prototype.click
window.HTMLAnchorElement.prototype.click = function click() {
  if (this.hasAttribute('download') || String(this.href).startsWith('blob:')) {
    downloads.push(this.getAttribute('download') || this.href)
    return undefined
  }
  return nativeAnchorClick.call(this)
}
const origError = console.error
console.error = (...args) => {
  errors.push(`[after ${apiCalls.length} api calls] ` + args.map((a) => (a && a.stack) || String(a)).join(' '))
}
process.on('unhandledRejection', (reason) => {
  errors.push(`[after ${apiCalls.length} api calls] unhandledRejection: ` + ((reason && reason.stack) || reason))
})

/* --------------------------------------------------- start the mock API */

const nativeFetch = globalThis.fetch

const mock = spawn(process.execPath, [path.join(frontendRoot, 'scripts', 'mock-api.mjs')], {
  env: { ...process.env, MOCK_API_PORT: String(MOCK_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
mock.stderr.on('data', (chunk) => console.log('[mock-api:stderr]', String(chunk).trim()))
mock.on('exit', (code, signal) => {
  if (code) console.log('[mock-api] exited with', code, signal || '')
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Poll with a raw socket so the first probe (before the server binds) never
// produces a noisy fetch rejection.
const waitForMock = async () => {
  for (let i = 0; i < 80; i += 1) {
    const up = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: MOCK_PORT })
      const done = (ok) => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(1000)
      socket.on('connect', () => done(true))
      socket.on('error', () => done(false))
      socket.on('timeout', () => done(false))
    })
    if (up) return
    await sleep(150)
  }
  throw new Error('mock api did not start')
}
await waitForMock()

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const pathname = url.replace(/^https?:\/\/[^/]+/, '')
  apiCalls.push(`${(init.method || 'GET').toUpperCase()} ${pathname}`)
  return nativeFetch(`${MOCK_ORIGIN}${pathname}`, init)
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
  const proto =
    el.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
  el.dispatchEvent(new window.Event('change', { bubbles: true }))
}
const findButton = (label, scope = document) =>
  qa('button', scope).find((b) => text(b).trim() === label)

const goto = async (pathname) => {
  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new window.PopStateEvent('popstate'))
  await flush(220)
}

let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures += 1
  origError(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

try {
  window.localStorage.setItem('hydrocarbonAccessToken', 'ui-test-token')
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)

  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { ThemeProvider } = await server.ssrLoadModule('/src/theme/ThemeProvider.jsx')
  const { ToastProvider } = await server.ssrLoadModule('/src/components/common/Toast.jsx')
  const { ConfirmProvider } = await server.ssrLoadModule('/src/components/common/ConfirmProvider.jsx')

  createRoot(root).render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(ToastProvider, null, React.createElement(ConfirmProvider, null, React.createElement(App)))
    )
  )
  await flush(300)

  /* -------------------------------------------------- Barge Seal Master */
  await goto('/barge-seal-master')
  check('barge seal master renders', text(q('.main-content h2')) === 'Barge Seal Master')

  const assetSelect = qa('.main-content select').find((s) =>
    Array.from(s.options).some((o) => o.value === 'BRG-001')
  )
  check('barge asset select present', Boolean(assetSelect))
  setValue(assetSelect, 'BRG-001')
  await flush(300)

  const tankCells = qa('.main-content tbody tr td:first-child').map(text)
  check('tanks derived from the calibration table', tankCells.join(',').includes('C1'), tankCells.join(','))
  check(
    'existing seals loaded into the grid',
    qa('.main-content tbody input').some((input) => input.value === 'SL-1001')
  )

  check('barge seal export menu present', Boolean(q('.main-content .export-menu-button')))
  click(q('.main-content .export-menu-button'))
  await flush()
  check('barge seal export offers three formats', qa('.export-menu-item').length === 3)
  const beforeExport = errors.length
  click(qa('.export-menu-item').find((b) => text(b).includes('Excel')))
  await flush(500)
  check('barge seal xlsx export runs', errors.length === beforeExport, downloads.slice(-1).join(''))

  const uploadButton = qa('.main-content button').find((b) => text(b).trim() === 'Bulk Upload')
  check('barge seal bulk upload button present', Boolean(uploadButton))
  click(uploadButton)
  await flush()
  check('barge seal upload dialog opens', Boolean(q('.import-dialog')))
  check(
    'barge seal upload dialog shows the template picker',
    Boolean(q('.import-dialog .import-template-bar select')),
    text(q('.import-dialog .import-template-select'))
  )
  const bargeTemplateButtons = qa('.import-dialog .import-template-downloads button')
  check('barge seal offers xlsx + csv templates', bargeTemplateButtons.length === 2)
  const beforeTemplate = errors.length
  click(bargeTemplateButtons[0])
  await flush(500)
  check('barge seal xlsx template downloads', errors.length === beforeTemplate, downloads.slice(-1).join(''))
  click(bargeTemplateButtons[1])
  await flush(400)
  check('barge seal csv template downloads', errors.length === beforeTemplate, downloads.slice(-1).join(''))
  check(
    'barge seal upload dialog lists the seal columns',
    qa('.import-dialog .import-fields li').some((li) => text(li).includes('Seal Position'))
  )
  click(findButton('Cancel', q('.import-dialog')))
  await flush(150)
  check('barge seal upload dialog closes on Cancel', !q('.import-dialog'))

  /* ---------------------------------------------- Asset Calibration Table */
  await goto('/asset-calibrations')
  check('asset calibration table renders', text(q('.main-content h2')) === 'Asset Calibration Table')
  const calibUpload = qa('.main-content button').find((b) => text(b).trim() === 'Bulk Upload')
  check('asset calibration bulk upload button present', Boolean(calibUpload))
  click(calibUpload)
  await flush()
  const picker = q('.import-dialog .import-template-bar select')
  check('calibration upload uses the Calibration Template Master as its template', Boolean(picker))
  if (picker) {
    const optionLabels = Array.from(picker.options).map((o) => o.textContent)
    check(
      'calibration templates offered in the picker',
      optionLabels.some((label) => label.includes('Barge Tank Strapping')),
      optionLabels.join(' | ')
    )
    setValue(picker, '2')
    await flush(200)
    check(
      'switching template swaps the dynamic columns',
      qa('.import-dialog .import-fields li').some((li) => text(li).includes('Ullage'))
    )
  }
  click(findButton('Cancel', q('.import-dialog')))
  await flush(150)

  /* ------------------------------------------------------- Asset Master */
  await goto('/assets')
  check('asset master renders', text(q('.main-content h2')) === 'Asset Master')
  check('asset master keeps its bulk upload', Boolean(findButton('Bulk Upload', q('.main-content'))))
  check('asset master keeps its export menu', Boolean(q('.main-content .export-menu-button')))

  /* ----------------------------------------------- Asset Assignment Summary */
  await goto('/asset-assignment-summary')
  check('asset assignment summary renders', text(q('.main-content h2')) === 'Asset Assignment Summary')
  check(
    'read-only summary gained export menus',
    qa('.main-content .export-menu-button').length === 3,
    `${qa('.main-content .export-menu-button').length} export menus`
  )
  check(
    'read-only summary sections gained filter bars',
    qa('.main-content .data-filter-bar').length === 3,
    `${qa('.main-content .filter-bar').length} filter bars`
  )

  /* ---------------------------------------------------- Table 11 (xlsx) */
  await goto('/table11-factors')
  check('table 11 renders', text(q('.main-content h2')) === 'Table 11 Factor Master')
  const fileInput = q('.main-content input[type="file"]')
  check(
    'table 11 upload accepts xlsx and csv',
    Boolean(fileInput) && fileInput.getAttribute('accept').includes('.xlsx') && fileInput.getAttribute('accept').includes('.csv'),
    fileInput ? fileInput.getAttribute('accept') : ''
  )
  const t11TemplateButtons = qa('.main-content .upload-template-downloads button')
  check('table 11 offers xlsx + csv templates', t11TemplateButtons.length === 2, t11TemplateButtons.map(text).join(' | '))

  /* ------------------------------------------------------- Asset Calibration in-form upload */
  await goto('/asset-calibrations')
  const assetCodeSelect = qa('.main-content select').find((sel) => sel.getAttribute('name') === 'assetCode')
  const templateIdSelect = qa('.main-content select').find((sel) => sel.getAttribute('name') === 'templateId')
  check('calibration form exposes asset and template selects', Boolean(assetCodeSelect && templateIdSelect))
  setValue(assetCodeSelect, 'BRG-001')
  await flush(220)
  setValue(qa('.main-content select').find((sel) => sel.getAttribute('name') === 'templateId'), '1')
  await flush(300)

  const calibFileInputs = qa('.main-content input[type="file"]')
  check(
    'calibration in-form upload accepts xlsx and csv',
    calibFileInputs.length > 0 &&
      calibFileInputs.every(
        (input) => input.getAttribute('accept').includes('.xlsx') && input.getAttribute('accept').includes('.csv')
      ),
    calibFileInputs.map((i) => i.getAttribute('accept')).join(' | ')
  )
  const calibTemplateButtons = qa('.main-content .upload-template-downloads button')
  check(
    'calibration in-form upload offers xlsx + csv templates',
    calibTemplateButtons.length === 2,
    calibTemplateButtons.map(text).join(' | ')
  )
  const beforeCalibTemplate = errors.length
  click(calibTemplateButtons[0])
  await flush(500)
  check(
    'calibration template downloads',
    errors.length === beforeCalibTemplate && downloads.length > 0,
    downloads.slice(-1).join('')
  )
  /* ------------------------------------------- newly covered extra pages */
  const expectUpload = async (pathname, heading, columns) => {
    await goto(pathname)
    check(`${pathname} renders`, text(q('.main-content h2')) === heading, text(q('.main-content h2')))
    const button = qa('.main-content button').find((b) => text(b).trim() === 'Bulk Upload')
    check(`${pathname} gained a bulk upload button`, Boolean(button))
    check(`${pathname} keeps its export menu`, Boolean(q('.main-content .export-menu-button')))
    if (!button) return
    click(button)
    await flush()
    const listed = qa('.import-dialog .import-fields li').map(text).join(' | ')
    check(`${pathname} upload dialog lists its columns`, columns.every((c) => listed.includes(c)), listed.slice(0, 160))
    const fileInputs = qa('.import-dialog input[type="file"]')
    check(
      `${pathname} upload accepts xlsx and csv`,
      fileInputs.length > 0 && fileInputs[0].getAttribute('accept').includes('.xlsx') && fileInputs[0].getAttribute('accept').includes('.csv'),
      fileInputs[0] ? fileInputs[0].getAttribute('accept') : ''
    )
    click(findButton('Cancel', q('.import-dialog')))
    await flush(150)
  }

  await expectUpload('/system-notifications', 'System Notifications', ['Title', 'Message'])
  await expectUpload('/user-roles', 'User Role Assignment', ['Username', 'Roles'])
  await expectUpload('/user-locations', 'User Location Assignment', ['Username', 'Locations'])
  await expectUpload('/role-permissions', 'Role Permission Assignment', ['Role', 'Permissions'])
} catch (error) {
  errors.push('harness: ' + (error.stack || error))
  origError(error)
}

console.error = origError
console.log(`\n==== runtime errors: ${errors.length}`)
errors.slice(0, 8).forEach((e, i) => console.log(`#${i + 1}`, e.slice(0, 500)))
console.log(`==== checks failed: ${failures}`)
console.log('Downloads:', [...new Set(downloads)].join(', ') || 'none')

await server.close()
mock.kill('SIGTERM')
process.exit(errors.length || failures ? 1 : 0)
