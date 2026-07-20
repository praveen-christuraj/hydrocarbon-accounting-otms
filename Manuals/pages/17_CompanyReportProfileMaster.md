# CompanyReportProfileMaster

## Purpose
Manage company report branding profiles. These profiles define how company information appears on printed/exported reports — company name, logo, footer formulas, and legal disclaimers.

## File Locations
- **Frontend:** `frontend/src/pages/CompanyReportProfileMaster.jsx`
- **API Module:** `frontend/src/api/companyReportProfileApi.js`
- **Backend Router:** `backend/app/routers/company_report_profiles.py` (prefix: `/company-report-profiles`)
- **Model:** `CompanyReportProfile`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/company-report-profiles` | List profiles |
| `POST` | `/company-report-profiles` | Create profile |
| `PUT` | `/company-report-profiles/{id}` | Update profile |
| `DELETE` | `/company-report-profiles/{id}` | Delete profile |

## Key Features
- Profile name, company name, system name
- Report subtitle customization
- Logo URL and text fallback
- Footer formula (e.g., GOV = TOV - Free Water | GSV = GOV × VCF...)
- Footer disclaimer/legal note

## Usage
- Profiles are loaded in OperationTransactionDetail for tank gauging reports
- Selected profile saved to localStorage for persistence across sessions

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Company Report Profile
