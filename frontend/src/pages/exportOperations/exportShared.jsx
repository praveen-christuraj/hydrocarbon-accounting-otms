import { useCallback, useEffect, useState } from 'react'
import {
  getEntityBlocks,
  getExportBlocks,
  getExportConsignees,
  getExportEntities,
  getExportLocations,
  getExportPermits,
} from '../../api/exportOperationsApi'
import { usePermissions } from '../../hooks/usePermissions'

export const EXPORT_MODULE = 'Export Operations'

export const fmt = (value, digits = 2) => {
  const number = Number(value || 0)
  return number.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']

export const yearOptions = () => {
  const current = new Date().getFullYear()
  return Array.from({ length: 20 }, (_, index) => current - 10 + index)
}

export const getCurrentQuarter = () => `Q${Math.floor(new Date().getMonth() / 3) + 1}`

/** "2024-02-10" -> "Q1_2024" (same rule as the API). */
export const quarterFromDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `Q${Math.floor(date.getMonth() / 3) + 1}_${date.getFullYear()}`
}

export const buildPermitQuarterValue = (quarter, year) => {
  const q = String(quarter || '').trim().toUpperCase()
  const y = String(year ?? '').trim()
  if (!q) return ''
  if (q.includes('_')) return q
  return y ? `${q}_${y}` : q
}

export const splitPermitQuarterValue = (value) => {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return { quarter: getCurrentQuarter(), year: new Date().getFullYear() }
  if (text.includes('_')) {
    const [quarter, yearText] = text.split('_', 2)
    return { quarter, year: yearText ? Number(yearText) : new Date().getFullYear() }
  }
  return { quarter: text, year: new Date().getFullYear() }
}

export const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', "Côte d'Ivoire", 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'DR Congo', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
  'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
  'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
  'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
  'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
  'Yemen', 'Zambia', 'Zimbabwe',
]

/** <option> list "Name (CODE)" sorted by name. */
export const codeOptions = (items, labelKey, valueKey) =>
  [...(items || [])]
    .sort((a, b) => String(a[labelKey] || '').localeCompare(String(b[labelKey] || '')))
    .map((item) => (
      <option key={item[valueKey] || item.id} value={item[valueKey]}>
        {item[labelKey]}
        {labelKey !== valueKey ? ` (${item[valueKey]})` : ''}
      </option>
    ))

/** Blocks linked to an entity through the entity-block mapping (all blocks when no entity). */
export const blocksForEntity = (blocks, entityBlocks, entityCode) => {
  if (!entityCode) return blocks
  const linked = new Set(entityBlocks.filter((link) => link.entity_code === entityCode).map((link) => link.block_code))
  return blocks.filter((block) => linked.has(block.block_code))
}

/**
 * CRUD flags for one export entity, e.g. useExportPermissions(user, 'Export Permit')
 * -> { canView, canCreate, canEdit, canDelete }.
 */
export function useExportPermissions(loggedInUser, entity) {
  const { hasPermission } = usePermissions(loggedInUser)
  return {
    canView: hasPermission(`View ${entity}`),
    canCreate: hasPermission(`Create ${entity}`),
    canEdit: hasPermission(`Edit ${entity}`),
    canDelete: hasPermission(`Delete ${entity}`),
  }
}

const REFERENCE_LOADERS = {
  locations: getExportLocations,
  entities: getExportEntities,
  blocks: getExportBlocks,
  entityBlocks: getEntityBlocks,
  consignees: getExportConsignees,
  permits: getExportPermits,
}

/**
 * Loads export reference lists, e.g. useExportReferenceData(['locations', 'entities']).
 * Returns { data: { locations: [...], ... }, loading, error, reload }.
 */
const fetchReferenceData = async (names) => {
  const results = await Promise.all(names.map((name) => REFERENCE_LOADERS[name]()))
  return Object.fromEntries(names.map((name, index) => [name, Array.isArray(results[index]) ? results[index] : []]))
}

export function useExportReferenceData(keys) {
  const keyList = keys.join('|')
  const [data, setData] = useState(() => Object.fromEntries(keys.map((key) => [key, []])))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await fetchReferenceData(keyList.split('|').filter(Boolean)))
    } catch (err) {
      setError(err.message || 'Unable to load export reference data.')
    } finally {
      setLoading(false)
    }
  }, [keyList])

  useEffect(() => {
    let cancelled = false
    fetchReferenceData(keyList.split('|').filter(Boolean))
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load export reference data.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [keyList])

  return { data, loading, error, reload }
}
