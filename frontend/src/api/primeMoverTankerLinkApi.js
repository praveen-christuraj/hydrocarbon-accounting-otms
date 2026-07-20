import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const buildQueryString = (filters = {}) => {
  const params = new URLSearchParams()

  Object.entries(filters).forEach(([key, value]) => {
    const cleanedValue = String(value ?? '').trim()

    if (cleanedValue !== '') {
      params.append(key, cleanedValue)
    }
  })

  const queryString = params.toString()

  return queryString ? `?${queryString}` : ''
}

const convertLinkFromApi = (link) => {
  return {
    id: link.id,

    primeMoverAssetCode: link.prime_mover_asset_code || '',
    primeMoverAssetName: link.prime_mover_asset_name || '',
    primeMoverAssetTypeCode: link.prime_mover_asset_type_code || '',

    tankerAssetCode: link.tanker_asset_code || '',
    tankerAssetName: link.tanker_asset_name || '',
    tankerAssetTypeCode: link.tanker_asset_type_code || '',
    tankerChassisNumber: link.tanker_chassis_number || '',

    linkedFrom: link.linked_from || '',
    linkedTo: link.linked_to || '',
    remarks: link.remarks || '',
    status: link.status || 'Active',

    createdBy: link.created_by || '',
    createdAt: link.created_at || '',
    updatedAt: link.updated_at || '',
  }
}

const convertLinkToApi = (link) => {
  return {
    prime_mover_asset_code: String(link.primeMoverAssetCode || '').trim(),
    tanker_asset_code: String(link.tankerAssetCode || '').trim(),
    linked_from: link.linkedFrom,
    linked_to:
      link.linkedTo && String(link.linkedTo).trim() !== ''
        ? link.linkedTo
        : null,
    remarks:
      link.remarks && String(link.remarks).trim() !== ''
        ? String(link.remarks).trim()
        : null,
    status: link.status || 'Active',
  }
}

export const getPrimeMoverTankerLinks = async (filters = {}) => {
  const data = await apiGet(
    `/prime-mover-tanker-links${buildQueryString(filters)}`
  )

  return data.map(convertLinkFromApi)
}

export const getCurrentPrimeMoverTankerLink = async (primeMoverAssetCode) => {
  const data = await apiGet(
    `/prime-mover-tanker-links/current-by-prime-mover/${encodeURIComponent(
      primeMoverAssetCode
    )}`
  )

  return {
    hasActiveLink: Boolean(data.has_active_link),
    link: data.link ? convertLinkFromApi(data.link) : null,
  }
}

export const createPrimeMoverTankerLink = async (link) => {
  const data = await apiPost('/prime-mover-tanker-links', convertLinkToApi(link))
  return convertLinkFromApi(data)
}

export const updatePrimeMoverTankerLink = async (linkId, link) => {
  const data = await apiPut(
    `/prime-mover-tanker-links/${linkId}`,
    convertLinkToApi(link)
  )

  return convertLinkFromApi(data)
}

export const closePrimeMoverTankerLink = async (
  linkId,
  linkedTo,
  remarks = ''
) => {
  const params = new URLSearchParams()

  if (linkedTo && String(linkedTo).trim() !== '') {
    params.append('linked_to', linkedTo)
  }

  if (remarks && String(remarks).trim() !== '') {
    params.append('remarks', String(remarks).trim())
  }

  const queryString = params.toString()
  const url = queryString
    ? `/prime-mover-tanker-links/${linkId}/close?${queryString}`
    : `/prime-mover-tanker-links/${linkId}/close`

  const data = await apiPost(url, {})
  return convertLinkFromApi(data)
}

export const deletePrimeMoverTankerLink = async (linkId) => {
  return apiDelete(`/prime-mover-tanker-links/${linkId}`)
}