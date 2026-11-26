import { useEffect, useState } from 'react'
import AlertMessage from './AlertMessage'
import { STALE_BACKEND_EVENT, STALE_BACKEND_MESSAGE } from '../../api/backendBuild'

/**
 * Single, dismissible banner shown when the API answering this page is older
 * than the frontend build (a stale Docker image or a `uvicorn` process from an
 * older checkout). Raised by `apiClient` after an unexpected 404 and confirmed
 * against `GET /health`; see `src/api/backendBuild.js`.
 */
function StaleBackendNotice() {
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    const handler = (event) => setDetail(event?.detail || { message: STALE_BACKEND_MESSAGE })
    window.addEventListener(STALE_BACKEND_EVENT, handler)
    return () => window.removeEventListener(STALE_BACKEND_EVENT, handler)
  }, [])

  if (!detail) return null

  return (
    <div className="stale-backend-notice" role="status" aria-live="polite">
      <AlertMessage
        tone="warning"
        message={detail.message || STALE_BACKEND_MESSAGE}
        onDismiss={() => setDetail(null)}
      />
    </div>
  )
}

export default StaleBackendNotice
