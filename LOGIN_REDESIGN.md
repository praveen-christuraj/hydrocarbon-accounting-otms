# Hydrocarbon Accounting System — Login Page Redesign

## Design Inspiration
Based on [WellCostingPro](https://github.com/praveen-christuraj/WellCostingPro) split-screen login layout:
- **Left**: Dark branded panel with system identity, value headline, key statistics, and benefit cards
- **Right**: Light premium form card with username / password, trust badges, and actions

## What's Changed
- `frontend/src/pages/LoginPage.jsx` — fully rewritten split-screen layout
- `frontend/src/index.css` — added `.login-page-new` layout, left/right panels, cards, animations

## All 9 Benefits Shown on Left Panel
1. **Automated Calculations & Workflows** — accurate traceability
2. **Centralized Data Management** — cross-site platform
3. **45–70% Effort Reduction** — recurring admin work
4. **Month-End Speed** — 1–2 days → 2–3 hours
5. **Time Savings** — ~80–180 man-hours/month
6. **Digital Approval Workflow** — no more email & wait
7. **Real-Time Reporting** — live instead of reconstruction
8. **Accountability** — faster loss/gain investigation
9. **Reduced Key-Person Dependency / Continuity** — leave/transfer continuity

## Stats Strip (prominent)
- 45–70% reduction  |  2–3 hrs month-end  |  80–180 hrs saved/month  |  Real-time reporting

## Preserved Functionality
- Username / password sign-in (`loginUser`)
- 2FA verification flow (`verifyLogin2FA`)
- Password reset request (`requestPasswordReset`)
- Password strength indicator
- Show/hide password toggle
- Unseeded deployment warning (`/api/health` check)
- Responsive (stack on mobile < 860 px)

## Build Status
✓ `npm run build` completed successfully (1.37 s, zero errors)

## Preview
`login-preview.html` in repo root shows the split-screen concept.
