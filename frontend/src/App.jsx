import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
} from 'react-router-dom'

import Home from './pages/Home'
import UserMaster from './pages/UserMaster'
import RoleMaster from './pages/RoleMaster'
import PermissionMaster from './pages/PermissionMaster'
import RolePermissionAssignment from './pages/RolePermissionAssignment'
import PermissionPresets from './pages/PermissionPresets'
import UserRoleAssignment from './pages/UserRoleAssignment'
import UserLocationAssignment from './pages/UserLocationAssignment'
import RoleLocationAssignment from './pages/RoleLocationAssignment'
import AccessSummary from './pages/AccessSummary'
import LocationMaster from './pages/LocationMaster'
import LocationAccountingDaySetting from './pages/LocationAccountingDaySetting'
import AssetTypeMaster from './pages/AssetTypeMaster'
import AssetMaster from './pages/AssetMaster'
import CalibrationTemplateMaster from './pages/CalibrationTemplateMaster'
import AssetCalibrationTable from './pages/AssetCalibrationTable'
import AssetAssignment from './pages/AssetAssignment'
import AssetAssignmentSummary from './pages/AssetAssignmentSummary'
import OperationTypeMaster from './pages/OperationTypeMaster'
import TankOperationMaster from './pages/TankOperationMaster'
import OperationTemplateMaster from './pages/OperationTemplateMaster'
import OperationEntry from './pages/OperationEntry'
import LocationOperationAvailability from './pages/LocationOperationAvailability'
import TrackingModuleConfiguration from './pages/TrackingModuleConfiguration'
import LocationOperationSummary from './pages/LocationOperationSummary'
import OperationTransactionRegister from './pages/OperationTransactionRegister'
import TankOperationSummary from './pages/TankOperationSummary'
import OutTurnSummary from './pages/OutTurnSummary'
import MaterialBalanceReport from './pages/MaterialBalanceReport'
import MaterialBalanceTemplateMaster from './pages/MaterialBalanceTemplateMaster'
import OperationTransactionDetail from './pages/OperationTransactionDetail'
import LoginPage from './pages/LoginPage'
import PermissionGuard from './components/PermissionGuard'
import { PrintProfileProvider } from './components/print/PrintProfileProvider'
import Table11FactorMaster from './pages/Table11FactorMaster'
import CompanyReportProfileMaster from './pages/CompanyReportProfileMaster'
import AuditLog from './pages/AuditLog'
import BargeSealMaster from './pages/BargeSealMaster'
import BargeTracking from './pages/BargeTracking'
import TankerTransactionReport from './pages/TankerTransactionReport'
import PrimeMoverTankerLinkMaster from './pages/PrimeMoverTankerLinkMaster'
import TankerTracking from './pages/TankerTracking'
import ShuttleTracking from './pages/ShuttleTracking'
import FSOTracking from './pages/FSOTracking'
// import Dashboard from './pages/Dashboard'
// import DashboardBuilder from './pages/DashboardBuilder'
import VesselOperationMaster from './pages/VesselOperationMaster'
import MovementMapping from './pages/MovementMapping'
import FlowmeterConfigMaster from './pages/FlowmeterConfigMaster'
import FlowmeterRecordEntry from './pages/FlowmeterRecordEntry'
import OperationWorkflowPolicyMaster from './pages/OperationWorkflowPolicyMaster'
import OperationTaskManager from './pages/OperationTaskManager'
import ProfileSecurity from './pages/ProfileSecurity'
import ForcePasswordChange from './pages/ForcePasswordChange'
import SystemNotificationMaster from './pages/SystemNotificationMaster'
import BackupRecovery from './pages/BackupRecovery'
import DatabaseBrowser from './pages/DatabaseBrowser'
import {
  ExportDashboard,
  ExportTransactions,
  ExportReports,
  ExportPermits,
  ExportLocations,
  ExportEntities,
  ExportBlocks,
  ExportConsignees,
  ExportSettings,
} from './pages/exportOperations'

import { getCurrentUser, logoutUser } from './api/authApi'
import AppShell from './components/layout/AppShell'
import Modal from './components/common/Modal'
import { useToast } from './components/common/Toast'
import { AuthProvider, userHasPermission } from './hooks/usePermissions'
import { logUiAction, setActionLogUser } from './utils/actionLogger'
import { getLocationOperationAvailability } from './api/locationOperationAvailabilityApi'
import { helpContent } from './data/helpContent'
import { getRoles } from './api/roleApi'
import { getAllPermissions } from './api/permissionApi'
import { getAllRolePermissions } from './api/rolePermissionApi'
import { getUsers } from './api/userApi'
import { getUserRoleAssignments } from './api/userRoleApi'
import { getUserLocationAssignments, getUserLocationSummaries } from './api/userLocationApi'
import { getLocations } from './api/locationApi'
import { getAssetTypes } from './api/assetTypeApi'
import { getAssets } from './api/assetApi'
import { getCalibrationTemplates } from './api/calibrationTemplateApi'
import { getAssetCalibrationTables } from './api/assetCalibrationApi'
import { getAssetAssignments } from './api/assetAssignmentApi'
import { getOperationTypes } from './api/operationTypeApi'
import { getOperationTemplates } from './api/operationTemplateApi'
import { getOperationEntries } from './api/operationEntryApi'
import { getOperationTransactions } from './api/operationTransactionApi'

