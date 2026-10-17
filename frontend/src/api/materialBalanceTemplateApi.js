import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertTemplateFromApi = (row) => {
  return {
    id: row.id,
    locationCode: row.location_code || '',
    templateName: row.template_name || '',
    description: row.description || '',
    status: row.status || 'Active',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    columns: (row.columns || []).map(convertTemplateColumnFromApi),
    // The list endpoint returns templates without their columns; only the
    // detail endpoint (GET /material-balance-templates/{id}) includes them.
    columnsLoaded: Array.isArray(row.columns),
  }
}

const convertTemplateColumnFromApi = (row) => {
  return {
    id: row.id,
    templateId: row.template_id,
    columnLabel: row.column_label || '',
    columnKey: row.column_key || '',
    columnOrder: Number(row.column_order || 1),
    columnType: row.column_type || '',
    movementDirection: row.movement_direction || '',
    mappedOperationCodes: row.mapped_operation_codes || [],
    excludedOperationCodes: row.excluded_operation_codes || [],
    includeInMaterialBalance: row.include_in_material_balance || 'Yes',
    includeInBookClosing: row.include_in_book_closing || 'Yes',
    isInternalTransfer: row.is_internal_transfer || 'No',
    formulaJson: row.formula_json || null,
    remarks: row.remarks || '',
    status: row.status || 'Active',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

const convertTemplateToApi = (template) => {
  return {
    location_code: template.locationCode,
    template_name: template.templateName,
    description: template.description,
    status: template.status,
  }
}

const convertTemplateColumnToApi = (column) => {
  return {
    column_label: column.columnLabel,
    column_key: column.columnKey,
    column_order: Number(column.columnOrder || 1),
    column_type: column.columnType,
    movement_direction:
      column.columnType === 'MOVEMENT' ? column.movementDirection : null,
    mapped_operation_codes:
      column.columnType === 'MOVEMENT' ? column.mappedOperationCodes || [] : [],
    excluded_operation_codes: column.excludedOperationCodes || [],
    include_in_material_balance: column.includeInMaterialBalance,
    include_in_book_closing: column.includeInBookClosing,
    is_internal_transfer: column.isInternalTransfer,
    formula_json: column.formulaJson || null,
    remarks: column.remarks,
    status: column.status,
  }
}

export const getMaterialBalanceTemplates = async (filters = {}) => {
  const params = new URLSearchParams()

  if (filters.locationCode) {
    params.append('location_code', filters.locationCode)
  }

  if (filters.status) {
    params.append('status', filters.status)
  }

  const queryString = params.toString()
  const path = queryString
    ? `/material-balance-templates?${queryString}`
    : '/material-balance-templates'

  const data = await apiGet(path)

  return (data || []).map(convertTemplateFromApi)
}

export const getMaterialBalanceTemplateDetail = async (templateId) => {
  const data = await apiGet(`/material-balance-templates/${templateId}`)

  return convertTemplateFromApi(data)
}

/**
 * Templates together with their columns. The list endpoint has no columns, so
 * the details are fetched a few at a time. A template whose detail cannot be
 * loaded is returned with `columnsError` instead of failing the whole list.
 */
export const getMaterialBalanceTemplatesWithColumns = async (filters = {}) => {
  const templates = await getMaterialBalanceTemplates(filters)
  const results = new Array(templates.length)
  const CONCURRENCY = 4
  let cursor = 0

  const worker = async () => {
    while (cursor < templates.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await getMaterialBalanceTemplateDetail(templates[index].id)
      } catch (error) {
        results[index] = {
          ...templates[index],
          columns: [],
          columnsLoaded: false,
          columnsError: error?.message || 'Unable to load the columns of this template',
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, templates.length) }, worker))
  return results
}

export const createMaterialBalanceTemplate = async (template) => {
  const data = await apiPost(
    '/material-balance-templates',
    convertTemplateToApi(template)
  )

  return convertTemplateFromApi(data)
}

export const updateMaterialBalanceTemplate = async (templateId, template) => {
  const data = await apiPut(
    `/material-balance-templates/${templateId}`,
    convertTemplateToApi(template)
  )

  return convertTemplateFromApi(data)
}

export const deleteMaterialBalanceTemplate = async (templateId) => {
  return apiDelete(`/material-balance-templates/${templateId}`)
}

export const createMaterialBalanceTemplateColumn = async (
  templateId,
  column
) => {
  const data = await apiPost(
    `/material-balance-templates/${templateId}/columns`,
    convertTemplateColumnToApi(column)
  )

  return convertTemplateColumnFromApi(data)
}

export const updateMaterialBalanceTemplateColumn = async (columnId, column) => {
  // The column routes live under the template router's prefix:
  // PUT /material-balance-templates/material-balance-template-columns/{column_id}
  const data = await apiPut(
    `/material-balance-templates/material-balance-template-columns/${columnId}`,
    convertTemplateColumnToApi(column)
  )

  return convertTemplateColumnFromApi(data)
}

export const deleteMaterialBalanceTemplateColumn = async (columnId) => {
  return apiDelete(`/material-balance-templates/material-balance-template-columns/${columnId}`)
}

const convertTankOperationFromApi = (row) => {
  return {
    id: row.id,
    locationCode: row.location_code || row.locationCode || '',
    operationCode: row.operation_code || row.operationCode || '',
    operationLabel: row.operation_label || row.operationLabel || '',
    operationCategory: row.operation_category || row.operationCategory || '',
    operationSign: row.operation_sign || row.operationSign || '',
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    status: row.status || 'Active',
  }
}

export const getTankOperationsForMaterialBalance = async (filters = {}) => {
  const params = new URLSearchParams()

  if (filters.locationCode) {
    params.append('location_code', filters.locationCode)
  }

  if (filters.status) {
    params.append('status', filters.status)
  }

  const queryString = params.toString()
  const path = queryString ? `/tank-operations?${queryString}` : '/tank-operations'

  const data = await apiGet(path)

  return (data || []).map(convertTankOperationFromApi)
}