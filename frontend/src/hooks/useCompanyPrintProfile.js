import { useContext } from 'react'
import { PrintProfileContext } from '../components/print/printProfileContext'

/**
 * Company Report Profile used to brand printable reports.
 *
 * The profile is chosen in the global print dialog (`usePrintDialog`) every
 * time a report is printed, and is shared with every print-only header/footer.
 * Outside the app shell (isolated component tests) it simply returns null and
 * the report falls back to the neutral placeholder header.
 */
export function useCompanyPrintProfile() {
  const context = useContext(PrintProfileContext)
  return context?.activeProfile || null
}