// Export Operations is its own module: one route (and one View permission) per screen.
const EXPORT_OPERATION_ROUTES = [
  { path: '/export-operations', permission: 'View Export Dashboard', label: 'the Export Dashboard', Component: ExportDashboard },
  { path: '/export-operations/transactions', permission: 'View Export Transaction', label: 'Export Transactions', Component: ExportTransactions },
  { path: '/export-operations/reports', permission: 'View Export Report', label: 'Export Reports', Component: ExportReports },
  { path: '/export-operations/permits', permission: 'View Export Permit', label: 'Export Permits', Component: ExportPermits },
  { path: '/export-operations/locations', permission: 'View Export Location', label: 'Export Locations', Component: ExportLocations },
  { path: '/export-operations/entities', permission: 'View Export Entity', label: 'Export Entities', Component: ExportEntities },
  { path: '/export-operations/blocks', permission: 'View Export Block', label: 'Export Blocks', Component: ExportBlocks },
  { path: '/export-operations/consignees', permission: 'View Export Consignee', label: 'Export Consignees', Component: ExportConsignees },
  { path: '/export-operations/settings', permission: 'View Export Settings', label: 'Export Settings', Component: ExportSettings },
]

function PageHelp() {
  const location = useLocation()
  const [showHelp, setShowHelp] = useState(false)

  const currentHelp = helpContent[location.pathname]

  if (!currentHelp) {
    return null
  }

  return (
    <>
      <div className="page-help-bar">
        <button
          type="button"
          className="btn-secondary btn-sm page-help-button"
          onClick={() => {
            setShowHelp(true)
            logUiAction(currentHelp.title, 'Open Help')
          }}
        >
          Help
        </button>
      </div>

      <Modal
        open={showHelp}
        title={currentHelp.title}
        onClose={() => setShowHelp(false)}
        size="md"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setShowHelp(false)}>
            Close
          </button>
        }
      >
        <p>{currentHelp.description}</p>

        <div className="help-section">
          <h4>Important Notes</h4>

          <ul>
            {currentHelp.points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </div>
      </Modal>
    </>
  )
}

function LegacyPageDisabled({ title, description, primaryPath, primaryLabel }) {
  return (
    <div>
      <div className="page-title">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <div className="info-box">
        This legacy page is kept in the codebase, but it is disabled from the
        active frontend workflow.
      </div>

      <div className="info-box">
        Use <Link to={primaryPath}>{primaryLabel}</Link> instead.
      </div>
    </div>
  )
}

