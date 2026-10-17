import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRolePermissions, saveRolePermissions } from '../api/rolePermissionApi'
import { getPermissionCatalog } from '../api/permissionApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'
import Icon from '../components/common/Icon'
import { useConfirm } from '../components/common/ConfirmProvider'
import PermissionMatrix from '../components/rbac/PermissionMatrix'
import PresetFormDialog from '../components/rbac/PresetFormDialog'
import ApplyPresetDialog from '../components/rbac/ApplyPresetDialog'
import { useDataFilters } from '../hooks/useDataFilters'
import { usePermissions } from '../hooks/usePermissions'
import { usePermissionPresets } from '../hooks/usePermissionPresets'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'
import { buildPermissionGroups } from '../utils/permissionCatalog'
import { formatDateTime } from '../utils/format'
import {
  MAX_PERMISSION_PRESETS,
  PRESET_NAME_MAX_LENGTH,
  PRESET_NAME_MIN_LENGTH,
  PRESET_STATUSES,
  createPreset,
  deletePreset,
  presetSlots,
  recordPresetApplication,
  setPresetStatus,
  updatePreset,
} from '../utils/permissionPresetStore'
import {
  buildStandardPresets,
  isStandardPreset,
  joinPermissionNames,
  planRoleApplication,
  presetModules,
  resolvePreset,
  roleLockReason,
  splitPermissionNames,
} from '../utils/permissionPresets'

const MODULE = 'Permission Presets'
const nameKey = (name) => String(name || '').trim().toLowerCase()

const COLUMNS = [
  { key: 'presetName', label: 'Preset' },
  { key: 'type', label: 'Type', type: 'select' },
  { key: 'description', label: 'Description' },
  { key: 'permissionCount', label: 'Permissions', type: 'number' },
  { key: 'moduleList', label: 'Modules' },
  { key: 'permissionList', label: 'Permission Names' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'timesApplied', label: 'Times Applied', type: 'number' },
  { key: 'lastAppliedAt', label: 'Last Applied', type: 'date' },
  { key: 'updatedAt', label: 'Updated At', type: 'date' },
  { key: 'createdBy', label: 'Created By' },
]

