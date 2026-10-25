# Print → Company Report Profile Selection

**Product-owner rule (2026-10-25):** every Print button in every module must
prompt the user to choose a **Company Report Profile** before the report is
printed. Reports must not silently all take the same single/default profile.

The profile list is the **global Company Report Profile Master**
(`/company-report-profiles` → `Company Report Profile Master`). A profile saved
once there is available to **every user**, in every module.

---

## 1. How it works

```
Print button
   │  usePrintDialog().requestPrint({ module, reportName, onBeforePrint })
   ▼
Global dialog  ──►  lists EVERY profile from the master (dropdown + preview)
   │  user picks a profile and clicks "Print Report"
   ▼
Provider sets the profile as active branding  ──►  report header/footer render it
   │  awaits React paint (2 × requestAnimationFrame + 60 ms)
   ▼
window.print()
```

* The browser print dialog **never** opens before the profile is confirmed.
* Cancel closes the dialog and prints nothing.
* The last used profile is remembered in `localStorage`
  (`hca.printProfileId`) and preselected next time — the user still has to
  confirm the print.
* Profiles that are Inactive/Blocked are still listed (they exist in the
  master) but are clearly marked; Active profiles are listed first.
* With no profiles at all the dialog explains that a profile must be created in
  the master and the Print button stays disabled.

## 2. Files

| File | Responsibility |
|------|----------------|
| `frontend/src/components/print/PrintProfileProvider.jsx` | Mounted once in `App`, renders the one global profile dialog and performs the print sequence. |
| `frontend/src/components/print/printProfileContext.js` | `PrintProfileContext` + `usePrintDialog()` (safe fallback outside the app shell). |
| `frontend/src/hooks/useCompanyPrintProfile.js` | Returns the **selected** profile; every print-only header/footer uses it. |
| `frontend/src/api/companyReportProfileApi.js` | `getCompanyReportProfilePrintOptions()` → `GET /company-report-profiles/print-options`. |
| `backend/app/routers/company_report_profiles.py` | New read-only `GET /print-options` endpoint (login required, no master View permission). |
| `frontend/src/index.css` | `.print-profile-*` dialog styles; `.app-modal-backdrop` excluded from print. |
| `backend/tests/test_company_report_profile_print_options.py` | Proves any signed-in user can list profiles, Active first, and the master listing stays permission-protected. |

## 3. Adding a Print button to a new page

Never call `window.print()` directly.

```jsx
import { usePrintDialog } from '../components/print/printProfileContext'

const { requestPrint } = usePrintDialog()

const handlePrint = () => {
  if (!rows.length) {
    notifyError('Nothing to print')
    return
  }

  requestPrint({
    module: 'My Report',                  // UI activity log module
    reportName: `My Report - ${filterLabel}`,
    onBeforePrint: () => {                // optional, may be async
      logUiAction('My Report', 'Print Report', filters)
      setPrintOpen(true)                  // render the printable section
    },
    onAfterPrint: () => {                 // optional
      setPrintOpen(false)
    },
  })
}
```

The printable markup must use one of the existing print families
(`.printable-report`, `.print-only .mtr-page`, or the page container with a
`.print-report-header`) and include
`<CompanyPrintHeader profile={useCompanyPrintProfile()} … />` and
`<CompanyPrintFooter profile={profile} />` (or the equivalent
`.print-report-header`/`.print-footnote` markup) so the chosen profile reaches
the paper.

## 4. Backend permission note

Section 0 of `CLAUDE.md` freezes the backend/database unless the owner asks.
The owner explicitly requested this global print behaviour, so this change adds
**one read-only endpoint** and nothing else:

```http
GET /company-report-profiles/print-options   (Authorization: Bearer …)
→ [ { id, profile_name, company_name, system_name, report_subtitle,
      logo_data_url, logo_text, footer_formula, footer_note, status,
      created_at, updated_at }, … ]            Active first, then name
```

Why: the existing `GET /company-report-profiles` requires the
`View Company Report Profile` permission, which is an administrative permission.
Operators who print the daily reports do not hold it, so they would have no
profiles in the dialog (and previously printed with **no** company header).
No models, migrations, schemas, seed data or existing endpoints were changed.

## 5. Verification

```bash
cd backend && pytest tests/test_company_report_profile_print_options.py
cd frontend && npm run check:print-css
cd frontend && npm run check:print-actions
cd frontend && npm run smoke -- /tanker-tracking
cd frontend && npm run smoke -- /fso-tracking
cd frontend && npm run test:gauging-reports
```

The `/tanker-tracking` smoke flow clicks **Print Convoy Comparison**, asserts the
profile dialog appears, asserts the dropdown lists every profile, confirms that
**no print call happens before confirmation**, selects the second profile and
asserts the printed report header shows that company (not the default).

The `/fso-tracking` flow covers the same rule on a second page: it asserts the
Summary tab has no Print button, switches to the OTR report tab, opens the
profile dialog, confirms nothing prints early, selects the second profile and
asserts the printed MTR header uses it.