function AppContent({
  loggedInUser,
  onLogout,
  refreshLoggedInUser,

  users,
  setUsers,
  reloadUsers,

  roles,
  reloadRoles,

  permissions,
  reloadPermissions,

  locations,
  setLocations,
  reloadLocations,

  assetTypes,
  setAssetTypes,
  reloadAssetTypes,

  assets,
  setAssets,
  reloadAssets,
  assetCalibrationTables,
  
  calibrationTemplates,
  setCalibrationTemplates,
  reloadCalibrationTemplates,

  calibrationTables,
  setCalibrationTables,
  reloadAssetCalibrationTables,

  assetAssignments,
  setAssetAssignments,
  reloadAssetAssignments,

  rolePermissionAssignments,
  reloadRolePermissions,

  userRoleAssignments,
  reloadUserRoleAssignments,

  userLocationAssignments,
  userLocationSummaries,
  reloadUserLocationAssignments,
  reloadUserLocationSummaries,

  operationTypes,
  reloadOperationTypes,

  operationTemplates,
  reloadOperationTemplates,

  operationEntries,
  setOperationEntries,
  reloadOperationEntries,

  operationTransactions,
  setOperationTransactions,
  reloadOperationTransactions,

  locationOperationAvailability,
  setLocationOperationAvailability,
  reloadLocationOperationAvailability,
}) {

  const hasPermission = (permissionName) => userHasPermission(loggedInUser, permissionName)
  return (
    <AppShell loggedInUser={loggedInUser} onLogout={onLogout}>
      <PageHelp />

        <Routes>
          <Route path="/" element={<Home hasPermission={hasPermission} />} />

          <Route
            path="/users"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View User"
                fallbackMessage="You do not have permission to view users."
              >
                <UserMaster
                  users={users}
                  reloadUsers={reloadUsers}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/roles"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Role"
                fallbackMessage="You do not have permission to view roles."
              >
                <RoleMaster
                  roles={roles}
                  reloadRoles={reloadRoles}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/permissions"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Permission"
                fallbackMessage="You do not have permission to view permissions."
              >
                <PermissionMaster
                  permissions={permissions}
                  reloadPermissions={reloadPermissions}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/role-permissions"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Role Permission Assignment"
                fallbackMessage="You do not have permission to view role permission assignments."
              >
                <RolePermissionAssignment
                  roles={roles}
                  permissions={permissions}
                  rolePermissionAssignments={rolePermissionAssignments}
                  reloadRolePermissions={reloadRolePermissions}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/permission-presets"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Role Permission Assignment"
                fallbackMessage="You do not have permission to view permission presets."
              >
                <PermissionPresets
                  roles={roles}
                  permissions={permissions}
                  rolePermissionAssignments={rolePermissionAssignments}
                  reloadRolePermissions={reloadRolePermissions}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/user-roles"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View User Role Assignment"
                fallbackMessage="You do not have permission to view user role assignments."
              >
                <UserRoleAssignment
                  users={users}
                  roles={roles}
                  userRoleAssignments={userRoleAssignments}
                  reloadUserRoleAssignments={reloadUserRoleAssignments}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/user-locations"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View User Location Assignment"
                fallbackMessage="You do not have permission to view user location assignments."
              >
                <UserLocationAssignment
                  users={users}
                  locations={locations}
                  userLocationSummaries={userLocationSummaries}
                  userLocationAssignments={userLocationAssignments}
                  reloadUserLocationSummaries={reloadUserLocationSummaries}
                  reloadUserLocationAssignments={reloadUserLocationAssignments}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/role-locations"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Role Location Assignment"
                fallbackMessage="You do not have permission to view role location assignments."
              >
                <RoleLocationAssignment loggedInUser={loggedInUser} />
              </PermissionGuard>
            }
          />

          <Route
            path="/access-summary"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Access Summary"
                fallbackMessage="You do not have permission to view access summary."
              >
                <AccessSummary
                  users={users}
                  roles={roles}
                  permissions={permissions}
                  userRoleAssignments={userRoleAssignments}
                  rolePermissionAssignments={rolePermissionAssignments}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/profile-security"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Own Security Settings"
                fallbackMessage="You do not have permission to view profile security settings."
              >
                <ProfileSecurity
                  loggedInUser={loggedInUser}
                  onLoggedInUserRefresh={refreshLoggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/locations"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Location"
                fallbackMessage="You do not have permission to view locations."
              >
                <LocationMaster
                  locations={locations}
                  setLocations={setLocations}
                  reloadLocations={reloadLocations}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/location-accounting-day-settings"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Location Accounting Day Setting"
                fallbackMessage="You do not have permission to view Location Accounting Day Settings."
              >
                <LocationAccountingDaySetting
                  locations={locations}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/material-balance-template-master"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Material Balance Template"
                fallbackMessage="You do not have permission to view Material Balance Template Configuration."
              >
                <MaterialBalanceTemplateMaster
                  locations={locations}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/asset-types"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Asset Type"
                fallbackMessage="You do not have permission to view asset types."
              >
                <AssetTypeMaster
                  assetTypes={assetTypes}
                  setAssetTypes={setAssetTypes}
                  reloadAssetTypes={reloadAssetTypes}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/assets"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Asset"
                fallbackMessage="You do not have permission to view assets."
              >
                <AssetMaster
                  assets={assets}
                  setAssets={setAssets}
                  reloadAssets={reloadAssets}
                  assetTypes={assetTypes}
                  locations={locations}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/prime-mover-tanker-links"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Prime Mover Tanker Link"
                fallbackMessage="You do not have permission to view Prime Mover - Tanker links."
              >
                <PrimeMoverTankerLinkMaster
                  assets={assets}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/calibration-templates"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Calibration Template"
                fallbackMessage="You do not have permission to view calibration templates."
              >
                <CalibrationTemplateMaster
                  assetTypes={assetTypes}
                  calibrationTemplates={calibrationTemplates}
                  setCalibrationTemplates={setCalibrationTemplates}
                  reloadCalibrationTemplates={reloadCalibrationTemplates}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/asset-calibrations"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Asset Calibration"
                fallbackMessage="You do not have permission to view asset calibration tables."
              >
                <AssetCalibrationTable
                  assets={assets}
                  calibrationTemplates={calibrationTemplates}
                  calibrationTables={calibrationTables}
                  setCalibrationTables={setCalibrationTables}
                  reloadAssetCalibrationTables={reloadAssetCalibrationTables}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/table11-factors"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Table 11 Factor"
                fallbackMessage="You do not have permission to view Table 11 factors."
              >
                <Table11FactorMaster loggedInUser={loggedInUser} />
              </PermissionGuard>
            }
          />
          
          <Route
            path="/asset-assignments"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Asset Assignment"
                fallbackMessage="You do not have permission to view asset assignments."
              >
                <AssetAssignment
                  assets={assets}
                  locations={locations}
                  users={users}
                  assetAssignments={assetAssignments}
                  setAssetAssignments={setAssetAssignments}
                  reloadAssetAssignments={reloadAssetAssignments}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/asset-assignment-summary"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermissions={[
                  'View Asset',
                  'View Asset Assignment',
                  'View Asset Assignment Summary',
                ]}
                fallbackMessage="You need asset, asset assignment, and summary permissions to view this page correctly."
              >
                <AssetAssignmentSummary
                  assets={assets}
                  assetTypes={assetTypes}
                  locations={locations}
                  users={users}
                  assetAssignments={assetAssignments}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/flowmeter-configs"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Flowmeter Config"
                fallbackMessage="You do not have permission to view Flowmeter Config."
              >
                <FlowmeterConfigMaster
                  locations={locations}
                  assets={assets}
                  assetAssignments={assetAssignments}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/company-report-profiles"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Company Report Profile"
                fallbackMessage="You do not have permission to view company report profiles."
              >
                <CompanyReportProfileMaster loggedInUser={loggedInUser} />
              </PermissionGuard>
            }
          />

          <Route
            path="/database-browser"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Database Browser"
                fallbackMessage="You do not have permission to view the Database Browser."
              >
                <DatabaseBrowser />
              </PermissionGuard>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Audit Log"
                fallbackMessage="You do not have permission to view audit logs."
              >
                <AuditLog />
              </PermissionGuard>
            }
          />

          <Route
            path="/system-notifications"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View System Notification"
                fallbackMessage="You do not have permission to view system notifications."
              >
                <SystemNotificationMaster
                  roles={roles}
                  users={users}
                  locations={locations}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/backup-recovery"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Backup"
                fallbackMessage="You do not have permission to view backup recovery."
              >
                <BackupRecovery loggedInUser={loggedInUser} />
              </PermissionGuard>
            }
          />
          {EXPORT_OPERATION_ROUTES.map(({ path, permission, label, Component }) => (
            <Route
              key={path}
              path={path}
              element={
                <PermissionGuard
                  loggedInUser={loggedInUser}
                  requiredPermission={permission}
                  fallbackMessage={`You do not have permission to view ${label}.`}
                >
                  <Component loggedInUser={loggedInUser} />
                </PermissionGuard>
              }
            />
          ))}

          <Route
            path="/barge-seal-master"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Barge Seal Master"
                fallbackMessage="You do not have permission to view barge seal master."
              >
                <BargeSealMaster
                  assets={assets}
                  assetCalibrationTables={assetCalibrationTables}
                  calibrationTemplates={calibrationTemplates}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/operation-types"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Operation Type"
                fallbackMessage="You do not have permission to view operation types."
              >
                <OperationTypeMaster
                  assetTypes={assetTypes}
                  operationTypes={operationTypes}
                  reloadOperationTypes={reloadOperationTypes}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          
          <Route
            path="/tank-operations"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Tank Operation"
                fallbackMessage="You do not have permission to view tank operations."
              >
                <TankOperationMaster
                  locations={locations}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/vessel-operations"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Vessel Operation"
                fallbackMessage="You do not have permission to view Vessel Operation Master."
              >
                <VesselOperationMaster locations={locations} assetTypes={assetTypes} loggedInUser={loggedInUser} />
              </PermissionGuard>
            }
          />
          <Route
            path="/movement-mappings"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Movement Mapping"
                fallbackMessage="You do not have permission to view Movement Mapping."
              >
                <MovementMapping locations={locations} loggedInUser={loggedInUser} />
              </PermissionGuard>
            }
          />
          <Route
            path="/operation-templates"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Operation Template"
                fallbackMessage="You do not have permission to view operation templates."
              >
                <OperationTemplateMaster
                  operationTypes={operationTypes}
                  operationTemplates={operationTemplates}
                  reloadOperationTemplates={reloadOperationTemplates}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/operation-workflow-policies"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Operation Workflow Policy"
                fallbackMessage="You do not have permission to view Operation Workflow Policies."
              >
                <OperationWorkflowPolicyMaster
                  roles={roles}
                  operationTypes={operationTypes}
                  operationTemplates={operationTemplates}
                  assets={assets}
                  locations={locations}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/operation-entry"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                anyOfPermissions={['Create Operation Entry', 'Create Receiving Ticket']}
                fallbackMessage="You do not have permission to create operation entries."
              >
                <OperationEntry
                  operationTypes={operationTypes}
                  operationTemplates={operationTemplates}
                  locations={locations}
                  assets={assets}
                  operationEntries={operationEntries}
                  setOperationEntries={setOperationEntries}
                  reloadOperationEntries={reloadOperationEntries}
                  reloadOperationTransactions={reloadOperationTransactions}
                  loggedInUser={loggedInUser}
                  assetCalibrationTables={calibrationTables}
                  calibrationTemplates={calibrationTemplates}
                  locationOperationAvailability={locationOperationAvailability}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/operation-tasks"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                anyOfPermissions={[
                  'View My Tasks',
                  'Act On Operation Task',
                  'Supervise Operation Tasks',
                  'Approve Operation Transaction',
                  'Reject Operation Transaction',
                  'Cancel Operation Transaction',
                  'Request Approved Transaction Correction',
                  'Admin Revoke Approved Transaction',
                ]}
                fallbackMessage="You do not have permission to view operation tasks."
              >
                <OperationTaskManager
                  reloadOperationTransactions={reloadOperationTransactions}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/barge-tracking"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Barge Tracking"
                fallbackMessage="You do not have permission to view Barge Tracking."
              >
                <BargeTracking
                  loggedInUser={loggedInUser}
                  assets={assets}
                  locations={locations}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/convoy-tracker"
            element={<Navigate to="/barge-tracking" replace />}
          />
          <Route
            path="/tanker-tracking"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Tanker Tracking"
                fallbackMessage="You do not have permission to view Tanker Tracking."
              >
                <TankerTracking
                  locations={locations}
                  assets={assets}
                  operationTypes={operationTypes}
                  operationTemplates={operationTemplates}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/shuttle-tracking"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Shuttle Tracking"
                fallbackMessage="You do not have permission to view Shuttle Tracking."
              >
                <ShuttleTracking
                  loggedInUser={loggedInUser}
                  locations={locations}
                  assets={assets}
                  operationTemplates={operationTemplates}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/fso-tracking"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View FSO Tracking"
                fallbackMessage="You do not have permission to view FSO Tracking."
              >
                <FSOTracking
                  locations={locations}
                  assets={assets}
                  operationTemplates={operationTemplates}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          {/* <Route
            path="/dashboard"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Dashboard"
                fallbackMessage="You do not have permission to view Dashboard."
              >
                <Dashboard locations={locations} />
              </PermissionGuard>
            }
          />
          <Route
            path="/dashboard-builder"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                anyOfPermissions={['Create Dashboard', 'Edit Dashboard']}
                fallbackMessage="You do not have permission to build dashboards."
              >
                <DashboardBuilder
                  locations={locations}
                  assets={assets}
                  operationTypes={operationTypes}
                  locationOperationAvailability={locationOperationAvailability}
                />
              </PermissionGuard>
            }
          /> */}
          <Route
            path="/tracking-module-configuration"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Tracking Module Configuration"
                fallbackMessage="You do not have permission to view tracking module configuration."
              >
                <TrackingModuleConfiguration loggedInUser={loggedInUser} />
              </PermissionGuard>
            }
          />

          <Route
            path="/location-operation-availability"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Location Operation Availability"
                fallbackMessage="You do not have permission to view location operation availability."
              >
                <LocationOperationAvailability
                  locations={locations}
                  operationTypes={operationTypes}
                  locationOperationAvailability={locationOperationAvailability}
                  reloadLocationOperationAvailability={reloadLocationOperationAvailability}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/location-operation-summary"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Location Operation Availability"
                fallbackMessage="You do not have permission to view location operation summary."
              >
                <LocationOperationSummary
                  locations={locations}
                  assets={assets}
                  assetAssignments={assetAssignments}
                  operationTypes={operationTypes}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/operation-transactions"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Operation Transaction"
                fallbackMessage="You do not have permission to view operation transactions."
              >
                <OperationTransactionRegister
                  operationTypes={operationTypes}
                  locations={locations}
                  assets={assets}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/flowmeter-records"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Flowmeter Record"
                fallbackMessage="You do not have permission to view Flowmeter Records."
              >
                <FlowmeterRecordEntry
                  locations={locations}
                  assets={assets}
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/tank-stock-ledger"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Tank Stock Ledger"
                fallbackMessage="You do not have permission to view Tank Stock Ledger."
              >
                <LegacyPageDisabled
                  title="Tank Stock Ledger"
                  description="This legacy report page has been disabled from the active frontend workflow."
                  primaryPath="/tank-operation-summary"
                  primaryLabel="Tank Operation Summary"
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/tank-operation-summary"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Tank Operation Summary"
                fallbackMessage="You do not have permission to view Tank Operation Summary."
              >
                <TankOperationSummary
                  locations={locations}
                  assets={assets}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/out-turn-summary"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Out-Turn Summary"
                fallbackMessage="You do not have permission to view Out-Turn Summary."
              >
                <OutTurnSummary
                  locations={locations}
                  assets={assets}
                  loggedInUser={loggedInUser}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/out-turn-report"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Out-Turn Report"
                fallbackMessage="You do not have permission to view Out-Turn Report."
              >
                <LegacyPageDisabled
                  title="Out-Turn Report"
                  description="This legacy report page has been disabled from the active frontend workflow."
                  primaryPath="/out-turn-summary"
                  primaryLabel="Out-Turn Summary"
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/material-balance-report"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Material Balance Report"
                fallbackMessage="You do not have permission to view Material Balance Report."
              >
                <MaterialBalanceReport locations={locations} assets={assets} />
              </PermissionGuard>
            }
          />
          <Route
            path="/tanker-transaction-report"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Tanker Transaction Report"
                fallbackMessage="You do not have permission to view the Tanker Transaction Report."
              >
                <TankerTransactionReport
                  locations={locations}
                  assets={assets}
                />
              </PermissionGuard>
            }
          />
          <Route
            path="/operation-transactions/:transactionId"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Operation Transaction"
                fallbackMessage="You do not have permission to view operation transaction details."
              >
                <OperationTransactionDetail loggedInUser={loggedInUser} />
              </PermissionGuard>
            }
          />
        </Routes>
    </AppShell>
  )
}

