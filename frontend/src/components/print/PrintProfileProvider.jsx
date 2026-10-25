import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import Modal from '../common/Modal'
import Icon from '../common/Icon'
import AlertMessage from '../common/AlertMessage'
import { useToast } from '../common/Toast'
import { getCompanyReportProfilePrintOptions } from '../../api/companyReportProfileApi'
import { logUiAction } from '../../utils/actionLogger'
import { PrintProfileContext } from './printProfileContext'

/**
 * Global print-profile selection (product-owner rule, 2026-10-25).
 *
 * Every "Print" action in every module goes through `requestPrint()`:
 *
 *   1. a pop-up asks which Company Report Profile to use for this print-out;
 *   2. the drop-down lists every profile from the Company Report Profile Master
 *      (a global master – a profile saved once is usable by every user);
 *   3. only after the user confirms is `window.print()` called, so the report
 *      header/footer is rendered with the chosen branding.
 *
 * Pages do NOT call `window.print()` themselves any more. They call
 *
 *   const { requestPrint } = usePrintDialog()
 *   requestPrint({
 *     module: 'Tank Stock Ledger',
 *     reportName: 'Tank Stock Ledger',
 *     onBeforePrint: () => { ...set the printable state / log the action... },
 *   })
 *
 * `onBeforePrint` may be async; the provider waits for it, then for React to
 * paint, and only then opens the browser print dialog.
 */

const LAST_PROFILE_KEY = 'hca.printProfileId'

const readLastProfileId = () => {
  try {
    return Number(localStorage.getItem(LAST_PROFILE_KEY) || 0)
  } catch {
    return 0
  }
}

const persistLastProfileId = (profileId) => {
  try {
    localStorage.setItem(LAST_PROFILE_KEY, String(profileId))
  } catch {
    // Storage disabled – the choice simply is not remembered.
  }
}

const pickDefaultProfile = (profiles, current = null) => {
  if (current) {
    const stillAvailable = profiles.find((profile) => profile.id === current.id)
    if (stillAvailable) return stillAvailable
  }

  const lastUsedId = readLastProfileId()
  return (
    profiles.find((profile) => profile.id === lastUsedId) ||
    profiles.find((profile) => profile.status === 'Active') ||
    profiles[0] ||
    null
  )
}

/** Wait until React has committed the printable state and the browser painted. */
const waitForPrintReady = () =>
  new Promise((resolve) => {
    let settled = false
    let fallbackTimer = null

    const done = () => {
      if (settled) return
      settled = true
      if (fallbackTimer) window.clearTimeout(fallbackTimer)
      resolve()
    }

    // A hidden/throttled tab never fires requestAnimationFrame; never leave
    // the user stuck without a print dialog.
    fallbackTimer = window.setTimeout(done, 400)

    const hasRaf =
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'

    if (!hasRaf) {
      window.setTimeout(done, 150)
      return
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(done, 60)
      })
    })
  })

