# MaterialBalanceReport

## Purpose
Generate material balance reports for regulatory compliance and operational reconciliation. This report provides a comprehensive view of hydrocarbon movements across locations over a period.

## File Locations
- **Frontend:** `frontend/src/pages/MaterialBalanceReport.jsx`
- **API Module:** `frontend/src/api/materialBalanceReportApi.js`
- **Backend Router:** `backend/app/routers/reports.py` (prefix: `/reports`)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/reports/material-balance-report` | Get material balance report data |

## Key Features
- Opening inventory
- Receipts (transfers in, production)
- Deliveries (transfers out, sales)
- Adjustments
- Closing inventory
- Loss/gain analysis
- Reconciliation against expected balances

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Reports

---

## Full-Stack Architecture Diagram — MaterialBalanceReport

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                           BACKEND (reports.py)                    DATA                             │
│                                                                                                            │
│ MaterialBalanceReport  matBalApi    reports.py                            TankStockLedger                  │
│ ─────────────────────  ──────────   ─────────                              ────────────────                 │
│ Props: loggedInUser    getReport() GET /reports/material-balance-report    tank_number, location_code       │
│ ─────────────────     ──────────   ?date_from=&date_to=&location_code=     opening/closing_balance          │
│ Filters: date range,   conv:        &template_id=                          volume_change, mass_change       │
│ location, template     getReport↔ ─────────────                             running_balance                  │
│                        GET /reports Perm: ('View Reports')                ────────────────                   │
│ Shows:                 /material-  Audit: module='Reports'                                                    │
│ Opening inventory,     balance-   ─────────────                              MaterialBalanceTemplate          │
│ Receipts, production,  report                                                                               │
│ Deliveries, sales,     conv:API   BUSINESS LOGIC:                            ────────────────────            │
│ Adjustments,           conv        Uses material_balance_helpers.py:        id, template_name, location      │
│ Closing inventory                 - normalize_unit()                       MaterialBalanceTemplateColumn      │
│ Loss/gain %                      - get_snapshot_value_for_unit()            ────────────────────            │
│                                   - calculate_book_closing()                id, template_id                  │
│ OpenPeriod/ClosePeriod           - get_global_internal_transfer_codes()     column_name, data_source         │
│ (accounting day                 ─────────────                              aggregation_type, sort_order       │
│  boundary logic)                 ─────────────                              ────────────────────             │
│                                   ─────────────                                                                  │
│                                   ─────────────                             MovementMapping                  │
│                                                                             (source→target reconciliation     │
│                                  TEMPLATE-DRIVEN REPORT:                     for out-turn validation)         │
│                                  User configures MaterialBalanceTemplate                                        │
│                                  specifying columns and data sources,                                         │
│                                  then runs report against template                                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
