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

---

## Full-Stack Architecture Diagram — CompanyReportProfileMaster

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                        BACKEND                        DATA                    │
│                                                                                        │
│ CompanyReportProfile  companyRP Api    company_report_         CompanyReportProfile    │
│ Master.jsx                           _profiles.py              ─────────────────────    │
│ ────────────────────  ─────────────   ────────────────────     id (PK) │ Integer        │
│ Props: loggedInUser   getProfiles()   GET  /company-report-    profile_name│String(150)  │
│                        createProfile  profiles                 company_name│String(200)  │
│  Form fields:         updateProfile   POST /company-report-    system_name│String(200)   │
│  - Profile name       deleteProfile   profiles                 subtitle│Text?            │
│  - Company name        ─────────────  PUT  /company-report-    logo_url│String(500)?    │
│  - System name         conv:          profiles/{id}            logo_text│String(200)?    │
│  - Subtitle            profileName↔   DELETE /company-report-   footer_formula│Text?     │
│  - Logo URL            profile_name   profiles/{id}             footer_disclaimer│Text?    │
│  - Logo text           companyName↔   ─────────────             status │ String(20)      │
│  - Footer formula      company_name   Perm: ('View/Manage       is_default│String(10)   │
│  - Footer disclaimer   logoUrl↔        Company Report           created_at/updated_at    │
│                         logo_url       Profile')                ─────────────────────    │
│                         footer↔       Audit: module='CRP'                               │
│                         footer_formula                        Used by: Operation        │
│                                                                Transaction Detail for     │
│                                                                tank gauging report PDF   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
