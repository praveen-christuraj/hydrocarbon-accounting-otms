import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/common/Icon'
import AlertMessage from '../components/common/AlertMessage'
import { usePrintDialog } from '../components/print/printProfileContext'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import {
  getStockAnomaliesOverview,
  refreshAssetMetricProfiles,
} from '../api/stockAnomaliesApi'
import { logUiAction } from '../utils/actionLogger'

/**
 * Pure SVG trend sparkline for CUSUM creeping-loss / gain daily series.
 * Adapts automatically to Light & Dark Navy CSS tokens and prints crisply.
 */
function CusumTrendChart({ points = [], title = '' }) {
  if (!points || points.length < 2) {
    return (
      <div className="ai-fact-hint">
        Not enough daily points to render a trend chart for this asset.
      </div>
    )
  }

  const width = 560
  const height = 160
  const padX = 36
  const padY = 18
  const values = points.map((p) => Number(p.loss_gain_pct || 0))
  const minVal = Math.min(...values, -0.5)
  const maxVal = Math.max(...values, 0.5)
  const range = Math.max(maxVal - minVal, 0.2)

  const xOf = (idx) =>
    padX + (idx / Math.max(points.length - 1, 1)) * (width - padX * 2)
  const yOf = (val) =>
    height - padY - ((val - minVal) / range) * (height - padY * 2)

  const zeroY = yOf(0)
  const polyline = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div className="ai-fact-label" style={{ marginBottom: 4 }}>
        {title} — Daily Material Balance Loss / Gain (%)
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: '100%',
          maxWidth: 620,
          height: 165,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 6,
        }}
        role="img"
        aria-label={`${title} daily loss gain percentage trend`}
      >
        <line
          x1={padX}
          y1={zeroY}
          x2={width - padX}
          y2={zeroY}
          stroke="var(--border-strong)"
          strokeDasharray="4 4"
        />
        <text x={6} y={zeroY + 4} fontSize="10" fill="var(--text-muted)">
          0%
        </text>
        <text x={6} y={padY + 4} fontSize="10" fill="var(--text-muted)">
          {maxVal.toFixed(1)}%
        </text>
        <text x={6} y={height - padY + 4} fontSize="10" fill="var(--text-muted)">
          {minVal.toFixed(1)}%
        </text>
        <polyline
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.2"
          points={polyline}
        />
        {values.map((v, i) => (
          <circle
            key={`pt-${i}`}
            cx={xOf(i)}
            cy={yOf(v)}
            r="3"
            fill={v < -0.3 ? 'var(--danger)' : v > 0.3 ? 'var(--warning)' : 'var(--primary)'}
          >
            <title>
              {points[i].date}: {v >= 0 ? '+' : ''}{v.toFixed(3)}% ({points[i].loss_gain_nsv_bbl} BBL)
            </title>
          </circle>
        ))}
        <text x={padX} y={height - 3} fontSize="10" fill="var(--text-muted)">
          {points[0]?.date}
        </text>
        <text
          x={width - padX}
          y={height - 3}
          fontSize="10"
          fill="var(--text-muted)"
          textAnchor="end"
        >
          {points[points.length - 1]?.date}
        </text>
      </svg>
    </div>
  )
}

