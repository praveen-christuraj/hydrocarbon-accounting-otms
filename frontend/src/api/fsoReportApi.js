import { apiGet, apiDownload } from './apiClient'

const qs = (params = {}) => {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    const s = String(v ?? '').trim()
    if (s !== '') sp.append(k, s)
  })
  return sp.toString()
}

export const getFSOOTRReport = (params) => apiGet(`/fso/reports/otr?${qs(params)}`)
export const getFSOMaterialBalanceReport = (params) =>
  apiGet(`/fso/reports/material-balance?${qs(params)}`)
export const getFSOOutturnReport = (params) => apiGet(`/fso/reports/outturn?${qs(params)}`)

export const downloadFSOOTRXlsx = (params) =>
  apiDownload(`/fso/reports/otr/export/xlsx?${qs(params)}`, 'fso_otr.xlsx')

export const downloadFSOMaterialBalanceXlsx = (params) =>
  apiDownload(`/fso/reports/material-balance/export/xlsx?${qs(params)}`, 'fso_material_balance.xlsx')

export const downloadFSOOutturnXlsx = (params) =>
  apiDownload(`/fso/reports/outturn/export/xlsx?${qs(params)}`, 'fso_outturn.xlsx')
