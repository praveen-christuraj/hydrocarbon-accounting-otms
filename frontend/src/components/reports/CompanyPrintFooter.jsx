/**
 * Shared printable report footer.
 *
 * Renders the footer formula / footer note configured on the Company Report
 * Profile together with the company and system name. Hidden on screen, shown
 * by the print stylesheet (.company-print-footer).
 */
function CompanyPrintFooter({ profile = null }) {
  const companyName = profile?.companyName || ''
  const systemName = profile?.systemName || 'Hydrocarbon Accounting System'
  const footerFormula = profile?.footerFormula || ''
  const footerNote = profile?.footerNote || ''

  const identity = [companyName, systemName].filter(Boolean).join(' | ')

  return (
    <div className="company-print-footer">
      {footerFormula ? <p>{footerFormula}</p> : null}
      {footerNote ? <p>{footerNote}</p> : null}
      {identity ? <p>{identity}</p> : null}
    </div>
  )
}

export default CompanyPrintFooter