function StockAnomalyAnalytics({ locations = [] }) {
  const [searchParams] = useSearchParams()
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()

  const [locationCode, setLocationCode] = useState(searchParams.get('locationCode') || '')
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') || '')
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') || '')
  const [activeTab, setActiveTab] = useState('loss-gain')
  const [selectedCusumIdx, setSelectedCusumIdx] = useState(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [feedback, setFeedback] = useState({ type: '', text: '' })

  const loadAnalytics = useCallback(async () => {
    setLoading(true)
    setFeedback({ type: '', text: '' })
    try {
      const result = await getStockAnomaliesOverview({
        locationCode,
        dateFrom,
        dateTo,
      })
      setData(result)
      setSelectedCusumIdx(0)
    } catch (err) {
      setFeedback({ type: 'error', text: err?.message || 'Failed to load stock anomaly analytics.' })
    } finally {
      setLoading(false)
    }
  }, [locationCode, dateFrom, dateTo])

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  const handleRefreshProfiles = async () => {
    setRefreshing(true)
    setFeedback({ type: '', text: '' })
    try {
      const res = await refreshAssetMetricProfiles(locationCode)
      logUiAction('Stock Anomaly Analytics', 'Refresh Asset Metric Profiles', {
        locationCode: locationCode || 'ALL',
        profilesUpdated: res?.profiles_updated,
      })
      setFeedback({
        type: 'success',
        text: `Refreshed ${res?.profiles_updated ?? 0} cached statistical profiles across ${res?.assets_scanned ?? 0} assets.`,
      })
      await loadAnalytics()
    } catch (err) {
      setFeedback({ type: 'error', text: err?.message || 'Failed to refresh asset profiles.' })
    } finally {
      setRefreshing(false)
    }
  }

  const handlePrint = () => {
    requestPrint({
      module: 'Stock Anomaly Analytics',
      reportName: 'Hydrocarbon Accounting & Stock Anomaly Analytics',
      onBeforePrint: () => {
        logUiAction('Stock Anomaly Analytics', 'Print Report', {
          locationCode: locationCode || 'ALL',
          dateFrom,
          dateTo,
        })
      },
    })
  }

  const kpis = data?.kpis || {}
  const lossGainEvents = data?.loss_gain_events || []
  const cusumAlerts = data?.cusum_alerts || []
  const transitAlerts = data?.transit_alerts || []
  const chronicBias = data?.chronic_bias || []
  const openTickets = data?.open_ticket_abnormalities || []
  const readinessChecks = data?.readiness_checks || []
  const sequenceBreaks = data?.sequence_breaks || []

  const selectedCusum = useMemo(
    () => cusumAlerts[selectedCusumIdx] || cusumAlerts[0] || null,
    [cusumAlerts, selectedCusumIdx]
  )

  return (
    <div className="page-container">
      <div className="print-only" style={{ marginBottom: 12 }}>
        <strong>{profile?.companyName || 'Hydrocarbon Accounting System'}</strong>
        <div>Hydrocarbon Accounting &amp; Stock Anomaly Analytics Report</div>
      </div>

      <div className="page-title">
        <div>
          <h2>Hydrocarbon Accounting &amp; Stock Anomaly Analytics</h2>
          <p>
            Material Balance Loss/Gain root-cause separation (GSV vs NSV), CUSUM creeping-loss
            radar, custody-transfer &amp; seal security intelligence, Tier 2 ML ticket screening,
            and terminal close readiness.
          </p>
        </div>

        <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={refreshing}
            onClick={handleRefreshProfiles}
          >
            <Icon name="refresh" size={15} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh Profiles'}</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={handlePrint}>
            <Icon name="print" size={15} />
            <span>Print</span>
          </button>
        </div>
      </div>

      {feedback.text && (
        <AlertMessage
          type={feedback.type === 'error' ? 'error' : 'success'}
          message={feedback.text}
          onClose={() => setFeedback({ type: '', text: '' })}
        />
      )}

      {/* Filter Bar */}
      <div className="card no-print" style={{ marginBottom: 14 }}>
        <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ minWidth: 190, marginBottom: 0 }}>
            <label>Location</label>
            <select
              value={locationCode}
              onChange={(e) => setLocationCode(e.target.value)}
            >
              <option value="">All Accessible Locations</option>
              {(locations || []).map((loc) => (
                <option key={loc.locationCode || loc.location_code} value={loc.locationCode || loc.location_code}>
                  {loc.locationCode || loc.location_code} — {loc.locationName || loc.location_name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            disabled={loading}
            onClick={loadAnalytics}
          >
            {loading ? 'Scanning...' : 'Run Diagnostics'}
          </button>

          <Link to="/ai-assistant" className="btn btn-secondary">
            <Icon name="compass" size={15} />
            <span>Ask AI Guide</span>
          </Link>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="ai-kpi-grid">
        <div className={`ai-kpi-card ${(kpis.readiness_score ?? 100) >= 85 ? 'tone-success' : 'tone-warning'}`}>
          <span className="ai-kpi-label">Close Readiness</span>
          <span className="ai-kpi-value">{kpis.readiness_score ?? 100}%</span>
          <span className="ai-kpi-sub">{readinessChecks.length} check item(s)</span>
        </div>

        <div className={`ai-kpi-card ${(kpis.loss_gain_warnings ?? 0) > 0 ? 'tone-warning' : 'tone-info'}`}>
          <span className="ai-kpi-label">Loss / Gain Events</span>
          <span className="ai-kpi-value">{kpis.loss_gain_events ?? 0}</span>
          <span className="ai-kpi-sub">{kpis.loss_gain_warnings ?? 0} high severity</span>
        </div>

        <div className={`ai-kpi-card ${(kpis.cusum_drift_alerts ?? 0) > 0 ? 'tone-warning' : 'tone-info'}`}>
          <span className="ai-kpi-label">CUSUM Drift Alerts</span>
          <span className="ai-kpi-value">{kpis.cusum_drift_alerts ?? 0}</span>
          <span className="ai-kpi-sub">Sustained creeping bias</span>
        </div>

        <div className={`ai-kpi-card ${(kpis.seal_security_escalations ?? 0) > 0 ? 'tone-danger' : 'tone-info'}`}>
          <span className="ai-kpi-label">Transit &amp; Seal Alerts</span>
          <span className="ai-kpi-value">{kpis.transit_variance_alerts ?? 0}</span>
          <span className="ai-kpi-sub">{kpis.seal_security_escalations ?? 0} seal mismatch(es)</span>
        </div>

        <div className={`ai-kpi-card ${(kpis.open_ticket_abnormalities ?? 0) > 0 ? 'tone-warning' : 'tone-success'}`}>
          <span className="ai-kpi-label">Open Ticket Flags</span>
          <span className="ai-kpi-value">{kpis.open_ticket_abnormalities ?? 0}</span>
          <span className="ai-kpi-sub">Pre-approval Draft/Submitted</span>
        </div>

        <div className={`ai-kpi-card ${(kpis.sequence_breaks ?? 0) > 0 ? 'tone-danger' : 'tone-success'}`}>
          <span className="ai-kpi-label">Sequence Breaks</span>
          <span className="ai-kpi-value">{kpis.sequence_breaks ?? 0}</span>
          <span className="ai-kpi-sub">Out-Turn stock continuity</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="ai-tabs no-print" role="tablist">
        <button
          type="button"
          className={`ai-tab-btn ${activeTab === 'loss-gain' ? 'active' : ''}`}
          onClick={() => setActiveTab('loss-gain')}
        >
          <Icon name="barChart" size={15} />
          <span>Loss &amp; Gain Diagnostics ({lossGainEvents.length})</span>
        </button>
        <button
          type="button"
          className={`ai-tab-btn ${activeTab === 'cusum' ? 'active' : ''}`}
          onClick={() => setActiveTab('cusum')}
        >
          <Icon name="trendingUp" size={15} />
          <span>CUSUM Creeping-Loss Radar ({cusumAlerts.length})</span>
        </button>
        <button
          type="button"
          className={`ai-tab-btn ${activeTab === 'transit' ? 'active' : ''}`}
          onClick={() => setActiveTab('transit')}
        >
          <Icon name="ship" size={15} />
          <span>Custody Transfer &amp; Seals ({transitAlerts.length})</span>
        </button>
        <button
          type="button"
          className={`ai-tab-btn ${activeTab === 'open-tickets' ? 'active' : ''}`}
          onClick={() => setActiveTab('open-tickets')}
        >
          <Icon name="shieldCheck" size={15} />
          <span>Open Ticket Abnormalities ({openTickets.length})</span>
        </button>
        <button
          type="button"
          className={`ai-tab-btn ${activeTab === 'readiness' ? 'active' : ''}`}
          onClick={() => setActiveTab('readiness')}
        >
          <Icon name="clipboardList" size={15} />
          <span>Terminal Readiness ({readinessChecks.length})</span>
        </button>
      </div>

      {/* Tab 1: Loss & Gain Diagnostics */}
      {activeTab === 'loss-gain' && (
        <div className="card">
          <div className="card-body">
            {lossGainEvents.length === 0 ? (
              <p className="ai-fact-hint">
                No daily Material Balance Loss/Gain events beyond tolerance were found for the
                selected scope and date window.
              </p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Location / Tank</th>
                      <th>Book Closing (NSV)</th>
                      <th>Actual Closing (NSV)</th>
                      <th>NSV Loss/Gain</th>
                      <th>GSV Loss/Gain</th>
                      <th>Automated Root-Cause &amp; Directive</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lossGainEvents.map((ev, idx) => (
                      <tr key={`lg-${idx}`}>
                        <td>{ev.accounting_date}</td>
                        <td>
                          <strong>{ev.location_code}</strong> / {ev.tank_asset_code}
                          <div className="ai-fact-hint">{ev.product_name || '—'}</div>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          {Number(ev.book_closing_nsv_bbl).toLocaleString()}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          {Number(ev.actual_closing_nsv_bbl).toLocaleString()}
                        </td>
                        <td>
                          <span className={`ai-pill ${ev.severity === 'warning' ? 'ai-pill-warning' : 'ai-pill-info'}`}>
                            {ev.loss_gain_nsv_bbl >= 0 ? '+' : ''}{Number(ev.loss_gain_nsv_bbl).toLocaleString()} BBL ({ev.loss_gain_nsv_pct >= 0 ? '+' : ''}{ev.loss_gain_nsv_pct}%)
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          {ev.loss_gain_gsv_bbl >= 0 ? '+' : ''}{Number(ev.loss_gain_gsv_bbl).toLocaleString()} BBL ({ev.loss_gain_gsv_pct >= 0 ? '+' : ''}{ev.loss_gain_gsv_pct}%)
                        </td>
                        <td>
                          <strong>{ev.root_cause}</strong>
                          <div className="ai-fact-hint">{ev.directive}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: CUSUM Creeping-Loss Radar */}
      {activeTab === 'cusum' && (
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {cusumAlerts.length === 0 ? (
              <p className="ai-fact-hint">
                No sustained multi-day CUSUM creeping losses or creeping gains detected.
              </p>
            ) : (
              <>
                {selectedCusum && (
                  <CusumTrendChart
                    points={selectedCusum.trend_points}
                    title={`${selectedCusum.location_code} / ${selectedCusum.tank_asset_code} (${selectedCusum.direction})`}
                  />
                )}
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Location / Tank</th>
                        <th>Direction</th>
                        <th>Days</th>
                        <th>Rolling Mean</th>
                        <th>Cumulative</th>
                        <th>Streak</th>
                        <th>Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cusumAlerts.map((c, idx) => (
                        <tr
                          key={`cusum-${idx}`}
                          onClick={() => setSelectedCusumIdx(idx)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <strong>{c.location_code}</strong> / {c.tank_asset_code}
                          </td>
                          <td>
                            <span className={`ai-pill ${c.severity === 'warning' ? 'ai-pill-warning' : 'ai-pill-info'}`}>
                              {c.direction}
                            </span>
                          </td>
                          <td>{c.sample_count}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {c.rolling_mean_pct >= 0 ? '+' : ''}{c.rolling_mean_pct}%
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {c.cumulative_pct >= 0 ? '+' : ''}{c.cumulative_pct}%
                          </td>
                          <td>{c.streak_length}d</td>
                          <td>{c.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Custody Transfer & Seal Security */}
      {activeTab === 'transit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="card-header">
              <h3 style={{ margin: 0, fontSize: '0.96rem' }}>
                Custody-Transfer Transit Variances &amp; Seal Escalations
              </h3>
            </div>
            <div className="card-body">
              {transitAlerts.length === 0 ? (
                <p className="ai-fact-hint">
                  No custody-transfer variances or seal mismatches detected across accessible
                  Tanker, Barge, and Movement Mapping records.
                </p>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Module</th>
                        <th>Reference</th>
                        <th>Asset</th>
                        <th>Source → Target (NSV)</th>
                        <th>Variance</th>
                        <th>Directive</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transitAlerts.map((a, idx) => (
                        <tr key={`tr-${idx}`}>
                          <td>{a.module}</td>
                          <td>
                            <Link to={a.route}>{a.reference}</Link>
                          </td>
                          <td>{a.asset_code}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {Number(a.source_nsv_bbl).toLocaleString()} → {Number(a.target_nsv_bbl).toLocaleString()} BBL
                          </td>
                          <td>
                            <div className="ai-checks-badges">
                              <span className={`ai-pill ${a.seal_issue ? 'ai-pill-danger' : 'ai-pill-warning'}`}>
                                {a.variance_bbl >= 0 ? '+' : ''}{a.variance_bbl} BBL ({a.variance_pct >= 0 ? '+' : ''}{a.variance_pct}%)
                              </span>
                              {a.seal_issue && (
                                <span className="ai-pill ai-pill-danger">SEAL MISMATCH</span>
                              )}
                            </div>
                          </td>
                          <td>{a.directive}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {chronicBias.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 style={{ margin: 0, fontSize: '0.96rem' }}>
                  Chronic Asset / Route Transit Bias Profiles
                </h3>
              </div>
              <div className="card-body">
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Module</th>
                        <th>Asset / Route</th>
                        <th>Reconciled Movements</th>
                        <th>Mean Variance</th>
                        <th>Recommendation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chronicBias.map((b, idx) => (
                        <tr key={`cb-${idx}`}>
                          <td>{b.module}</td>
                          <td><strong>{b.asset_code}</strong></td>
                          <td>{b.trips_analyzed}</td>
                          <td>
                            <span className="ai-pill ai-pill-warning">
                              {b.mean_variance_pct >= 0 ? '+' : ''}{b.mean_variance_pct}% ({b.direction})
                            </span>
                          </td>
                          <td>{b.directive}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Open Ticket Abnormalities */}
      {activeTab === 'open-tickets' && (
        <div className="card">
          <div className="card-body">
            {openTickets.length === 0 ? (
              <p className="ai-fact-hint">
                No Draft or Submitted tickets currently carry open entry-check or Tier 2 ML flags.
              </p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Status</th>
                      <th>Location / Asset</th>
                      <th>Date</th>
                      <th>Flags</th>
                      <th>Primary Finding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTickets.map((t) => (
                      <tr key={t.transaction_id}>
                        <td>
                          <Link to={`/operation-transactions/${t.transaction_id}`}>
                            <strong>{t.ticket_number}</strong>
                          </Link>
                        </td>
                        <td>
                          <span className="ai-pill ai-pill-neutral">{t.status}</span>
                        </td>
                        <td>{t.location_code || '—'} / {t.asset_code || '—'}</td>
                        <td>{t.operation_date || '—'}</td>
                        <td>
                          <div className="ai-checks-badges">
                            {t.open_warnings > 0 && (
                              <span className="ai-pill ai-pill-warning">{t.open_warnings}W</span>
                            )}
                            {t.open_notices > 0 && (
                              <span className="ai-pill ai-pill-info">{t.open_notices}N</span>
                            )}
                            {t.reviewed > 0 && (
                              <span className="ai-pill ai-pill-success">{t.reviewed} Kept</span>
                            )}
                          </div>
                        </td>
                        <td>{t.top_finding}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Terminal Close Readiness */}
      {activeTab === 'readiness' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="card-body">
              {readinessChecks.length === 0 ? (
                <p className="ai-fact-hint">
                  All terminal operational and month-end readiness checks are clear.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {readinessChecks.map((item) => (
                    <div
                      key={item.code}
                      className={`ai-finding-card ${
                        item.severity === 'warning' ? 'severity-warning' : 'severity-info'
                      }`}
                    >
                      <div className="ai-finding-head">
                        <div className="ai-finding-title">
                          <Icon
                            name={item.severity === 'warning' ? 'alertTriangle' : 'info'}
                            size={15}
                          />
                          <span>{item.label}</span>
                        </div>
                        <div className="ai-checks-badges">
                          <span className="ai-pill ai-pill-neutral">{item.value}</span>
                          {item.route && (
                            <Link to={item.route} className="btn btn-sm btn-secondary">
                              Open Screen
                            </Link>
                          )}
                        </div>
                      </div>
                      <p className="ai-finding-message">{item.hint}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {sequenceBreaks.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 style={{ margin: 0, fontSize: '0.96rem' }}>
                  Out-Turn Stock Sequence Discontinuities
                </h3>
              </div>
              <div className="card-body">
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Location / Tank</th>
                        <th>Date</th>
                        <th>Ticket</th>
                        <th>Expected Prev (NSV)</th>
                        <th>Recorded Prev (NSV)</th>
                        <th>Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sequenceBreaks.map((b, idx) => (
                        <tr key={`sb-${idx}`}>
                          <td><strong>{b.location_code}</strong> / {b.tank_asset_code}</td>
                          <td>{b.accounting_date || '—'}</td>
                          <td>{b.ticket_number || '—'}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{b.expected_previous_nsv_bbl}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{b.actual_previous_nsv_bbl}</td>
                          <td>
                            <span className="ai-pill ai-pill-danger">
                              {b.gap_bbl >= 0 ? '+' : ''}{b.gap_bbl} BBL
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default StockAnomalyAnalytics
