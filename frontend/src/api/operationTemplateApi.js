import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertFieldFromApi = (field) => {
  return {
    id: field.id,
    fieldName: field.field_name || '',
    fieldCode: field.field_code || '',
    fieldGroup: field.field_group || '',
    dataType: field.data_type || 'Text',
    unit: field.unit || '',
    isRequired: field.is_required || 'No',
    inputMode: field.input_mode || 'Manual',
    calculationRole: field.calculation_role || 'Input',
    sortOrder: field.sort_order || 1,
    status: field.status || 'Active',
  }
}

const convertTemplateFromApi = (template) => {
  return {
    id: template.id,
    templateName: template.template_name || '',
    operationTypeCode: template.operation_type_code || '',
    operationTypeName: template.operation_type_name || '',
    entryLayoutType: template.entry_layout_type || 'Standard Form',
    calculationEngine: template.calculation_engine || 'None',
    description: template.description || '',
    status: template.status || 'Active',
    createdAt: template.created_at,
    updatedAt: template.updated_at,
    fields: (template.fields || []).map(convertFieldFromApi),
  }
}

const convertFieldToApi = (field, index) => {
  return {
    field_name: String(field.fieldName || '').trim(),
    field_code: String(field.fieldCode || '').trim(),
    field_group: String(field.fieldGroup || 'General').trim(),
    data_type: field.dataType || 'Text',
    unit: field.unit ? String(field.unit).trim() : null,
    is_required: field.isRequired || 'No',
    input_mode: field.inputMode || 'Manual',
    calculation_role: field.calculationRole || 'Input',
    sort_order: Number(field.sortOrder || index + 1),
    status: field.status || 'Active',
  }
}

const convertTemplateToApi = (template) => {
  return {
    template_name: String(template.templateName || '').trim(),
    operation_type_code: String(template.operationTypeCode || '').trim(),
    entry_layout_type: template.entryLayoutType || 'Standard Form',
    calculation_engine: template.calculationEngine || 'None',
    description: template.description
      ? String(template.description).trim()
      : null,
    status: template.status || 'Active',
    fields: (template.fields || []).map(convertFieldToApi),
  }
}

export const getOperationTemplates = async () => {
  const data = await apiGet('/operation-templates')
  return data.map(convertTemplateFromApi)
}

export const createOperationTemplate = async (template) => {
  const data = await apiPost(
    '/operation-templates',
    convertTemplateToApi(template)
  )

  return convertTemplateFromApi(data)
}

export const updateOperationTemplate = async (templateId, template) => {
  const data = await apiPut(
    `/operation-templates/${templateId}`,
    convertTemplateToApi(template)
  )

  return convertTemplateFromApi(data)
}

export const deleteOperationTemplate = async (templateId) => {
  return apiDelete(`/operation-templates/${templateId}`)
}