import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertProfileFromApi = (profile) => {
  return {
    id: profile.id,
    profileName: profile.profile_name,
    companyName: profile.company_name,
    systemName: profile.system_name,
    reportSubtitle: profile.report_subtitle,
    logoUrl: profile.logo_data_url || '',
    logoText: profile.logo_text || 'LOGO',
    footerFormula: profile.footer_formula || '',
    footerNote: profile.footer_note || '',
    status: profile.status,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  }
}

const convertProfileToApi = (profile) => {
  return {
    profile_name: profile.profileName,
    company_name: profile.companyName,
    system_name: profile.systemName,
    report_subtitle: profile.reportSubtitle,
    logo_data_url: profile.logoUrl || null,
    logo_text: profile.logoText || 'LOGO',
    footer_formula: profile.footerFormula || null,
    footer_note: profile.footerNote || null,
    status: profile.status || 'Active',
  }
}

export const getCompanyReportProfiles = async () => {
  const data = await apiGet('/company-report-profiles')
  return data.map(convertProfileFromApi)
}

export const createCompanyReportProfile = async (profile) => {
  const data = await apiPost(
    '/company-report-profiles',
    convertProfileToApi(profile)
  )

  return convertProfileFromApi(data)
}

export const updateCompanyReportProfile = async (profileId, profile) => {
  const data = await apiPut(
    `/company-report-profiles/${profileId}`,
    convertProfileToApi(profile)
  )

  return convertProfileFromApi(data)
}

export const deleteCompanyReportProfile = async (profileId) => {
  return apiDelete(`/company-report-profiles/${profileId}`)
}