import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../common/Icon'
import { CRUD_ACTIONS } from '../../utils/permissionCatalog'

const nameKey = (name) => String(name || '').trim().toLowerCase()

function TriStateCheckbox({ checked, indeterminate, disabled, onChange, label }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked
  }, [indeterminate, checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={label}
      title={label}
    />
  )
}

/**
 * Module × action permission grid (View / Create / Edit / Delete / Other).
 *
 * Props
 *  - groups      result of buildPermissionGroups()
 *  - selected    Set of lower-cased permission names
 *  - onChange    (nextSet) => void (edit mode)
 *  - editable    show checkboxes instead of read-only marks
 *  - canAssign   (entry) => boolean, whether the current user may toggle the entry
 *
 * Selecting any action in a module also selects that module's View permission;
 * clearing View clears the module, because every screen is gated by View.
 */
function PermissionMatrix({ groups, selected, onChange, editable = false, canAssign = () => true }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)

  const isSelected = (entry) => Boolean(entry) && selected.has(nameKey(entry.permissionName))
  const isAvailable = (entry) =>
    Boolean(entry?.permission) && String(entry.permission.status || 'Active') === 'Active'
  const assignable = (entry) => editable && isAvailable(entry) && canAssign(entry)

  const visibleCategories = useMemo(() => {
    const text = search.trim().toLowerCase()
    return groups.categories
      .filter((group) => !category || group.category === category)
      .map((group) => ({
        ...group,
        modules: group.modules.filter((module) => {
          const matchesText =
            !text ||
            module.moduleName.toLowerCase().includes(text) ||
            module.entries.some(
              (entry) =>
                entry.permissionName.toLowerCase().includes(text) ||
                String(entry.description || '').toLowerCase().includes(text)
            )
          const matchesSelected =
            !selectedOnly || module.entries.some((entry) => selected.has(nameKey(entry.permissionName)))
          return matchesText && matchesSelected
        }),
      }))
      .filter((group) => group.modules.length > 0)
  }, [groups, search, category, selectedOnly, selected])

  // ---- selection helpers -------------------------------------------------
  const applyToggle = (next, module, entry, checked) => {
    if (!assignable(entry)) return
    const key = nameKey(entry.permissionName)
    if (checked) {
      next.add(key)
      const view = module.cells.View
      if (view && view !== entry && assignable(view)) next.add(nameKey(view.permissionName))
    } else {
      next.delete(key)
      if (entry === module.cells.View) {
        for (const other of module.entries) {
          if (other !== entry && assignable(other)) next.delete(nameKey(other.permissionName))
        }
      }
    }
  }

  const commit = (mutate) => {
    const next = new Set(selected)
    mutate(next)
    onChange?.(next)
  }

  const summarise = (entries) => {
    const candidates = entries.filter(assignable)
    const count = candidates.filter(isSelected).length
    return {
      checked: candidates.length > 0 && count === candidates.length,
      indeterminate: count > 0 && count < candidates.length,
      disabled: candidates.length === 0,
    }
  }

  const visibleModules = visibleCategories.flatMap((group) => group.modules)
  const columnEntries = (action) =>
    visibleModules.map((module) => [module, module.cells[action]]).filter(([, entry]) => entry)

  const setModule = (module, checked) =>
    commit((next) => {
      for (const entry of module.entries) {
        if (!assignable(entry)) continue
        if (checked) next.add(nameKey(entry.permissionName))
        else next.delete(nameKey(entry.permissionName))
      }
    })

  const setColumn = (action, checked) =>
    commit((next) => {
      for (const [module, entry] of columnEntries(action)) applyToggle(next, module, entry, checked)
    })

  const setCategoryGroup = (group, checked) =>
    commit((next) => {
      for (const module of group.modules) {
        for (const entry of module.entries) {
          if (!assignable(entry)) continue
          if (checked) next.add(nameKey(entry.permissionName))
          else next.delete(nameKey(entry.permissionName))
        }
      }
    })

  // ---- rendering ---------------------------------------------------------
  const entryTitle = (entry) => {
    const parts = [entry.permissionName]
    if (entry.description) parts.push(entry.description)
    if (!entry.permission) parts.push('Not available – run Sync Standard Permissions')
    else if (!isAvailable(entry)) parts.push(`Status: ${entry.permission.status}`)
    else if (editable && !canAssign(entry)) parts.push('You can only grant permissions you hold yourself')
    return parts.join(' – ')
  }

  const renderCell = (module, entry) => {
    if (!entry) return <span className="matrix-na" aria-hidden="true" />
    const checked = isSelected(entry)
    if (!editable) {
      return checked ? (
        <span className="matrix-granted" title={entryTitle(entry)}>
          <Icon name="check" size={15} title={`${entry.permissionName}: granted`} />
        </span>
      ) : (
        <span className="matrix-denied" title={entryTitle(entry)} aria-label={`${entry.permissionName}: not granted`}>
          –
        </span>
      )
    }
    return (
      <label className={`matrix-check ${isAvailable(entry) ? '' : 'is-unavailable'}`.trim()} title={entryTitle(entry)}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!assignable(entry)}
          onChange={(event) => commit((next) => applyToggle(next, module, entry, event.target.checked))}
          aria-label={entry.permissionName}
        />
      </label>
    )
  }

  const renderOther = (module, entry) => {
    const checked = isSelected(entry)
    if (!editable) {
      return (
        <span
          key={entry.permissionName}
          className={`matrix-chip ${checked ? 'is-granted' : 'is-denied'}`}
          title={entryTitle(entry)}
        >
          {checked && <Icon name="check" size={12} />}
          {entry.permissionName}
        </span>
      )
    }
    return (
      <label
        key={entry.permissionName}
        className={`matrix-chip ${checked ? 'is-granted' : ''} ${isAvailable(entry) ? '' : 'is-unavailable'}`.trim()}
        title={entryTitle(entry)}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={!assignable(entry)}
          onChange={(event) => commit((next) => applyToggle(next, module, entry, event.target.checked))}
        />
        {entry.permissionName}
      </label>
    )
  }

  const columnCount = CRUD_ACTIONS.length + 2 + (editable ? 1 : 0)

  return (
    <div className="permission-matrix-wrap">
      <div className="matrix-toolbar">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search modules or permissions"
          aria-label="Search modules or permissions"
        />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {groups.categories.map((group) => (
            <option key={group.category} value={group.category}>
              {group.category}
            </option>
          ))}
        </select>
        <label className="matrix-toggle">
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => setSelectedOnly(event.target.checked)}
          />
          Granted only
        </label>
        {editable && (
          <span className="matrix-hint">Selecting an action also selects View for that module.</span>
        )}
      </div>

      <table className="permission-matrix">
        <thead>
          <tr>
            <th className="matrix-module-col">Module</th>
            {CRUD_ACTIONS.map((action) => {
              const state = summarise(columnEntries(action).map(([, entry]) => entry))
              return (
                <th key={action} className="matrix-action-col">
                  <span className="matrix-head">
                    {editable && (
                      <TriStateCheckbox
                        {...state}
                        onChange={(checked) => setColumn(action, checked)}
                        label={`Select all ${action} permissions shown`}
                      />
                    )}
                    {action}
                  </span>
                </th>
              )
            })}
            <th className="matrix-other-col">Other actions</th>
            {editable && <th className="matrix-all-col">All</th>}
          </tr>
        </thead>
        <tbody>
          {visibleCategories.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="empty-table">
                No modules match the filters.
              </td>
            </tr>
          ) : (
            visibleCategories.map((group) => {
              const entries = group.modules.flatMap((module) => module.entries)
              const grantedCount = entries.filter(isSelected).length
              const state = summarise(entries)
              return (
                <Fragment key={group.category}>
                  <tr className="matrix-category-row">
                    <td colSpan={columnCount}>
                      <span className="matrix-category">
                        {editable && (
                          <TriStateCheckbox
                            {...state}
                            onChange={(checked) => setCategoryGroup(group, checked)}
                            label={`Select all permissions in ${group.category}`}
                          />
                        )}
                        {group.category}
                        <span className="matrix-count">
                          {grantedCount} / {entries.length}
                        </span>
                      </span>
                    </td>
                  </tr>
                  {group.modules.map((module) => (
                    <tr key={module.key}>
                      <td className="matrix-module-col">{module.moduleName}</td>
                      {CRUD_ACTIONS.map((action) => (
                        <td key={action} className="matrix-action-col">
                          {renderCell(module, module.cells[action])}
                        </td>
                      ))}
                      <td className="matrix-other-col">
                        {module.other.length > 0 && (
                          <div className="matrix-chip-list">
                            {module.other.map((entry) => renderOther(module, entry))}
                          </div>
                        )}
                      </td>
                      {editable && (
                        <td className="matrix-all-col">
                          <TriStateCheckbox
                            {...summarise(module.entries)}
                            onChange={(checked) => setModule(module, checked)}
                            label={`Select all permissions for ${module.moduleName}`}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export default PermissionMatrix