function App() {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [locations, setLocations] = useState([])
  const [assetTypes, setAssetTypes] = useState([])
  const [assets, setAssets] = useState([])
  const [calibrationTemplates, setCalibrationTemplates] = useState([])
  const [calibrationTables, setCalibrationTables] = useState([])
  const [assetAssignments, setAssetAssignments] = useState([])
  const [rolePermissionAssignments, setRolePermissionAssignments] = useState([])
  const [userRoleAssignments, setUserRoleAssignments] = useState([])
  const [userLocationAssignments, setUserLocationAssignments] = useState([])
  const [userLocationSummaries, setUserLocationSummaries] = useState([])
  const [operationTypes, setOperationTypes] = useState([])
  const [operationTemplates, setOperationTemplates] = useState([])
  const [operationEntries, setOperationEntries] = useState([])
  const [operationTransactions, setOperationTransactions] = useState([])
  const [locationOperationAvailability, setLocationOperationAvailability] = useState([])
  const [currentUsername, setCurrentUsername] = useState('')

  const [loggedInUser, setLoggedInUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    const handleWheel = (event) => {
      const target = event.target
      if (target && target.tagName === 'INPUT' && target.type === 'number') {
        target.blur()
      }
    }
    document.addEventListener('wheel', handleWheel, true)
    return () => document.removeEventListener('wheel', handleWheel, true)
  }, [])

  const hasPermission = (permissionName) => userHasPermission(loggedInUser, permissionName)

  const restoreLoggedInUser = async () => {
    try {
      const currentUser = await getCurrentUser()
      setLoggedInUser(currentUser)
    } catch (error) {
      console.error(error)
      setLoggedInUser(null)
    } finally {
      setAuthLoading(false)
    }
  }

  // Re-pull the logged-in user (fresh security flags after a password change
  // or 2FA enrolment) without logging out.
  const refreshLoggedInUser = async () => {
    try {
      const currentUser = await getCurrentUser()
      if (currentUser) {
        setLoggedInUser(currentUser)
      }
    } catch (error) {
      console.error('refreshLoggedInUser failed:', error)
    }
  }
  const reloadUsers = async () => {
    try {
      const usersFromApi = await getUsers({ limit: 200 })
      setUsers(usersFromApi.items)
    } catch (error) {
      console.error('reloadUsers failed:', error.message)
      toast.error('Unable to load users from the server.', { title: 'Loading failed' })
    }
  }

  const reloadRoles = async () => {
    try {
      const rolesFromApi = await getRoles()
      setRoles(rolesFromApi.items)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load roles from the server.', { title: 'Loading failed' })
    }
  }

  const reloadPermissions = async () => {
    try {
      const permissionsFromApi = await getAllPermissions()
      setPermissions(permissionsFromApi.items)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load permissions from the server.', { title: 'Loading failed' })
    }
  }

  const reloadRolePermissions = async () => {
    try {
      const rolePermissionsFromApi = await getAllRolePermissions()
      setRolePermissionAssignments(rolePermissionsFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load role permissions from the server.', { title: 'Loading failed' })
    }
  }

  const reloadUserRoleAssignments = async () => {
    try {
      const userRoleAssignmentsFromApi = await getUserRoleAssignments()
      setUserRoleAssignments(userRoleAssignmentsFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load user role assignments from the server.', { title: 'Loading failed' })
    }
  }

  const reloadUserLocationAssignments = async () => {
    try {
      const assignmentsFromApi = await getUserLocationAssignments()
      setUserLocationAssignments(assignmentsFromApi)
    } catch (error) {
      console.error('reloadUserLocationAssignments failed:', error.message)
    }
  }

  const reloadUserLocationSummaries = async () => {
    try {
      const summariesFromApi = await getUserLocationSummaries()
      setUserLocationSummaries(summariesFromApi)
    } catch (error) {
      console.error('reloadUserLocationSummaries failed:', error.message)
    }
  }

  const reloadLocations = async () => {
    try {
      const locationsFromApi = await getLocations()
      setLocations(locationsFromApi.items)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load locations from the server.', { title: 'Loading failed' })
    }
  }

  const reloadAssetTypes = async () => {
    try {
      const assetTypesFromApi = await getAssetTypes()
      setAssetTypes(assetTypesFromApi.items)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load asset types from the server.', { title: 'Loading failed' })
    }
  }

  const reloadAssets = async () => {
    try {
      const assetsFromApi = await getAssets()
      setAssets(assetsFromApi.items)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load assets from the server.', { title: 'Loading failed' })
    }
  }

  const reloadAssetAssignments = async () => {
    try {
      const assignmentsFromApi = await getAssetAssignments()
      setAssetAssignments(assignmentsFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load asset assignments from the server.', { title: 'Loading failed' })
    }
  }

  const reloadCalibrationTemplates = async () => {
    try {
      const templatesFromApi = await getCalibrationTemplates()
      setCalibrationTemplates(templatesFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load calibration templates from the server.', { title: 'Loading failed' })
    }
  }

  const reloadAssetCalibrationTables = async () => {
    try {
      const tablesFromApi = await getAssetCalibrationTables()
      setCalibrationTables(tablesFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load asset calibration tables from the server.', { title: 'Loading failed' })
    }
  }

  const reloadOperationTypes = async () => {
    try {
      const operationTypesFromApi = await getOperationTypes()
      setOperationTypes(operationTypesFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load operation types from the server.', { title: 'Loading failed' })
    }
  }

  const reloadLocationOperationAvailability = async () => {
    try {
      const availabilityFromApi = await getLocationOperationAvailability()
      setLocationOperationAvailability(availabilityFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load location operation availability from the server.', { title: 'Loading failed' })
    }
  }

  const reloadOperationTemplates = async () => {
    try {
      const templatesFromApi = await getOperationTemplates()
      setOperationTemplates(templatesFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load operation templates from the server.', { title: 'Loading failed' })
    }
  }

  const reloadOperationEntries = async () => {
    try {
      const entriesFromApi = await getOperationEntries()
      setOperationEntries(entriesFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load operation entries from the server.', { title: 'Loading failed' })
    }
  }

  const reloadOperationTransactions = async () => {
    try {
      // Bounded refresh only (recent tickets). This used to download the
      // entire transaction history on every login -- the main reason pages
      // were slow and "Unable to load operation transactions" appeared.
      // The Transaction Register loads its own server-paged data.
      const transactionsFromApi = await getOperationTransactions({ limit: 200 })
      setOperationTransactions(transactionsFromApi)
    } catch (error) {
      console.error(error)
      toast.error('Unable to load operation transactions from the server.', { title: 'Loading failed' })
    }
  }

  const handleLogout = () => {
    logUiAction('Session', 'Logout', { username: loggedInUser?.username })
    logoutUser()
    setActionLogUser(null)
    setLoggedInUser(null)
    setOperationEntries([])
    setOperationTransactions([])
  }

  useEffect(() => {
    setActionLogUser(loggedInUser)
    if (loggedInUser) {
      logUiAction('Session', 'Login', { username: loggedInUser.username })
    }
  }, [loggedInUser?.id])

useEffect(() => {
  restoreLoggedInUser()
}, [])

useEffect(() => {
  if (!loggedInUser) {
    return
  }

  if (hasPermission('View User')) {
    reloadUsers()
  }

  if (hasPermission('View Role')) {
    reloadRoles()
  }

  if (hasPermission('View Permission')) {
    reloadPermissions()
  }

  if (hasPermission('View Role Permission Assignment')) {
    reloadRolePermissions()
  }

  if (hasPermission('View User Role Assignment')) {
    reloadUserRoleAssignments()
  }

  if (hasPermission('View User Location Assignment')) {
    reloadUserLocationAssignments()
    reloadUserLocationSummaries()
  }

  if (hasPermission('View Location')) {
    reloadLocations()
  }

  if (hasPermission('View Asset Type')) {
    reloadAssetTypes()
  }

  if (hasPermission('View Asset')) {
    reloadAssets()
  }

  if (hasPermission('View Calibration Template')) {
    reloadCalibrationTemplates()
  }

  if (hasPermission('View Asset Calibration')) {
    reloadAssetCalibrationTables()
  }

  if (hasPermission('View Asset Assignment')) {
    reloadAssetAssignments()
  }

  if (hasPermission('View Operation Type')) {
    reloadOperationTypes()
  }

  if (hasPermission('View Location Operation Availability')) {
    reloadLocationOperationAvailability()
  }

  if (hasPermission('View Operation Template')) {
    reloadOperationTemplates()
  }

  if (hasPermission('View Operation Transaction')) {
    reloadOperationEntries()
    // NOTE: operation transactions are deliberately NOT preloaded here.
    // No page consumes the full list -- the Register fetches server-paged
    // rows itself -- and the old eager download of every ticket ever saved
    // blocked first paint and produced "Unable to load operation
    // transactions" toasts whenever it timed out. Pages that mutate
    // transactions still call reloadOperationTransactions() explicitly.
  }
}, [loggedInUser])

  if (authLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>Hydrocarbon Accounting System</h1>
          <p>Checking login session…</p>
        </div>
      </div>
    )
  }

  if (!loggedInUser) {
    return <LoginPage onLogin={setLoggedInUser} />
  }

  // Enterprise policy gate: a flagged or expired password must be replaced
  // before anything else in the application is reachable.
  if (loggedInUser.security?.force_password_change || loggedInUser.security?.password_expired) {
    return (
      <ForcePasswordChange
        loggedInUser={loggedInUser}
        onComplete={refreshLoggedInUser}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <AuthProvider value={{ loggedInUser }}>
      {/* Global print-profile selection: every Print button in every module
          goes through this provider, which prompts for the company report
          profile before the browser print dialog opens. */}
      <PrintProfileProvider>
        <BrowserRouter>
          <AppContent
          loggedInUser={loggedInUser}
          onLogout={handleLogout}
          refreshLoggedInUser={refreshLoggedInUser}

          users={users}
          setUsers={setUsers}
          reloadUsers={reloadUsers}

          roles={roles}
          reloadRoles={reloadRoles}

          permissions={permissions}
          reloadPermissions={reloadPermissions}

          locations={locations}
          setLocations={setLocations}
          reloadLocations={reloadLocations}

          assetTypes={assetTypes}
          setAssetTypes={setAssetTypes}
          reloadAssetTypes={reloadAssetTypes}
          assetCalibrationTables={calibrationTables}
        
          assets={assets}
          setAssets={setAssets}
          reloadAssets={reloadAssets}

          calibrationTemplates={calibrationTemplates}
          setCalibrationTemplates={setCalibrationTemplates}
          reloadCalibrationTemplates={reloadCalibrationTemplates}

          calibrationTables={calibrationTables}
          setCalibrationTables={setCalibrationTables}
          reloadAssetCalibrationTables={reloadAssetCalibrationTables}

          assetAssignments={assetAssignments}
          setAssetAssignments={setAssetAssignments}
          reloadAssetAssignments={reloadAssetAssignments}

          rolePermissionAssignments={rolePermissionAssignments}
          reloadRolePermissions={reloadRolePermissions}

          userRoleAssignments={userRoleAssignments}
          reloadUserRoleAssignments={reloadUserRoleAssignments}

          userLocationAssignments={userLocationAssignments}
          userLocationSummaries={userLocationSummaries}
          reloadUserLocationAssignments={reloadUserLocationAssignments}
          reloadUserLocationSummaries={reloadUserLocationSummaries}

          operationTypes={operationTypes}
          reloadOperationTypes={reloadOperationTypes}

          operationTemplates={operationTemplates}
          reloadOperationTemplates={reloadOperationTemplates}

          operationEntries={operationEntries}
          setOperationEntries={setOperationEntries}
          reloadOperationEntries={reloadOperationEntries}

          operationTransactions={operationTransactions}
          setOperationTransactions={setOperationTransactions}
          reloadOperationTransactions={reloadOperationTransactions}

          locationOperationAvailability={locationOperationAvailability}
          setLocationOperationAvailability={setLocationOperationAvailability}
          reloadLocationOperationAvailability={reloadLocationOperationAvailability}
        />
        </BrowserRouter>
      </PrintProfileProvider>
    </AuthProvider>
  )
}

export default App
