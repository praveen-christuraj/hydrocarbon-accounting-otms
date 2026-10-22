/*
 * Observed quality preview - contract test.
 *
 * Operation transaction previews (the register's Entered Data Review and the
 * tanker ticket preview) must show EITHER the entered observed API OR the
 * entered observed density - never both - followed by the calculated
 * API @ 60 and VCF, because the entered observed parameter is what produces
 * them. The multi-tank (barge) review table used to print both observed rows
 * and no API @ 60 / VCF at all; the tanker preview used to print both
 * observed values with API @ 60 / VCF buried in the calculated card.
 *
 * This test renders `MultiTankInputReview` and `TankerPayloadPreview` from
 * saved payload fixtures and asserts the either/or + API @ 60 + VCF behavior,
 * including stale unused values left over from older payloads.
 *
 * Usage: npm run test:observed-preview
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

const { renderToStaticMarkup } = await import('react-dom/server')
const { createElement } = await import('react')

const checks = []
const check = (label, ok, detail = '') => {
  checks.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const countOf = (text, needle) => text.split(needle).length - 1

try {
  const { MultiTankInputReview } = await server.ssrLoadModule(
    '/src/pages/OperationTransactionDetail.jsx'
  )
  const { default: TankerPayloadPreview } = await server.ssrLoadModule(
    '/src/components/operationLayouts/TankerPayloadPreview.jsx'
  )

  /* ------------------------------------------------------------------ *
   * Multi-tank (barge) review table
   * ------------------------------------------------------------------ */

  const multiTankPayload = (obsMode, over = {}) => ({
    inputs: {
      before: {
        date: '2026-10-20',
        time: '06:00',
        obsMode,
        obsApi: '34.5',
        obsDensity: '825.4', // stale unused value from an older entry
        tankTemp: '32.5',
        tankTempUnit: '°C',
        sampleTemp: '32.5',
        sampleTempUnit: '°C',
        bswPct: '0.5',
        ccf: '1',
        ...(over.before || {}),
      },
      after: {
        date: '2026-10-20',
        time: '18:00',
        obsMode,
        obsApi: '34.7',
        obsDensity: '826.1', // stale unused value from an older entry
        tankTemp: '33.1',
        tankTempUnit: '°C',
        sampleTemp: '33.1',
        sampleTempUnit: '°C',
        bswPct: '0.5',
        ccf: '1',
        ...(over.after || {}),
      },
    },
    calculated: {
      before: { API60: 34.2, VCF: 0.99123 },
      after: { API60: 34.4, VCF: 0.99087 },
    },
  })

  const multiApiLabel = '<strong>API @ 60°F</strong>'
  const multiVcfLabel = '<strong>VCF</strong>'

  console.log('\nMulti-tank (barge) input review')

  const apiHtml = renderToStaticMarkup(
    createElement(MultiTankInputReview, { payload: multiTankPayload('Observed API') })
  )

  check(
    'multi-tank review shows Observed API when the operator entered API',
    apiHtml.includes('Observed API') && apiHtml.includes('34.50') && apiHtml.includes('34.70'),
    apiHtml.slice(0, 120)
  )
  check(
    'multi-tank review hides Observed Density when the operator entered API',
    !apiHtml.includes('Observed Density') && !apiHtml.includes('825.4') && !apiHtml.includes('826.1')
  )
  check(
    'multi-tank review follows the observed parameter with API @ 60 and VCF',
    apiHtml.includes(multiApiLabel) &&
      apiHtml.includes('34.20') &&
      apiHtml.includes('34.40') &&
      apiHtml.includes('0.99123') &&
      apiHtml.includes('0.99087')
  )
  check(
    'multi-tank review orders observed parameter -> API @ 60 -> VCF',
    apiHtml.indexOf('Observed API') < apiHtml.indexOf(multiApiLabel) &&
      apiHtml.indexOf(multiApiLabel) < apiHtml.indexOf(multiVcfLabel),
    `${apiHtml.indexOf('Observed API')} / ${apiHtml.indexOf(multiApiLabel)} / ${apiHtml.indexOf(multiVcfLabel)}`
  )
  check(
    'multi-tank review prints API @ 60 and VCF once each',
    countOf(apiHtml, multiApiLabel) === 1 && countOf(apiHtml, multiVcfLabel) === 1
  )

  const densityHtml = renderToStaticMarkup(
    createElement(MultiTankInputReview, { payload: multiTankPayload('Observed Density') })
  )

  check(
    'multi-tank review shows Observed Density when the operator entered density',
    densityHtml.includes('825.4000') && densityHtml.includes('826.1000')
  )
  check(
    'multi-tank review hides Observed API when the operator entered density',
    !densityHtml.includes('Observed API') && !densityHtml.includes('34.50') && !densityHtml.includes('34.70')
  )

  const mixedHtml = renderToStaticMarkup(
    createElement(MultiTankInputReview, {
      payload: multiTankPayload('Observed API', {
        after: { obsMode: 'Observed Density' },
      }),
    })
  )

  check(
    'multi-tank review shows each side only its own entered parameter',
    mixedHtml.includes('34.50') &&
      mixedHtml.includes('826.1000') &&
      !mixedHtml.includes('825.4000') &&
      !mixedHtml.includes('34.70')
  )

  /* ------------------------------------------------------------------ *
   * Tanker ticket preview
   * ------------------------------------------------------------------ */

  const tankerPayload = (observedInputType, over = {}) => ({
    inputs: {
      compartment: 'C1',
      totalDipCm: '120.5',
      waterDipCm: '2.0',
      bswPercent: '0.5',
      tankTemperature: '32.5',
      tankTemperatureUnit: 'C',
      sampleTemperature: '32.5',
      sampleTemperatureUnit: 'C',
      observedInputType,
      observedApi: '34.5',
      observedDensity: '825.4', // stale unused value from an older entry
      ...over,
    },
    calculated: {
      tovBbl: 1000.111,
      freeWaterBbl: 10.111,
      govBbl: 990,
      api60: 34.2,
      vcf: 0.99123,
      gsvBbl: 981.318,
      bswBbl: 4.907,
      nsvBbl: 976.411,
      ltFactor: 0.99761234,
      lt: 974.086,
      mt: 989.663,
    },
  })

  const tankerApiLabel = '>API @ 60<'
  const tankerVcfLabel = '>VCF<'

  console.log('\nTanker ticket preview')

  const tankerApiHtml = renderToStaticMarkup(
    createElement(TankerPayloadPreview, {
      payload: tankerPayload('Observed API'),
      title: 'Tanker Ticket Preview',
    })
  )

  check(
    'tanker preview shows Observed API when the operator entered API',
    tankerApiHtml.includes('Observed API') && tankerApiHtml.includes('34.5')
  )
  check(
    'tanker preview hides Observed Density when the operator entered API',
    !tankerApiHtml.includes('Observed Density') && !tankerApiHtml.includes('825.4')
  )
  check(
    'tanker preview follows the observed parameter with API @ 60 and VCF',
    tankerApiHtml.includes(tankerApiLabel) &&
      tankerApiHtml.includes('34.2') &&
      tankerApiHtml.includes('0.99123')
  )
  check(
    'tanker preview orders observed parameter -> API @ 60 -> VCF',
    tankerApiHtml.indexOf('Observed API') < tankerApiHtml.indexOf(tankerApiLabel) &&
      tankerApiHtml.indexOf(tankerApiLabel) < tankerApiHtml.indexOf(tankerVcfLabel),
    `${tankerApiHtml.indexOf('Observed API')} / ${tankerApiHtml.indexOf(tankerApiLabel)} / ${tankerApiHtml.indexOf(tankerVcfLabel)}`
  )
  check(
    'tanker preview prints API @ 60 and VCF once each',
    countOf(tankerApiHtml, tankerApiLabel) === 1 && countOf(tankerApiHtml, tankerVcfLabel) === 1
  )

  const tankerDensityHtml = renderToStaticMarkup(
    createElement(TankerPayloadPreview, {
      payload: tankerPayload('Observed Density (kg/m³)'),
      title: 'Tanker Ticket Preview',
    })
  )

  check(
    'tanker preview shows Observed Density when the operator entered density',
    tankerDensityHtml.includes('Observed Density') && tankerDensityHtml.includes('825.4')
  )
  check(
    'tanker preview hides Observed API when the operator entered density',
    !tankerDensityHtml.includes('Observed API') && !tankerDensityHtml.includes('34.5')
  )
} catch (error) {
  checks.push({ label: 'harness', ok: false })
  console.error('FAIL  harness  ' + (error.stack || error))
}

await server.close()

const failed = checks.filter((c) => !c.ok).length
console.log(`\n==== checks failed: ${failed} / ${checks.length}`)
process.exit(failed ? 1 : 0)
