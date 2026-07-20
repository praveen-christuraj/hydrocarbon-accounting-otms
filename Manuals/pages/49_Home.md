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
