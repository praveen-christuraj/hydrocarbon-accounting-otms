import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertCalibrationTemplateFromApi = (template) => {
  return {
    id: template.id,
    templateName: template.template_name,
    assetTypeCode: template.asset_type_code,
    calibrationType: template.calibration_type,
    description: template.description || '',
    status: template.status,
    createdAt: template.created_at,
    updatedAt: template.updated_at,
    columns: (template.columns || []).map((column) => ({
      id: column.id,
      columnName: column.column_name,
      dataType: column.data_type,
      unit: column.unit || '',
      isRequired: column.is_required,
      interpolationRole: column.interpolation_role,
      sortOrder: String(column.sort_order || ''),
    })),
  }
}

const convertCalibrationTemplateToApi = (template) => {
  return {
    template_name: template.templateName,
    asset_type_code: template.assetTypeCode,
    calibration_type: template.calibrationType,
    description: template.description,
    status: template.status,
    columns: (template.columns || []).map((column, index) => ({
      column_name: column.columnName,
      data_type: column.dataType,
      unit: column.unit,
      is_required: column.isRequired,
      interpolation_role: column.interpolationRole,
      sort_order:
        column.sortOrder && String(column.sortOrder).trim() !== ''
          ? Number(column.sortOrder)
          : index + 1,
    })),
  }
}

export const getCalibrationTemplates = async () => {
  const data = await apiGet('/calibration-templates')
  return data.map(convertCalibrationTemplateFromApi)
}

export const createCalibrationTemplate = async (template) => {
  const data = await apiPost(
    '/calibration-templates',
    convertCalibrationTemplateToApi(template)
  )

  return convertCalibrationTemplateFromApi(data)
}

export const updateCalibrationTemplate = async (templateId, template) => {
  const data = await apiPut(
    `/calibration-templates/${templateId}`,
    convertCalibrationTemplateToApi(template)
  )

  return convertCalibrationTemplateFromApi(data)
}

export const deleteCalibrationTemplate = async (templateId) => {
  return apiDelete(`/calibration-templates/${templateId}`)
}