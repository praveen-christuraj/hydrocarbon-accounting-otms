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
