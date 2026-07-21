# TankStockLedger

## Purpose
View the tank stock ledger — a running record of inventory changes for each tank. The ledger is automatically updated when operations are approved, showing opening stock, receipts, deliveries, adjustments, and closing stock.

## File Locations
- **Frontend:** `frontend/src/pages/TankStockLedger.jsx`
- **API Module:** `frontend/src/api/tankStockLedgerApi.js`
- **Backend Router:** `backend/app/routers/tank_stock_ledger.py` (prefix: `/tank-stock-ledger`)
- **Model:** `TankStockLedger` (`backend/app/models.py` line 753)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/tank-stock-ledger` | Get ledger entries with filters |
| `GET` | `/tank-stock-ledger/summary` | Get summary per tank |
| `GET` | `/tank-stock-ledger/daily-summary` | Get daily summary |

## Key Features
- Filter by tank, date range, location
- Opening balance, receipts, deliveries, adjustments, closing balance
- Automatic posting from approved operation transactions
- Manual adjustment capability
- Daily summary view for reconciliation

## Backend Key Functions
- `create_tank_stock_ledger_from_approved_transaction()` — Auto-creates ledger entries on approval
- Stock movements calculated from OperationTransaction values (JSONB payloads)

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Tank Stock Ledger

---

## Full-Stack Architecture Diagram — TankStockLedger

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                          DATA                                       │
│                                                                                                              │
│ TankStockLedger   tankStockApi     tank_stock_ledger.py           TankStockLedger                           │
│ ────────────────   ─────────────   ───────────────────            ────────────────                           │
│ Props:             getLedger()     GET /tank-stock-ledger         id (PK) | Integer                          │
│  loggedInUser      getSummary()    GET /tank-stock-ledger/        transaction_id (FK→OpTxn)                │
│ ─────────────       getDailySumm()   summary                       operation_number | String                  │
│ Filters: tank,     ─────────────   GET /tank-stock-ledger/        tank_number | String(100)                  │
│ date range,         conv:           daily-summary                  location_code | String(50)                 │
│ location            getLedger↔     ─────────────                  tank_asset_code | String(50)               │
│                     GET /tank-     Perm: ('View Tank Stock         product_name | String                      │
│ Table columns:      stock-ledger    Ledger')                       before_volume | Float                      │
│ Date, Ticket #,     getSummary↔    Audit: module='Tank Stock      after_volume | Float                       │
│ Ticket #, Operation, GET /tank-     Ledger'                        volume_change | Float                     │
│ Location, Tank,      stock-ledger  ─────────────                  before_mass | Float                        │
│ Before Vol, After   /summary                                                                                  │
│ Vol, Change,         getDailySumm↔  ─────────────                 after_mass | Float                         │
| Status, Remarks | GET /tank-      SHARED:                         mass_change | Float                        │
│ ─────────────        stock-ledger  operation_transactions.py:      before_ullage | Float                      │
│ ─────────────        /daily-summary create_tank_stock_ledger_      after_ullage | Float                       │
│                       conv:API       from_approved_transaction()   ullage_change | Float                      │
│  FEATURES:            conv          ─ auto-creates records        before_temperature | Float                 │
│  Opening bal,                        on OpTxn APPROVED,            after_temperature | Float                  │
│  Receipts,                           for templates with:           before_density | Float                     │
│  Deliveries,                         - Stock Movement              after_density | Float                      │
│  Adjustments,                        - Multi-Tank Before/After     opening_balance_bbl | Float               │
│  Closing bal                         - Tank Gauging                closing_balance_bbl | Float                │
│  Daily summary                                                      running_balance_bbl | Float               │
│  Manual adjustment                   REVERSAL:                     operation_date | Date                     │
│                                      correction_requests.py        status (Active/Correction Hold/          │
│                                      sets status='Correction        Reversed)                                │
│                                      Hold' on correction,          created_by | String                       │
│                                      restores to 'Active' on                                              │
│                                      denial, reverses on revoke                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
