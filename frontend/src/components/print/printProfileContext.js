import { createContext, useContext } from 'react'

/**
 * Context behind the global print-profile prompt.
 *
 * Kept in its own module so `PrintProfileProvider.jsx` only exports a React
 * component (react-refresh) and the hooks can be imported by pages, report
 * components and the shared `useCompanyPrintProfile` hook.
 */
export const PrintProfileContext = createContext(null)

const printWithBrowser = () => {
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print()
  }
}

/**
 * Access the print dialog from any page.
 *
 *   const { requestPrint } = usePrintDialog()
 *   requestPrint({ module: 'Barge Tracking', reportName: 'Barge MTR', onBeforePrint })
 *
 * A page rendered outside the app shell (isolated component test) still
 * prints, using the old direct behaviour, instead of throwing.
 */
export function usePrintDialog() {
  const context = useContext(PrintProfileContext)

  if (context) return context

  return {
    activeProfile: null,
    profiles: [],
    profilesLoading: false,
    profilesError: '',
    refreshProfiles: async () => [],
    requestPrint: (options = {}) => {
      try {
        if (typeof options.onBeforePrint === 'function') {
          Promise.resolve(options.onBeforePrint(null)).then(printWithBrowser)
        } else {
          printWithBrowser()
        }
      } catch {
        // ignore
      }
      return true
    },
  }
}
