import { useEffect, useState } from 'react'
import { getCompanyReportProfiles } from '../api/companyReportProfileApi'

export function useCompanyPrintProfile() {
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const profiles = await getCompanyReportProfiles()
        if (cancelled) return

        const active =
          profiles.find((p) => p.status === 'Active') || profiles[0] || null
        setProfile(active)
      } catch {
        if (!cancelled) setProfile(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return profile
}
