# Table11FactorMaster

## Purpose
Manage Table 11 factors used for converting observed volumes to standard volumes. Table 11 is an ASTM/IP standard table for volume correction based on temperature and density/API gravity.

## File Locations
- **Frontend:** `frontend/src/pages/Table11FactorMaster.jsx`
- **API Module:** `frontend/src/api/table11Api.js`
- **Backend Router:** `backend/app/routers/table11_factors.py` (prefix: `/table11-factors`)
- **Model:** `Table11Factor`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/table11-factors` | List factors |
| `POST` | `/table11-factors` | Create factor |
| `PUT` | `/table11-factors/{id}` | Update factor |
| `DELETE` | `/table11-factors/{id}` | Delete factor |
| `POST` | `/table11-factors/bulk` | Bulk import factors |

## Key Features
- Table 11 factors indexed by temperature and density
- Used in tank gauging calculations for VCF (Volume Correction Factor)
- Bulk import capability for large factor tables
- Critical for converting GOV (Gross Observed Volume) to GSV (Gross Standard Volume)

## Formula Reference
```
GOV = TOV - Free Water
GSV = GOV × VCF (from Table 11)
NSV = GSV - BS&W Volume
LT = NSV × Table 11 LT Factor
MT = LT × 1.01605
```

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Asset Calibration (shared permission)
- **Manage:** Manage Asset Calibration

---

## Full-Stack Architecture Diagram — Table11FactorMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                        DATA                                   │
│                                                                                                          │
│ Table11FactorMaster  table11Api   table11_factors.py            Table11Factor                          │
│ ───────────────────  ──────────   ───────────────────           ──────────────                          │
│ Props: loggedInUser   getFactors() GET /table11-factors         id (PK) | Integer                       │
│                       createFact() POST /table11-factors        temperature | Float    (INDEXED)       │
│ CRUD for factors:     updateFact() PUT /table11-factors/{id}    density | Float        (INDEXED)       │
| temperature, density,  deleteFact() DELETE /table11-factors/{id} api_gravity | Float    (INDEXED)       │
| api_gravity, vcf,     bulkImport() POST /table11-factors/bulk   vcf | Float (Volume Correction Factor) │
| lt_factor                          ─────────────                 lt_factor | Float (Long Ton factor)     │
| (from ASTM Table 11)   conv:       Perm: ('View/Mng Asset       source_reference | String               │
|                         getFactors↔ Cal')                        effective_from | Date                  │
| Bulk import for        GET /factors Audit: module='Table11'      effective_to | Date?                    │
| large factor tables    createFact↔ ─────────────                  status | String(20)                    │
|                         POST /factors ─────────────              ──────────────                          │
|                                                                                                           │
|  USED BY: TankCalculatedSummary (OperationTransactionDetail)                                              │
|            Tank Gauging calculation engine:                                                               │
|            GSV = GOV × VCF (looked up from Table11 by temp + density)                                     │
|            LT = NSV × LT_Factor (from Table 11)                                                          │
|            MT = LT × 1.01605                                                                             │
|                                                                                                           │
|  FORMULA CHAIN:                                                                                          │
|  Dip cm → TOV (Tank Table) → -Free Water → GOV → ×VCF(Table11) → GSV → -BSW → NSV → ×LT(Table11) → LT │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
