import { useCallback, useEffect, useState } from 'react'
import { getBookStockSettings, updateBookStockSettings } from '../../api/bookStockApi'
import PageHeader from '../../components/common/PageHeader'
import AlertMessage from '../../components/common/AlertMessage'
import Icon from '../../components/common/Icon'
import { logUiAction } from '../../utils/actionLogger'
import { BOOK_STOCK_MODULE, useBookStockPermissions, useBookStockReferenceData } from './bookStockShared'

const TOGGLES = [
  {
    key: 'auto_carry_opening',
    label: 'Auto-carry opening stock',
    description: 'When a new daily entry is created, opening stock defaults to the previous closing stock of the same entity, block and product. The value always remains editable.',
  },
  {
    key: 'allow_negative_closing',
    label: 'Allow negative closing stock',
    description: 'Permit a closing stock below zero (for example when dispatch exceeds available stock). Closing stock is still calculated and displayed as a negative value.',
  },
  {
    key: 'allow_negative_adjustment',
    label: 'Allow negative adjustments',
    description: 'Allow adjustment values below zero. A negative adjustment deducts stock; a positive adjustment adds stock.',
  },
]

function BookStockSettings({ loggedInUser }) {
  const reference = useBookStockReferenceData()
  const { active_products: activeProducts } = reference.data
  const { canEdit } = useBookStockPermissions(loggedInUser, 'Book Stock Settings')

  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSettings(await getBookStockSettings())
    } catch (err) {
      setError(err.message || 'Unable to load Book Stock settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const setValue = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }))
    setError('')
    setSuccess('')
  }

  const handleSave = async () => {
    if (!canEdit) {
      setError('You do not have permission to edit Book Stock settings.')
      return
    }
    try {
      setSaving(true)
      const payload = {
        ...settings,
        max_active_products: 2,
      }
      const saved = await updateBookStockSettings(payload)
      setSettings(saved)
      setSuccess('Book Stock settings saved.')
      logUiAction(BOOK_STOCK_MODULE, 'Update Book Stock Settings', payload)
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="book-stock-page">
      <PageHeader
        title="Book Stock Settings"
        description="Module-level calculation rules. The two-product limit is fixed by design and cannot be changed."
        count={settings?.updated_by ? `Updated by ${settings.updated_by}` : undefined}
        actions={
          canEdit && (
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || loading || !settings}>
              <Icon name="check" size={15} />
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

      {loading || !settings ? (
        <div className="info-box">Loading settings…</div>
      ) : (
        <>
          <div className="settings-section">
            <h3>Measurement</h3>
            <p className="muted-table-text">The unit shown on daily entries and reports when the product has no explicit unit.</p>
            <div className="settings-field">
              <label htmlFor="bs-setting-unit">Default unit</label>
              <input
                id="bs-setting-unit"
                value={settings.default_unit || ''}
                onChange={(event) => setValue('default_unit', event.target.value.toUpperCase())}
                maxLength={30}
                disabled={!canEdit}
              />
              <span className="field-hint">Volume unit applied to stock values, for example BBL.</span>
            </div>
            <div className="settings-field">
              <label htmlFor="bs-setting-products">Maximum active products</label>
              <input id="bs-setting-products" value="2 (fixed)" readOnly disabled />
              <span className="field-hint">
                Book Stock is designed for exactly two products. Active now: {activeProducts.length}
                {activeProducts.length ? ` (${activeProducts.map((product) => product.product_code).join(', ')})` : ''}.
              </span>
            </div>
          </div>

          <div className="settings-section">
            <h3>Stock rules</h3>
            {TOGGLES.map((toggle) => (
              <div key={toggle.key} className="settings-field">
                <label htmlFor={`bs-setting-${toggle.key}`} className="bs-check">
                  <input
                    id={`bs-setting-${toggle.key}`}
                    type="checkbox"
                    checked={String(settings[toggle.key]).toLowerCase() === 'yes' || settings[toggle.key] === true}
                    onChange={(event) => {
                      const raw = settings[toggle.key]
                      const onValue = typeof raw === 'boolean' ? true : 'Yes'
                      const offValue = typeof raw === 'boolean' ? false : 'No'
                      setValue(toggle.key, event.target.checked ? onValue : offValue)
                    }}
                    disabled={!canEdit}
                  />
                  <span>{toggle.label}</span>
                </label>
                <span className="field-hint">{toggle.description}</span>
              </div>
            ))}
            <div className="info-box">
              There is no approval workflow and no editing window: every daily entry can be edited or deleted at any time by a
              user holding the matching Book Stock permission, and every action is written to the audit log.
            </div>
          </div>

          <div className="print-only">
            <p>
              Book Stock settings: unit {settings.default_unit}; auto-carry opening {settings.auto_carry_opening}; negative closing{' '}
              {settings.allow_negative_closing}; negative adjustment {settings.allow_negative_adjustment}; products limited to 2.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

export default BookStockSettings
