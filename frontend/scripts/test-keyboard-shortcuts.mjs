/*
 * Keyboard shortcut contract test.
 *
 * Exercises the pure combo parsing / matching helpers behind the page-scoped
 * shortcuts hook (hooks/useKeyboardShortcuts.js) without a browser:
 *
 *   npm run test:shortcuts
 *
 *  - "mod+s" resolves to Ctrl/Cmd+s, never to a bare "s" keypress,
 *  - "?" resolves even though producing it needs Shift on most layouts,
 *  - modifiers must match exactly (no stray Alt, no missing Ctrl),
 *  - alwaysOn normalization accepts arrays and "+"/string forms.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const nodeTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
  clearImmediate: globalThis.clearImmediate,
  queueMicrotask: globalThis.queueMicrotask,
}
GlobalRegistrator.register({ url: 'http://localhost:5173/' })
Object.assign(globalThis, nodeTimers)

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { createServer } = await import('vite')
const viteServer = await createServer({
  configFile: path.join(frontendRoot, 'vite.config.js'),
  root: frontendRoot,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { external: ['react', 'react-dom', 'react-router-dom', 'react-router'] },
})

const hook = await viteServer.ssrLoadModule('/src/hooks/useKeyboardShortcuts.js')

let failures = 0
let total = 0
const check = (name, ok, extra = '') => {
  total += 1
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`)
}

const evt = (overrides = {}) => ({
  key: 's',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
})

/* ---------------------------------------------------------- combo parsing */

const modS = hook.parseCombo('mod+s')
check('parseCombo("mod+s") key is "s"', modS.key === 's', modS.key)
check('parseCombo("mod+s") has the Mod modifier', modS.mods.has('Mod'))
check('parseCombo("mod+s") does NOT treat "mod" as the key', modS.key !== 'mod')

const modEnter = hook.parseCombo('mod+enter')
check('parseCombo("mod+enter") key is "enter"', modEnter.key === 'enter', modEnter.key)

const modShiftS = hook.parseCombo('mod+shift+s')
check('parseCombo("mod+shift+s") has Shift', modShiftS.mods.has('Shift'))
check('parseCombo("mod+shift+s") has Mod', modShiftS.mods.has('Mod'))
check('parseCombo("mod+shift+s") key is "s"', modShiftS.key === 's', modShiftS.key)

const escapeCombo = hook.parseCombo('escape')
check('parseCombo("escape") key is "escape"', escapeCombo.key === 'escape', escapeCombo.key)
check('parseCombo("escape") has no modifiers', escapeCombo.mods.size === 0, String(escapeCombo.mods.size))

const questionCombo = hook.parseCombo('?')
check('parseCombo("?") key is "?"', questionCombo.key === '?', questionCombo.key)

const ctrlCombo = hook.parseCombo('ctrl+k')
check('parseCombo("ctrl+k") has Control', ctrlCombo.mods.has('Control'))
check('parseCombo("cmd+k") has Control too', hook.parseCombo('cmd+k').mods.has('Control'))

/* --------------------------------------------------------- modifier match */

check('mod+s matches Ctrl+S', hook.modifiersMatch(modS.mods, evt({ key: 's', ctrlKey: true })))
check('mod+s matches Cmd+S', hook.modifiersMatch(modS.mods, evt({ key: 's', metaKey: true })))
check('mod+s does NOT match a bare s', !hook.modifiersMatch(modS.mods, evt({ key: 's' })), 'the old bug')
check('mod+s does NOT match Ctrl+Alt+S', !hook.modifiersMatch(modS.mods, evt({ key: 's', ctrlKey: true, altKey: true })))

check('escape matches a plain Escape', hook.modifiersMatch(escapeCombo.mods, evt({ key: 'escape' })))
check('escape does NOT match Ctrl+Escape', !hook.modifiersMatch(escapeCombo.mods, evt({ key: 'escape', ctrlKey: true })))

