import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertAssignmentFromApi = (assignment) => {
  return {
    id: assignment.id,
    assetCode: assignment.asset_code,
    assetName: assignment.asset_name || '',
    assetScope: assignment.asset_scope,
    assignmentLocationCode: assignment.assignment_location_code,
    assignmentLocationName: assignment.assignment_location_name || '',
    assignedToType: assignment.assigned_to_type,
    assignedTo: assignment.assigned_to,
    assignedToDisplay: assignment.assigned_to_display || '',
    assignmentDate: assignment.assignment_date || '',
    returnDate: assignment.return_date || '',
    remarks: assignment.remarks || '',
    status: assignment.status,
    createdAt: assignment.created_at,
    updatedAt: assignment.updated_at,
  }
}

const convertAssignmentToApi = (assignment) => {
  return {
    asset_code: assignment.assetCode,
    asset_scope: assignment.assetScope,
    assignment_location_code: assignment.assignmentLocationCode,
    assigned_to_type: assignment.assignedToType,
    assigned_to: assignment.assignedTo,
    assignment_date: assignment.assignmentDate,
    return_date:
      assignment.returnDate && String(assignment.returnDate).trim() !== ''
        ? assignment.returnDate
        : null,
    remarks: assignment.remarks || null,
    status: assignment.status || 'Active',
  }
}

export const getAssetAssignments = async () => {
  const data = await apiGet('/asset-assignments')
  return data.map(convertAssignmentFromApi)
}

export const createAssetAssignment = async (assignment) => {
  const data = await apiPost(
    '/asset-assignments',
    convertAssignmentToApi(assignment)
  )

  return convertAssignmentFromApi(data)
}

export const updateAssetAssignment = async (assignmentId, assignment) => {
  const data = await apiPut(
    `/asset-assignments/${assignmentId}`,
    convertAssignmentToApi(assignment)
  )

  return convertAssignmentFromApi(data)
}

export const deleteAssetAssignment = async (assignmentId) => {
  return apiDelete(`/asset-assignments/${assignmentId}`)
}