import { useEffect, useMemo, useState } from 'react'
import { getAssetCalibrationTableRows } from '../api/assetCalibrationApi'

/*
 * Active calibration table for an asset, with its data rows loaded on demand.
 *
 * The calibration table list is intentionally lean (see assetCalibrationApi) so
 * the browser never downloads every dip chart of every tank on login -- that
 * payload grew with history and eventually blew past the API request timeout
 * ("Unable to load asset calibration tables from the server"). Screens that
 * need the actual chart (tank gauging, tanker truck, multi-tank, barge seal
 * master, the calibration master's edit form) pick the active table from the
 * lean list here and this hook fetches just that table's rows, caching them so
 * flicking between tanks does not re-download the same chart.
 */

const normalizeCode = (value) => String(value || '').trim().toUpperCase()

const MAX_CACHED_TABLES = 12

/** tableId -> rows[] (most recently used last). */
const rowsCache = new Map()
/** tableId -> Promise<rows[]>, so concurrent consumers share one request. */
const inFlightRequests = new Map()
/** tableId -> error message, so a failed load is not retried on every render. */
const failedTables = new Map()

const rememberRows = (tableId, rows) => {
  rowsCache.delete(tableId)
  rowsCache.set(tableId, rows)
  while (rowsCache.size > MAX_CACHED_TABLES) {
    const oldestKey = rowsCache.keys().next().value
    rowsCache.delete(oldestKey)
  }
}

export const loadCalibrationRows = async (tableId) => {
  if (tableId === null || tableId === undefined) return []

  const cached = rowsCache.get(tableId)
  if (cached) {
    // Refresh recency without a network round trip.
    rememberRows(tableId, cached)
    return cached
  }

  if (inFlightRequests.has(tableId)) {
    return inFlightRequests.get(tableId)
  }

  failedTables.delete(tableId)

  const request = getAssetCalibrationTableRows(tableId)
    .then((rows) => {
      rememberRows(tableId, rows)
      return rows
    })
    .catch((error) => {
      failedTables.set(tableId, error?.message || 'Unable to load calibration data.')
      throw error
    })
    .finally(() => {
      inFlightRequests.delete(tableId)
    })

  inFlightRequests.set(tableId, request)
  return request
}

/** Drop cached rows (after a calibration table is saved or deleted). */
export const invalidateCalibrationRows = (tableId = null) => {
  if (tableId === null || tableId === undefined) {
    rowsCache.clear()
    failedTables.clear()
    return
  }
  rowsCache.delete(tableId)
  failedTables.delete(tableId)
}

/** Pick the newest active calibration table for an asset code. */
export const selectActiveCalibrationTable = (tables, assetCode) => {
  const wanted = normalizeCode(assetCode)
  if (!wanted) return null

  const matching = (tables || []).filter(
    (table) =>
      normalizeCode(table?.assetCode) === wanted &&
      String(table?.status || '').trim().toLowerCase() === 'active'
  )

  if (matching.length === 0) return null

  return [...matching].sort((a, b) =>
    String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || ''))
  )[0]
}

/**
 * @returns {{ table: object|null, rows: Array, loading: boolean, error: string }}
 *   ``table`` is the active table with its ``rows`` populated once loaded.
 */
export function useActiveCalibrationTable({ assetCalibrationTables, assetCode }) {
  const activeTable = useMemo(
    () => selectActiveCalibrationTable(assetCalibrationTables, assetCode),
    [assetCalibrationTables, assetCode]
  )

  const tableId = activeTable?.id ?? null
  const rowsFromList = useMemo(
    () => (activeTable?.rowsLoaded ? activeTable.rows || [] : null),
    [activeTable]
  )

  // Bumped when a background load settles so the derived values below see the
  // freshly cached rows/errors without keeping duplicate copies in state.
  const [loadTick, setLoadTick] = useState(0)

  useEffect(() => {
    if (tableId === null || rowsFromList !== null) return undefined
    if (rowsCache.has(tableId)) return undefined

    let cancelled = false

    loadCalibrationRows(tableId)
      .catch(() => {
        // The message is read from `failedTables` below.
      })
      .then(() => {
        if (!cancelled) setLoadTick((tick) => tick + 1)
      })

    return () => {
      cancelled = true
    }
  }, [tableId, rowsFromList])

  const cachedRows = useMemo(
    () => (tableId === null ? null : rowsCache.get(tableId) || null),
    // `loadTick` is the signal that a background load settled and the cache
    // changed; the cache itself is a module-level store React cannot observe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableId, loadTick]
  )

  const rows = useMemo(
    () => rowsFromList ?? cachedRows ?? [],
    [rowsFromList, cachedRows]
  )

  const error = tableId === null ? '' : failedTables.get(tableId) || ''
  const loading = tableId !== null && rowsFromList === null && !cachedRows && !error

  const table = useMemo(() => {
    if (!activeTable) return null
    if (rowsFromList !== null) return activeTable
    return { ...activeTable, rows }
  }, [activeTable, rowsFromList, rows])

  return { table, rows, loading, error }
}

export default useActiveCalibrationTable