check('? matches Shift+? (shifted punctuation tolerance)', hook.modifiersMatch(questionCombo.mods, evt({ key: '?', shiftKey: true })))
check('? matches a bare ? too', hook.modifiersMatch(questionCombo.mods, evt({ key: '?' })))

check('mod+shift+s matches Ctrl+Shift+S', hook.modifiersMatch(modShiftS.mods, evt({ key: 's', ctrlKey: true, shiftKey: true })))
check('mod+shift+s does NOT match Ctrl+S', !hook.modifiersMatch(modShiftS.mods, evt({ key: 's', ctrlKey: true })))

/* --------------------------------------------------------- dispatch rules */

const fired = []
const { entries, alwaysOnKeys } = hook.buildShortcutEntries(
  {
    'mod+s': () => fired.push('save'),
    'mod+enter': () => fired.push('save'),
    escape: () => fired.push('escape'),
    'mod+d': () => fired.push('clone'),
    '?': () => fired.push('help'),
  },
  ['escape']
)
const resolvesTo = (event, opts) => {
  const entry = hook.resolveShortcut(entries, event, { alwaysOnKeys, ...opts })
  return entry ? entry.handler && (fired.length = 0, entry.handler(), fired[0]) : null
}

check('dispatch: Ctrl+S resolves to save', resolvesTo(evt({ key: 's', ctrlKey: true })) === 'save')
check('dispatch: bare s resolves to nothing', resolvesTo(evt({ key: 's' })) === null)
check('dispatch: Ctrl+Enter resolves to save', resolvesTo(evt({ key: 'enter', ctrlKey: true })) === 'save')
check('dispatch: Ctrl+X resolves to nothing (no binding)', resolvesTo(evt({ key: 'x', ctrlKey: true })) === null)
check('dispatch: Escape resolves to escape', resolvesTo(evt({ key: 'escape' })) === 'escape')
check('dispatch: ? (Shift+/) resolves to help', resolvesTo(evt({ key: '?', shiftKey: true })) === 'help')
check('dispatch: bare s inside an editable field resolves to nothing', resolvesTo(evt({ key: 's' }), { isEditable: true }) === null)
check('dispatch: ? inside an editable field resolves to nothing', resolvesTo(evt({ key: '?', shiftKey: true }), { isEditable: true }) === null)
check('dispatch: Escape inside an editable field still resolves', resolvesTo(evt({ key: 'escape' }), { isEditable: true }) === 'escape')
check('dispatch: Ctrl+S inside an editable field still resolves', resolvesTo(evt({ key: 's', ctrlKey: true }), { isEditable: true }) === 'save')

/* ------------------------------------------------------- alwaysOn parsing */

const alwaysOnArray = hook.normalizeAlwaysOn(['escape', 'enter'])
check('normalizeAlwaysOn(array) contains escape', alwaysOnArray.has('escape'))
check('normalizeAlwaysOn(array) contains enter', alwaysOnArray.has('enter'))
check('normalizeAlwaysOn(array) size is 2', alwaysOnArray.size === 2, String(alwaysOnArray.size))

const alwaysOnString = hook.normalizeAlwaysOn('escape+f1')
check('normalizeAlwaysOn("escape+f1") contains f1', alwaysOnString.has('f1'))
check('normalizeAlwaysOn("") is empty', hook.normalizeAlwaysOn('').size === 0)

/* ------------------------------------------------------- editable targets */

const input = document.createElement('input')
const textarea = document.createElement('textarea')
const div = document.createElement('div')
check('isEditableTarget(input) is true', hook.isEditableTarget(input))
check('isEditableTarget(textarea) is true', hook.isEditableTarget(textarea))
check('isEditableTarget(div) is false', !hook.isEditableTarget(div))
check('isEditableTarget(plain object) is false', !hook.isEditableTarget({}))

await viteServer.close()

console.log('')
if (failures > 0) {
  console.log(`${failures} of ${total} checks FAILED`)
  process.exit(1)
}
console.log(`All ${total} checks passed`)