export function PrintProfileProvider({ children }) {
  const toast = useToast()

  const [profiles, setProfiles] = useState([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [profilesError, setProfilesError] = useState('')
  const [activeProfile, setActiveProfile] = useState(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [busy, setBusy] = useState(false)

  const requestRef = useRef(null)
  const activeProfileRef = useRef(null)
  const busyRef = useRef(false)
  const profilesRef = useRef([])

  useEffect(() => {
    activeProfileRef.current = activeProfile
  }, [activeProfile])

  useEffect(() => {
    profilesRef.current = profiles
  }, [profiles])

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true)
    setProfilesError('')

    try {
      const list = await getCompanyReportProfilePrintOptions()
      const safeList = Array.isArray(list) ? list : []

      setProfiles(safeList)
      setActiveProfile((current) => pickDefaultProfile(safeList, current))

      return safeList
    } catch (error) {
      setProfilesError(
        error?.message ||
          'Unable to load company report profiles. Please try again.'
      )
      return []
    } finally {
      setProfilesLoading(false)
    }
  }, [])

  // Load once per session so the print-only report headers already carry the
  // default branding before the user opens a print dialog (Ctrl+P included).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfiles()
  }, [loadProfiles])

  const selectedProfile = useMemo(
    () =>
      profiles.find(
        (profile) => String(profile.id) === String(selectedProfileId)
      ) || null,
    [profiles, selectedProfileId]
  )

  // Keep the drop-down valid when the list loads/reloads while open.
  useEffect(() => {
    if (!dialogOpen || profiles.length === 0) return

    setSelectedProfileId((current) => {
      if (profiles.some((profile) => String(profile.id) === current)) {
        return current
      }

      const fallback = pickDefaultProfile(
        profiles,
        activeProfileRef.current
      )

      return fallback ? String(fallback.id) : ''
    })
  }, [dialogOpen, profiles])

  const openDialog = useCallback(
    (options = {}) => {
      if (busyRef.current) return false

      requestRef.current = options
      setDialogOpen(true)

      const current = activeProfileRef.current
      setSelectedProfileId(current ? String(current.id) : '')

      if (profilesRef.current.length === 0) {
        loadProfiles()
      }

      return true
    },
    [loadProfiles]
  )

  const closeDialog = () => {
    if (busyRef.current) return
    setDialogOpen(false)
    requestRef.current = null
  }

  const handleConfirm = async () => {
    if (!selectedProfile || busyRef.current) return

    const options = requestRef.current || {}
    const profile = selectedProfile

    // Make the chosen profile the active branding BEFORE printing so every
    // print-only header/footer in the DOM renders it.
    setActiveProfile(profile)
    activeProfileRef.current = profile
    persistLastProfileId(profile.id)
    setDialogOpen(false)
    setBusy(true)
    busyRef.current = true

    try {
      if (typeof options.onBeforePrint === 'function') {
        await options.onBeforePrint(profile)
      }

      await waitForPrintReady()

      logUiAction(options.module || 'Reports', 'Print Report', {
        report: options.reportName || 'Report',
        profile: profile.profileName,
        company: profile.companyName,
      })

      window.print()

      if (typeof options.onAfterPrint === 'function') {
        options.onAfterPrint(profile)
      }
    } catch (error) {
      toast.error(
        error?.message ||
          'The report could not be prepared for printing. Please try again.',
        { title: 'Print' }
      )
    } finally {
      requestRef.current = null
      busyRef.current = false
      setBusy(false)
    }
  }

  const value = useMemo(
    () => ({
      activeProfile,
      profiles,
      profilesLoading,
      profilesError,
      requestPrint: openDialog,
      refreshProfiles: loadProfiles,
    }),
    [
      activeProfile,
      profiles,
      profilesLoading,
      profilesError,
      openDialog,
      loadProfiles,
    ]
  )

  const selectedStatus = String(selectedProfile?.status || '').toLowerCase()
  const hasProfiles = profiles.length > 0

  return (
    <PrintProfileContext.Provider value={value}>
      {children}

      <Modal
        open={dialogOpen}
        title="Select Company Report Profile"
        description="Every report is printed with a company report profile. Choose the profile to use for this print-out."
        size="md"
        className="print-profile-dialog"
        onClose={closeDialog}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={loadProfiles}
              disabled={profilesLoading || busy}
            >
              {profilesLoading ? 'Refreshing…' : 'Refresh Profiles'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={closeDialog}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirm}
              disabled={!selectedProfile || profilesLoading || busy}
            >
              <Icon name="print" size={15} />
              {busy ? 'Preparing…' : 'Print Report'}
            </button>
          </>
        }
      >
        <AlertMessage
          tone="error"
          message={profilesError}
          onDismiss={() => setProfilesError('')}
        />

        {profilesLoading && !hasProfiles && (
          <p className="muted-table-text">Loading company report profiles…</p>
        )}

        {!profilesLoading && !hasProfiles && !profilesError && (
          <div className="info-box">
            <strong>No company report profile found.</strong>
            <p>
              A profile is required before a report can be printed. Add one in
              Master Data &rarr; Company Report Profile Master (company name,
              system name, logo and footer), then refresh this list.
            </p>
          </div>
        )}

        {hasProfiles && (
          <>
            <div className="print-profile-field">
              <label htmlFor="print-profile-select">Company Report Profile</label>
              <select
                id="print-profile-select"
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                disabled={busy}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.profileName}
                    {profile.status && profile.status !== 'Active'
                      ? ` (${profile.status})`
                      : ''}
                  </option>
                ))}
              </select>
              <p className="muted-table-text">
                Profiles come from the global Company Report Profile Master. A
                profile saved there can be used by every user.
              </p>
            </div>

            {selectedProfile && (
              <div className="print-profile-preview">
                <div className="print-profile-logo">
                  {selectedProfile.logoUrl ? (
                    <img
                      src={selectedProfile.logoUrl}
                      alt={`${selectedProfile.companyName} Logo`}
                    />
                  ) : (
                    <span>{selectedProfile.logoText || 'LOGO'}</span>
                  )}
                </div>

                <div className="print-profile-details">
                  <h4>{selectedProfile.companyName}</h4>
                  <p>{selectedProfile.systemName}</p>
                  {selectedProfile.reportSubtitle && (
                    <p>{selectedProfile.reportSubtitle}</p>
                  )}
                  {selectedProfile.status && (
                    <span
                      className={`status-badge ${selectedStatus.replace(/\s+/g, '-')}`}
                    >
                      {selectedProfile.status}
                    </span>
                  )}
                </div>
              </div>
            )}

            {selectedProfile?.footerNote && (
              <p className="print-profile-footer-note">
                <strong>Footer:</strong> {selectedProfile.footerNote}
              </p>
            )}

            {selectedProfile && selectedProfile.status !== 'Active' && (
              <div className="info-box">
                This profile is {selectedProfile.status}. It is still listed
                because it exists in the master, and the print-out will use its
                branding.
              </div>
            )}
          </>
        )}
      </Modal>
    </PrintProfileContext.Provider>
  )
}

export default PrintProfileProvider
