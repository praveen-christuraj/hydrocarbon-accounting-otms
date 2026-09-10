import { useMemo } from 'react'

/**
 * Shared printable report header.
 *
 * Uses the active Company Report Profile (company name, system name, report
 * subtitle, logo) and falls back to sensible defaults so every printable
 * report renders a complete header even when no profile is configured.
 */
function CompanyPrintHeader({ profile = null, defaultSubtitle = '' }) {
  const printedAt = useMemo(() => new Date().toLocaleString(), [])

  const companyName = profile?.companyName || 'Company Name'
  const systemName = profile?.systemName || 'Hydrocarbon Accounting System'
  const subtitle = defaultSubtitle || profile?.reportSubtitle || ''

  return (
    <div className="print-report-header">
      <div className="print-company-block">
        {profile?.logoUrl ? (
          <img
            src={profile.logoUrl}
            alt={`${companyName} Logo`}
            className="print-company-logo"
          />
        ) : (
          <div className="print-logo-placeholder">
            {profile?.logoText || 'LOGO'}
          </div>
        )}

        <div>
          <h1>{companyName}</h1>
          <p>{systemName}</p>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>

      <div className="print-report-ticket">
        <strong>Report Print</strong>
        <span>{printedAt}</span>
      </div>
    </div>
  )
}

export default CompanyPrintHeader
