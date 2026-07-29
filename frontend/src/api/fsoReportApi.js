import { apiGet, apiDownload } from './apiClient'

const qs = (params = {}) => {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    const s = String(v ?? '').trim()
    if (s !== '') sp.append(k, s)
  })
  return sp.toString()
}

export const getFSOOTRReport = (params) => apiGet(`/reports/fso/otr?${qs(params)}`)
export const getFSOMaterialBalanceReport = (params) =>
  apiGet(`/reports/fso/material-balance?${qs(params)}`)
export const getFSOOutturnReport = (params) => apiGet(`/reports/fso/outturn?${qs(params)}`)

export const downloadFSOOTRXlsx = (params) =>
  apiDownload(`/reports/fso/otr/export/xlsx?${qs(params)}`, 'fso_otr.xlsx')

export const downloadFSOMaterialBalanceXlsx = (params) =>
  apiDownload(`/reports/fso/material-balance/export/xlsx?${qs(params)}`, 'fso_material_balance.xlsx')

export const downloadFSOOutturnXlsx = (params) =>
  apiDownload(`/reports/fso/outturn/export/xlsx?${qs(params)}`, 'fso_outturn.xlsx')