function PermissionPresets({ roles, permissions, rolePermissionAssignments, reloadRolePermissions, loggedInUser }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { hasPermission, isAdmin } = usePermissions(loggedInUser)
  // The catalog has no separate preset permissions (backend frozen): presets
  // shape role permissions, so they follow Role Permission Assignment.
  const canEdit = hasPermission('Edit Role Permission Assignment')
  const actorName = loggedInUser?.fullName || loggedInUser?.username || ''

  const savedPresets = usePermissionPresets()
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback

  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()
  const [formDialog, setFormDialog] = useState(null)
  const [formError, setFormError] = useState('')
  const [applyDialog, setApplyDialog] = useState(null)
  const [viewPreset, setViewPreset] = useState(null)
  const dialogKey = useRef(0)
  const nextKey = () => {
    dialogKey.current += 1
    return dialogKey.current
  }

  useEffect(() => {
    let cancelled = false
    getPermissionCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data)
      })
      .catch((error) => {
        if (!cancelled) setCatalogError(error.message || 'Unable to load the permission catalog.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Same permission source as Role Permission Assignment: the full list when
  // the user can view Permission Master, plus everything assigned to a role.
  const knownPermissions = useMemo(() => {
    const byId = new Map()
    for (const permission of permissions || []) byId.set(permission.id, permission)
    for (const assignment of rolePermissionAssignments || []) {
      for (const permission of assignment.permissions || []) {
        if (!byId.has(permission.id)) byId.set(permission.id, permission)
      }
    }
    return [...byId.values()]
  }, [permissions, rolePermissionAssignments])

  const groups = useMemo(() => buildPermissionGroups(catalog, knownPermissions), [catalog, knownPermissions])

  const actorPermissionNames = useMemo(
    () =>
      new Set(
        (loggedInUser?.permissions || []).map((permission) =>
          nameKey(permission.permissionName || permission.permission_name)
        )
      ),
    [loggedInUser]
  )
  const canAssign = useMemo(
    () => (entry) => isAdmin || actorPermissionNames.has(nameKey(entry.permissionName)),
    [isAdmin, actorPermissionNames]
  )

  const roleRows = useMemo(
    () =>
      (roles || []).map((role) => {
        const assignment = (rolePermissionAssignments || []).find((item) => String(item.roleId) === String(role.id))
        const assigned = assignment?.permissions || []
        return {
          id: role.id,
          roleName: role.roleName,
          description: role.description || '',
          status: role.status,
          assigned,
          lockReason: roleLockReason({ roleName: role.roleName, status: role.status, assigned, isAdmin, actorPermissionNames }),
        }
      }),
    [roles, rolePermissionAssignments, isAdmin, actorPermissionNames]
  )

  const standardPresets = useMemo(() => buildStandardPresets(groups), [groups])
  const allPresets = useMemo(
    () => [
      ...[...savedPresets]
        .sort((a, b) => a.presetName.localeCompare(b.presetName))
        .map((preset) => ({ ...preset, type: 'Saved' })),
      ...standardPresets,
    ],
    [savedPresets, standardPresets]
  )

  const rows = useMemo(
    () =>
      allPresets.map((preset) => {
        const modules = presetModules(preset, groups)
        const resolution = resolvePreset(preset, groups, canAssign)
        return {
          ...preset,
          permissionCount: preset.permissionNames.length,
          modules,
          moduleList: modules.join(', '),
          permissionList: joinPermissionNames(preset.permissionNames),
          unavailableCount: resolution.inactive.length + resolution.unknown.length,
          outOfScopeCount: resolution.outOfScope.length,
          assignableCount: resolution.assignable.length,
        }
      }),
    [allPresets, groups, canAssign]
  )

  const filters = useDataFilters(rows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)
  const slots = presetSlots()
  const limitReached = slots.remaining <= 0
  const catalogReady = Boolean(catalog)
  const anyDialogOpen = Boolean(formDialog || applyDialog || viewPreset)

  /* ------------------------------------------------------------- actions */

  const clearMessages = () => {
    clearSuccess()
    clearError()
  }

  const openCreate = () => {
    if (!canEdit || limitReached) return
    clearMessages()
    setFormError('')
    setFormDialog({ preset: null, key: nextKey() })
    logUiAction(MODULE, 'Open New Preset')
  }

  const openEdit = (preset) => {
    if (!canEdit || isStandardPreset(preset)) return
    clearMessages()
    setFormError('')
    setFormDialog({ preset, key: nextKey() })
    logUiAction(MODULE, 'Open Edit Preset', { preset: preset.presetName })
  }

  const handleFormSubmit = (values) => {
    if (!canEdit) return
    try {
      if (formDialog.preset) {
        const updated = updatePreset(formDialog.preset.id, values, actorName)
        logUiAction(MODULE, 'Update Preset', { preset: updated.presetName, permissions: updated.permissionNames.length })
        notifySuccess(`Preset “${updated.presetName}” updated.`)
      } else {
        const created = createPreset(values, actorName)
        logUiAction(MODULE, 'Create Preset', { preset: created.presetName, permissions: created.permissionNames.length })
        notifySuccess(`Preset “${created.presetName}” saved with ${created.permissionNames.length} permission(s).`)
      }
      setFormDialog(null)
      setFormError('')
    } catch (error) {
      setFormError(error.message)
    }
  }

  const handleToggleStatus = (preset) => {
    if (!canEdit || isStandardPreset(preset)) return
    clearMessages()
    try {
      const next = preset.status === 'Active' ? 'Inactive' : 'Active'
      setPresetStatus(preset.id, next, actorName)
      logUiAction(MODULE, next === 'Active' ? 'Activate Preset' : 'Deactivate Preset', { preset: preset.presetName })
      notifySuccess(
        next === 'Active'
          ? `Preset “${preset.presetName}” activated.`
          : `Preset “${preset.presetName}” deactivated. It keeps its slot and can be activated again.`
      )
    } catch (error) {
      notifyError(error.message)
    }
  }

  const handleDelete = async (preset) => {
    if (!canEdit || isStandardPreset(preset)) return
    clearMessages()
    const confirmed = await confirm({
      title: 'Delete preset',
      message: `Delete the preset “${preset.presetName}”?`,
      details:
        preset.timesApplied > 0
          ? `It was applied ${preset.timesApplied} time(s). Roles keep the permissions they received, and those changes stay in the audit log. The preset slot is freed.`
          : 'The preset slot is freed. Roles are not changed.',
      tone: 'danger',
      confirmLabel: 'Delete',
      module: MODULE,
    })
    if (!confirmed) return
    try {
      deletePreset(preset.id)
      logUiAction(MODULE, 'Delete Preset', { preset: preset.presetName })
      notifySuccess(`Preset “${preset.presetName}” deleted.`)
    } catch (error) {
      notifyError(error.message)
    }
  }

  const openApply = (preset) => {
    if (!canEdit) return
    clearMessages()
    setApplyDialog({ preset, key: nextKey() })
    logUiAction(MODULE, 'Open Apply Preset', { preset: preset.presetName })
  }

  /** Write the preset to each role through the audited role-permission endpoint. */
  const applyToRoles = async ({ mode, roles: targetRoles, onProgress }) => {
    const preset = applyDialog.preset
    const entries = resolvePreset(preset, groups, canAssign).assignable
    const results = []
    for (let index = 0; index < targetRoles.length; index += 1) {
      const role = targetRoles[index]
      onProgress?.(`Applying ${index + 1} of ${targetRoles.length}…`)
      try {
        // Read the role's current permissions first, so "add" never drops a
        // grant made since this page was loaded.
        const current = await getRolePermissions(role.id)
        const plan = planRoleApplication({ assigned: current.permissions, entries, mode })
        await saveRolePermissions(role.id, plan.permissionIds)
        results.push({ roleId: role.id, roleName: role.roleName, ok: true, ...plan })
      } catch (error) {
        results.push({ roleId: role.id, roleName: role.roleName, ok: false, message: error.message || 'Save failed' })
      }
    }
    const succeeded = results.filter((item) => item.ok)
    if (!isStandardPreset(preset)) recordPresetApplication(preset.id, succeeded.length)
    logUiAction(MODULE, 'Apply Preset', {
      preset: preset.presetName,
      mode,
      roles: targetRoles.length,
      succeeded: succeeded.length,
    })
    await reloadRolePermissions()
    if (succeeded.length > 0) {
      notifySuccess(
        `Preset “${preset.presetName}” applied to ${succeeded.length} role(s) in ${mode} mode (+${succeeded.reduce(
          (sum, item) => sum + item.added,
          0
        )} / −${succeeded.reduce((sum, item) => sum + item.removed, 0)} permission grants).`,
        { toast: true }
      )
    }
    if (succeeded.length < results.length) {
      notifyError(`${results.length - succeeded.length} role(s) could not be updated with “${preset.presetName}”.`)
    }
    return results
  }

  /* ---------------------------------------------------------- bulk upload */

  const importConfig = {
    title: 'Bulk upload permission presets',
    description: `Upload an Excel (.xlsx) or CSV file with one row per preset (the layout of the export). Permission Names holds a comma-separated list of permission names. A name that already exists is rejected, and at most ${MAX_PERMISSION_PRESETS} presets can be saved. Imported presets are saved in this browser.`,
    templateFileName: 'permission-preset-upload-template',
    fields: [
      { key: 'presetName', label: 'Preset', required: true, example: 'Terminal Operator', aliases: ['Preset Name', 'Name'] },
      {
        key: 'permissions',
        label: 'Permission Names',
        required: true,
        example: 'View Location, View Tank Operation',
        aliases: ['Permissions', 'Permission Keys'],
        hint: 'Comma-separated permission names from the Permission Master',
      },
      { key: 'description', label: 'Description', example: 'Day-to-day terminal operations' },
      { key: 'status', label: 'Status', options: PRESET_STATUSES, defaultValue: 'Active', example: 'Active' },
    ],
    validateRow: (record) => {
      const name = String(record.presetName ?? '').trim()
      if (name.length < PRESET_NAME_MIN_LENGTH || name.length > PRESET_NAME_MAX_LENGTH) {
        return `Preset name must have ${PRESET_NAME_MIN_LENGTH}–${PRESET_NAME_MAX_LENGTH} characters`
      }
      if (record.status && !PRESET_STATUSES.includes(String(record.status).trim())) return 'Status must be Active or Inactive'
      const names = splitPermissionNames(record.permissions)
      if (names.length === 0) return 'At least one permission is required'
      if (groups.entries.length > 0) {
        const unknown = names.filter((item) => !groups.infoByName.has(nameKey(item)))
        if (unknown.length > 0) {
          return `Unknown permission(s): ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ' …' : ''}`
        }
      }
      return null
    },
    onImportRow: async (record) => {
      if (!canEdit) throw new Error('Saving presets requires Edit Role Permission Assignment.')
      const permissionNames = splitPermissionNames(record.permissions).map(
        (item) => groups.infoByName.get(nameKey(item))?.permissionName || item
      )
      createPreset(
        {
          presetName: record.presetName,
          description: record.description,
          status: String(record.status || 'Active').trim() || 'Active',
          permissionNames,
        },
        actorName
      )
    },
  }

  /* --------------------------------------------------------------- render */

  const applyPreset = applyDialog?.preset || null
  const applyResolution = applyPreset ? resolvePreset(applyPreset, groups, canAssign) : null
  const viewSelection = useMemo(
    () => new Set((viewPreset?.permissionNames || []).map(nameKey)),
    [viewPreset]
  )

  return (
    <div>
      <PageHeader
        title="Permission Presets"
        description="Save a named set of permissions once, then apply it to one role or many – replacing or adding to their permissions – instead of ticking every permission for every role."
        count={`${slots.used} / ${slots.limit} Saved Presets`}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => navigate('/role-permissions')}>
              <Icon name="shieldCheck" size={15} />
              Role Permission Assignment
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-primary"
                onClick={openCreate}
                disabled={limitReached || !catalogReady}
                title={
                  limitReached
                    ? `The preset limit of ${slots.limit} is reached`
                    : !catalogReady
                      ? 'Loading the permission catalog…'
                      : 'Create a permission preset'
                }
              >
                <Icon name="plus" size={15} />
                New Preset
              </button>
            )}
          </>
        }
      />

      {!anyDialogOpen && <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />}
      {!anyDialogOpen && <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />}
      <AlertMessage tone="warning" message={catalogError} onDismiss={() => setCatalogError('')} />
      {limitReached && (
        <AlertMessage
          tone="warning"
          message={`The preset limit is reached: ${slots.used} of ${slots.limit} presets are saved. Delete a preset you no longer need to free a slot.`}
        />
      )}
      {!canEdit && (
        <div className="info-box">
          You have view-only access. Creating, changing and applying presets requires Edit Role Permission Assignment.
        </div>
      )}
      {canEdit && (permissions || []).length === 0 && (
        <AlertMessage
          tone="info"
          message="Only permissions already assigned to a role can be granted. Granting other permissions also requires View Permission."
        />
      )}

      <div className="info-box preset-info">
        Standard presets are built from the permission catalog and are always available. Saved presets are kept in
        this browser – use Export and Bulk Upload to copy them to another computer or administrator. Applying a preset
        updates each role through Role Permission Assignment, so every change is recorded in the audit log.
      </div>

      <DataTableToolbar
        filters={filters}
        columns={COLUMNS}
        exportFileName="permission-presets"
        exportTitle="Permission Presets"
        module={MODULE}
        importConfig={importConfig}
        canImport={canEdit && catalogReady}
        searchPlaceholder="Search presets…"
      />

      <table>
        <thead>
          <tr>
            <th>Preset</th>
            <th>Type</th>
            <th>Permissions</th>
            <th>Applied</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!catalogReady && savedPresets.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-table">
                {catalogError ? 'The permission catalog is not available.' : 'Loading presets…'}
              </td>
            </tr>
          ) : visibleRows.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-table">
                {rows.length === 0 ? 'No presets yet.' : 'No presets match the filters.'}
              </td>
            </tr>
          ) : (
            visibleRows.map((preset) => {
              const standard = isStandardPreset(preset)
              return (
                <tr key={preset.id}>
                  <td>
                    <strong className="cell-strong">{preset.presetName}</strong>
                    <div className="muted-table-text">{preset.description || 'No description'}</div>
                  </td>
                  <td>
                    <span className={`status-badge ${standard ? 'draft' : 'cancelled'}`}>{preset.type}</span>
                  </td>
                  <td>
                    <div>{preset.permissionCount}</div>
                    {preset.modules.length > 0 && (
                      <span className="code-chip-list preset-module-chips">
                        {preset.modules.slice(0, 3).map((module) => (
                          <span key={module} className="code-chip preset-module-chip">
                            {module}
                          </span>
                        ))}
                        {preset.modules.length > 3 && (
                          <span className="code-chip is-more">+{preset.modules.length - 3} more</span>
                        )}
                      </span>
                    )}
                    {preset.unavailableCount > 0 && (
                      <div className="muted-table-text">{preset.unavailableCount} inactive or unknown</div>
                    )}
                  </td>
                  <td>
                    {standard ? (
                      <span className="cell-muted">–</span>
                    ) : (
                      <>
                        <div>{preset.timesApplied}×</div>
                        <div className="muted-table-text">
                          {preset.lastAppliedAt ? formatDateTime(preset.lastAppliedAt) : 'Never applied'}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge ${String(preset.status).toLowerCase()}`}>{preset.status}</span>
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setViewPreset(preset)
                        logUiAction(MODULE, 'View Preset', { preset: preset.presetName })
                      }}
                    >
                      View
                    </button>
                    {canEdit && preset.status === 'Active' && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => openApply(preset)}
                        disabled={!catalogReady || preset.assignableCount === 0}
                        title={preset.assignableCount === 0 ? 'None of its permissions can be granted' : undefined}
                      >
                        Apply
                      </button>
                    )}
                    {canEdit && !standard && (
                      <>
                        <button type="button" onClick={() => openEdit(preset)} disabled={!catalogReady}>
                          Edit
                        </button>
                        <button type="button" onClick={() => handleToggleStatus(preset)}>
                          {preset.status === 'Active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button type="button" className="btn-danger" onClick={() => handleDelete(preset)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      {formDialog && (
        <PresetFormDialog
          key={formDialog.key}
          open
          preset={formDialog.preset}
          groups={groups}
          roleRows={roleRows}
          sources={allPresets}
          canAssign={canAssign}
          error={formError}
          onDismissError={() => setFormError('')}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setFormDialog(null)
            setFormError('')
          }}
        />
      )}

      {applyDialog && applyResolution && (
        <ApplyPresetDialog
          key={applyDialog.key}
          open
          preset={applyPreset}
          resolution={applyResolution}
          moduleCount={presetModules(applyPreset, groups).length}
          roleRows={roleRows}
          rolesAvailable={hasPermission('View Role')}
          onApply={applyToRoles}
          onClose={() => setApplyDialog(null)}
        />
      )}

      <Modal
        open={Boolean(viewPreset)}
        onClose={() => setViewPreset(null)}
        size="xl"
        title={viewPreset ? `Preset – ${viewPreset.presetName}` : ''}
        description={
          viewPreset
            ? `${viewPreset.permissionNames.length} permission(s)${viewPreset.description ? ` · ${viewPreset.description}` : ''}`
            : undefined
        }
        footer={
          <button type="button" className="btn-secondary" onClick={() => setViewPreset(null)}>
            Close
          </button>
        }
      >
        {viewPreset && <PermissionMatrix groups={groups} selected={viewSelection} editable={false} />}
      </Modal>
    </div>
  )
}

export default PermissionPresets
