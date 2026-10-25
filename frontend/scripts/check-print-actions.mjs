/**
 * Print-action guard (product-owner rule, 2026-10-25).
 *
 * Every print-out must first ask for a Company Report Profile. That is only
 * true while `window.print()` is called from one place: the global
 * PrintProfileProvider (plus its no-provider fallback in printProfileContext).
 * A page that calls `window.print()` directly would silently print with the
 * previous/default branding - this guard fails the build in that case.
 *
 * Usage: npm run check:print-actions
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '../src')

const ALLOWED_FILES = new Set([
  ['components', 'print', 'PrintProfileProvider.jsx'].join(sep),
  ['components', 'print', 'printProfileContext.js'].join(sep),
])

const walk = (dir) => {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walk(full))
    } else if (/\.(jsx?|mjs)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

const violations = []

for (const file of walk(srcRoot)) {
  const relativePath = relative(srcRoot, file)
  if (ALLOWED_FILES.has(relativePath)) continue

  const source = readFileSync(file, 'utf8')
  if (/\bwindow\s*\.\s*print\s*\(/.test(source)) {
    const line = source
      .slice(0, source.search(/\bwindow\s*\.\s*print\s*\(/))
      .split('\n').length
    violations.push(`${relativePath}:${line}`)
  }
}

if (violations.length > 0) {
  console.error(
    'Print guard failed: call requestPrint() from usePrintDialog() instead of window.print().'
  )
  violations.forEach((violation) => console.error(`  - ${violation}`))
  process.exit(1)
}

console.log(
  'print actions: every window.print() goes through the company report profile dialog'
)
