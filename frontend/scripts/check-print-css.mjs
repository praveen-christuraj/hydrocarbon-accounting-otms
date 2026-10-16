/**
 * Print-CSS guard (owner change 2026-10-16: "reports coming from print action
 * should be more compact, in 2 pages at most, single page where possible").
 *
 * The stylesheet has grown one print block per report over time, and several of
 * them overlapped each other (the tanker MTR report was tuned by two different
 * blocks that disagreed on padding and page margin, so "the last one wins" was
 * accidental). The compaction rules now live in ONE layer at the end of
 * index.css; this script fails when that structure is broken again:
 *
 *   1. the compaction layer is the LAST print block in the stylesheet;
 *   2. it covers every printable report family;
 *   3. the winning @page rule is A4 landscape with tight (<= 8mm) margins;
 *   4. no report reintroduces a forced page break;
 *   5. print cells keep the compact font size / padding.
 *
 * Usage: npm run check:print-css
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const cssPath = resolve(here, '../src/index.css')
const css = readFileSync(cssPath, 'utf8')

const failures = []
const notes = []

const check = (label, condition, detail = '') => {
  if (condition) {
    notes.push(`ok    ${label}`)
  } else {
    failures.push(`${label}${detail ? ` - ${detail}` : ''}`)
  }
}

/** Body of every `@media print` block, in source order. */
function printBlocks() {
  const blocks = []
  const marker = '@media print'
  let index = css.indexOf(marker)

  while (index !== -1) {
    const open = css.indexOf('{', index)
    if (open === -1) break

    let depth = 0
    let cursor = open
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }

    blocks.push({
      start: index,
      header: css.slice(Math.max(0, index - 2000), index),
      body: css.slice(open + 1, cursor),
    })
    index = css.indexOf(marker, cursor)
  }

  return blocks
}

const blocks = printBlocks()
check('at least one @media print block exists', blocks.length > 0)

/* ---- 1. one compaction layer, and it is the last print block ------------- */
const last = blocks[blocks.length - 1] || { body: '', header: '' }
check(
  'the compaction layer is the last print block',
  /Compact print reports/.test(`${last.header}${last.body}`),
  'the last @media print block does not carry the compaction layer'
)

const containers = [
  '.printable-report',
  '.printable-register-report',
  '.tanker-mtr-report',
  '.barge-mtr-report',
  '.mtr-page',
  '.print-report',
  '.out-turn-report-page',
  '.material-balance-report-page',
  '.tank-operation-summary-page',
  '.out-turn-summary-page',
  '.tank-stock-ledger-page',
  '.op-transaction-register-page',
]

/* ---- 2. every report family is covered by the compaction layer ----------- */
const uncovered = containers.filter((selector) => !last.body.includes(selector))
check(
  'every report family is covered by the compaction layer',
  uncovered.length === 0,
  `missing: ${uncovered.join(', ')}`
)

/* ---- 3. the winning @page rule ------------------------------------------- */
const pageRules = [...css.matchAll(/@page\s*\{([^}]*)\}/g)].map((match) => match[1])
check('@page rules are declared', pageRules.length > 0)

const winning = pageRules[pageRules.length - 1] || ''
check(
  'the winning @page rule is A4 landscape',
  /size:\s*A4\s+landscape/.test(winning),
  winning.trim()
)

const marginMatch = winning.match(/margin:\s*([\d.]+)mm/)
const marginMm = marginMatch ? Number(marginMatch[1]) : Number.NaN
check(
  'the winning page margin is 8mm or less',
  Number.isFinite(marginMm) && marginMm <= 8,
  `margin=${Number.isNaN(marginMm) ? 'missing' : `${marginMm}mm`}`
)

const portrait = pageRules.filter((rule) => /size:\s*A4\s+portrait/.test(rule))
check('no report asks for a portrait page', portrait.length === 0)

/* ---- 3b. consolidated reports stay consolidated ------------------------- */
// The tanker MTR and barge MTR reports used to be tuned by two overlapping
// print blocks each, disagreeing over padding and page margin. Measurement for
// them must now come from the shared compaction layer only.
const declaresSize = (body, className) => {
  const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  return rules.some(
    ([, selectors, declarations]) =>
      selectors.includes(className) && /(font-size|padding)\s*:/.test(declarations)
  )
}

for (const className of ['.tanker-mtr-report', '.barge-mtr-report']) {
  const legacy = blocks
    .slice(0, -1)
    .filter((block) => declaresSize(block.body, className))

  check(
    `${className} is no longer sized by the superseded print blocks`,
    legacy.length === 0,
    `${legacy.length} other print block(s) still set font-size/padding`
  )

  check(
    `${className} is sized by the compaction layer`,
    declaresSize(last.body, className)
  )
}

const reportedMargins = [...css.matchAll(/@page\s*\{[^}]*margin:\s*([\d.]+)mm/g)].map((m) => Number(m[1]))
check(
  'no page margin is absurdly wide (<= 12mm)',
  reportedMargins.every((mm) => mm <= 12),
  `margins: ${reportedMargins.join(', ')}`
)

/* ---- 4. nobody forces a new page ---------------------------------------- */
const forcedBreaks = [...css.matchAll(/page-break-before:\s*always|break-before:\s*page/g)]
check(
  'no print rule forces a page break (helper class only)',
  forcedBreaks.length <= 2,
  `${forcedBreaks.length} forced-break declarations found`
)

/* ---- 5. cells stay compact ---------------------------------------------- */
check(
  'print cells use the compact font size',
  /font-size:\s*8\.5px\s*!important/.test(last.body)
)
check(
  'print cells use compact padding',
  /padding:\s*1px 3px\s*!important/.test(last.body)
)
check(
  'table headers repeat on continuation pages',
  /display:\s*table-header-group/.test(last.body)
)

/* ---- report ------------------------------------------------------------- */
const summary = `print css: ${notes.length} checks passed, ${failures.length} failed`
console.log(summary)

if (failures.length > 0) {
  console.error('\nFailed checks:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
