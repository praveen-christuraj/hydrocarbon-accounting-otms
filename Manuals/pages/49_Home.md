# Home

## Purpose
The landing page shown after login. Provides a dashboard-like view with navigation shortcuts to various system modules based on user permissions.

## File Locations
- **Frontend:** `frontend/src/pages/Home.jsx`

## Key Features
- Welcome message with logged-in user name
- Quick-access navigation cards/links
- Conditional display based on user permissions
- Module summary tiles

## Props
| Prop | Source |
|------|--------|
| `hasPermission` | App.jsx (function to check user permissions) |

## Permissions
- No specific permission required (landing page)
- Individual module links respect user permissions via `hasPermission`

---

## Full-Stack Architecture Diagram — Home

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                      BACKEND                    DATA                                │
│                                                                                                      │
│ Home (landing page)                   (No backend API calls)    (No models — purely a             │
│ ───────────────────                                               frontend component)                │
│ Props: hasPermission (from App.jsx)                                                                    │
│ ────────────────                                                                                      │
│ Displays after login:                                                                                │
│                                                                                                      │
│  ┌─ Page Header ──────────────────────┐                                                              │
│  │ Hydrocarbon Accounting System      │                                                              │
│  │ Welcome, {user.fullName}           │                                                              │
│  └────────────────────────────────────┘                                                              │
│                                                                                                      │
│  ┌─ Quick-Access Module Grid ─────────┐                                                              │
│  │ Each card rendered if               │                                                              │
│  │ hasPermission('View <Module>')     │                                                              │
│  │                                     │                                                              │
│  │ ┌──────────┐ ┌──────────┐         │                                                              │
│  │ │ Master   │ │ Tracking │         │                                                              │
│  │ │ Data     │ │ Ops      │         │              ROUTER LINKS (React Router):                    │
│  │ └──────────┘ └──────────┘         │              /users → UserMaster                             │
│  │ ┌──────────┐ ┌──────────┐         │              /roles → RoleMaster                             │
│  │ │ Reports  │ │ Admin    │         │              /operations → OperationEntry                     │
│  │ │ & Analytics│ System   │         │              /dashboard → Dashboard                           │
│  │ └──────────┘ └──────────┘         │              ... (40+ routes)                                │
│  └────────────────────────────────────┘                                                              │
│                                                                                                      │
│  DATA SOURCE:                                                                                        │
│  loggedInUser object from App.jsx (populated on login, stored in state)                             │
│  → hasPermission() checks loggedInUser.permissions array                                            │
│  → Renders modules the user has access to                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
