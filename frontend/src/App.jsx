import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useLocation,
} from 'react-router-dom'

import Home from './pages/Home'
import UserMaster from './pages/UserMaster'
import RoleMaster from './pages/RoleMaster'
import PermissionMaster from './pages/PermissionMaster'
import RolePermissionAssignment from './pages/RolePermissionAssignment'
import UserRoleAssignment from './pages/UserRoleAssignment'
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
import LocationOperationSummary from './pages/LocationOperationSummary'
import OperationTransactionRegister from './pages/OperationTransactionRegister'
import TankStockLedger from './pages/TankStockLedger'
import OperationTransactionDetail from './pages/OperationTransactionDetail'
import LoginPage from './pages/LoginPage'
import PermissionGuard from './components/PermissionGuard'
import Table11FactorMaster from './pages/Table11FactorMaster'
import CompanyReportProfileMaster from './pages/CompanyReportProfileMaster'
import AuditLog from './pages/AuditLog'
import BargeSealMaster from './pages/BargeSealMaster'
import ConvoyTracker from './pages/ConvoyTracker'

import { getCurrentUser, logoutUser } from './api/authApi'
import { getLocationOperationAvailability } from './api/locationOperationAvailabilityApi'
import { helpContent } from './data/helpContent'
import { navigationItems } from './data/navigationItems'
import { getRoles } from './api/roleApi'
import { getPermissions } from './api/permissionApi'
import { getAllRolePermissions } from './api/rolePermissionApi'
import { getUsers } from './api/userApi'
import { getUserRoleAssignments } from './api/userRoleApi'
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
import { getUserRoles } from './api/userRoleApi'

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
          className="page-help-button"
          onClick={() => setShowHelp(true)}
        >
          ? Help
        </button>
      </div>

      {showHelp && (
        <div className="help-modal-overlay">
          <div className="help-modal">
            <div className="help-modal-header">
              <h3>{currentHelp.title}</h3>

              <button
                type="button"
                className="help-close-button"
                onClick={() => setShowHelp(false)}
              >
                ×
              </button>
            </div>

            <div className="help-modal-body">
              <p>{currentHelp.description}</p>

              <div className="help-section">
                <h4>Important Notes</h4>

                <ul>
                  {currentHelp.points.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function NavigationBar({ loggedInUser }) {
  const hasPermission = (permissionName) => {
    if (!permissionName) {
      return true
    }

    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return permission.permissionName === permissionName
    })
  }

  const hasRequiredPermissions = (item) => {
    if (item.requiredPermissions && item.requiredPermissions.length > 0) {
      return item.requiredPermissions.every((permissionName) => {
        return hasPermission(permissionName)
      })
    }

    if (item.requiredPermission) {
      return hasPermission(item.requiredPermission)
    }

    if (item.permission) {
      return hasPermission(item.permission)
    }

    return true
  }

  const getVisibleDropdownItems = (items) => {
    return items.filter((item) => {
      return hasRequiredPermissions(item)
    })
  }

  return (
    <nav className="navbar">
      {navigationItems.map((navItem, index) => {
        if (navItem.type === 'link') {
          if (!hasRequiredPermissions(navItem)) {
            return null
          }

          return (
            <Link key={index} to={navItem.path} className="nav-link">
              {navItem.label}
            </Link>
          )
        }

        const visibleItems = getVisibleDropdownItems(navItem.items)
        const hasVisibleItem = visibleItems.length > 0

        if (!hasVisibleItem) {
          return null
        }

        return (
          <div key={index} className="nav-dropdown">
            <button type="button" className="nav-dropdown-button">
              {navItem.label} ▾
            </button>

            <div className="nav-dropdown-menu">
              {visibleItems.map((item, itemIndex) => {
                if (item.disabled) {
                  return (
                    <span key={itemIndex} className="disabled-menu-item">
                      {item.label}
                    </span>
                  )
                }

                return (
                  <Link key={itemIndex} to={item.path}>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

function AppContent({
  loggedInUser,
  onLogout,

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

  const hasPermission = (permissionName) => {
    if (!permissionName) {
      return true
    }

    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return permission.permissionName === permissionName
    })
  }
  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Hydrocarbon Accounting System</h1>
          <p>Centralized user, role, location, asset, and operation management</p>
        </div>

        <div className="logged-in-user-panel">
          <div>
            <strong>{loggedInUser.fullName}</strong>
            <span>
              {loggedInUser.username} | Role:{' '}
              {loggedInUser.role ? loggedInUser.role.roleName : 'No role'}
            </span>
          </div>

          <button type="button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <NavigationBar loggedInUser={loggedInUser} />

      <main className="main-content">
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
            path="/access-summary"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Access Summary"
                fallbackMessage="You do not have permission to view access summary."
              >
                <AccessSummary
                  users={users}
                  userRoleAssignments={userRoleAssignments}
                  rolePermissionAssignments={rolePermissionAssignments}
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
                requiredPermission="View Asset Calibration"
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
            path="/operation-entry"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="Create Operation Entry"
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
                />
              </PermissionGuard>
            }
          />

          <Route
            path="/convoy-tracker"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Operation Transaction"
                fallbackMessage="You do not have permission to view convoy tracker."
              >
                <ConvoyTracker
                  loggedInUser={loggedInUser}
                  assets={assets}
                  locations={locations}
                />
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
            path="/tank-stock-ledger"
            element={
              <PermissionGuard
                loggedInUser={loggedInUser}
                requiredPermission="View Tank Stock Ledger"
                fallbackMessage="You do not have permission to view Tank Stock Ledger."
              >
                <TankStockLedger locations={locations} assets={assets} />
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
      </main>
    </div>
  )
}

function App() {
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
  const [operationTypes, setOperationTypes] = useState([])
  const [operationTemplates, setOperationTemplates] = useState([])
  const [operationEntries, setOperationEntries] = useState([])
  const [operationTransactions, setOperationTransactions] = useState([])
  const [locationOperationAvailability, setLocationOperationAvailability] = useState([])
  const [currentUsername, setCurrentUsername] = useState('')

  const [loggedInUser, setLoggedInUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  const hasPermission = (permissionName) => {
    if (!permissionName) {
      return true
    }

    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return permission.permissionName === permissionName
    })
  }

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
  const reloadUsers = async () => {
    try {
      const usersFromApi = await getUsers()
      setUsers(usersFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load users from backend')
    }
  }

  const reloadRoles = async () => {
    try {
      const rolesFromApi = await getRoles()
      setRoles(rolesFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load roles from backend')
    }
  }

  const reloadPermissions = async () => {
    try {
      const permissionsFromApi = await getPermissions()
      setPermissions(permissionsFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load permissions from backend')
    }
  }

  const reloadRolePermissions = async () => {
    try {
      const rolePermissionsFromApi = await getAllRolePermissions()
      setRolePermissionAssignments(rolePermissionsFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load role permissions from backend')
    }
  }

  const reloadUserRoleAssignments = async () => {
    try {
      const userRoleAssignmentsFromApi = await getUserRoles()
      setUserRoleAssignments(userRoleAssignmentsFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load user role assignments from backend')
    }
  }

  const reloadLocations = async () => {
    try {
      const locationsFromApi = await getLocations()
      setLocations(locationsFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load locations from backend')
    }
  }

  const reloadAssetTypes = async () => {
    try {
      const assetTypesFromApi = await getAssetTypes()
      setAssetTypes(assetTypesFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load asset types from backend')
    }
  }

  const reloadAssets = async () => {
    try {
      const assetsFromApi = await getAssets()
      setAssets(assetsFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load assets from backend')
    }
  }

  const reloadAssetAssignments = async () => {
    try {
      const assignmentsFromApi = await getAssetAssignments()
      setAssetAssignments(assignmentsFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load asset assignments from backend')
    }
  }

  const reloadCalibrationTemplates = async () => {
    try {
      const templatesFromApi = await getCalibrationTemplates()
      setCalibrationTemplates(templatesFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load calibration templates from backend')
    }
  }

  const reloadAssetCalibrationTables = async () => {
    try {
      const tablesFromApi = await getAssetCalibrationTables()
      setCalibrationTables(tablesFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load asset calibration tables from backend')
    }
  }

  const reloadOperationTypes = async () => {
    try {
      const operationTypesFromApi = await getOperationTypes()
      setOperationTypes(operationTypesFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load operation types from backend')
    }
  }

  const reloadLocationOperationAvailability = async () => {
    try {
      const availabilityFromApi = await getLocationOperationAvailability()
      setLocationOperationAvailability(availabilityFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load location operation availability from backend')
    }
  }

  const reloadOperationTemplates = async () => {
    try {
      const templatesFromApi = await getOperationTemplates()
      setOperationTemplates(templatesFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load operation templates from backend')
    }
  }

  const reloadOperationEntries = async () => {
    try {
      const entriesFromApi = await getOperationEntries()
      setOperationEntries(entriesFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load operation entries from backend')
    }
  }

  const reloadOperationTransactions = async () => {
    try {
      const transactionsFromApi = await getOperationTransactions()
      setOperationTransactions(transactionsFromApi)
    } catch (error) {
      console.error(error)
      alert('Unable to load operation transactions from backend')
    }
  }

  const handleLogout = () => {
  logoutUser()
  setLoggedInUser(null)
  setOperationEntries([])
  setOperationTransactions([])
}

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
    reloadOperationTransactions()
  }
}, [loggedInUser])

  if (authLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>Hydrocarbon Accounting System</h1>
          <p>Checking login session...</p>
        </div>
      </div>
    )
  }

  if (!loggedInUser) {
    return <LoginPage onLogin={setLoggedInUser} />
  }

  return (
    <BrowserRouter>
      <AppContent
        loggedInUser={loggedInUser}
        onLogout={handleLogout}

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
  )
}

export default App
