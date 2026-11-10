# Book Data: main fields and sub-fields

## Setup and daily entry

1. Configure the entity and block mapping in Export Operations and configure the Book Stock products.
2. In **Book Data → Book Stock Main Fields**, create the main fields, their products, and at least one active sub-field per main field. Sub-fields inherit the products of their main field. The same sub-field code may be used under different main fields.
3. In **Daily Stock Entry**, choose one date, entity, block and product. Enter opening stock, dispatch and signed adjustment for each main field, and production for each of its sub-fields. The field production and closing stock are calculated on the server; the block row is the sum of the fields. Entity reports roll up the block rows, without combining products.
4. When auto-carry is enabled, a main field's opening comes from its own latest earlier closing for the same entity, block and product. Switch off auto-carry on a field to enter a manual opening. Corrections, backdated inserts and deletions recalculate later auto-carried openings; manually entered openings remain anchors. Negative closing and adjustment settings are enforced per main field, including during roll-forward.

All active main fields producing the selected product must be included in a block sheet, as must their active sub-fields. Deactivated sub-fields already recorded on a sheet are retained when editing it. To prevent a field balance silently disappearing from subsequent block totals, main fields with field-level stock history cannot be deactivated or have a producing product removed. A field with sub-fields or history cannot be moved or recoded. Sub-fields can be deactivated without deleting their production history.

## Upgrade and historical data

The upgrade adds `book_stock_sub_fields`, `book_stock_field_stocks` and `book_stock_sub_field_productions`; the existing tables, identifiers, permissions, report source tables and historical values are not rewritten. Startup creates an inactive reserved `__LEGACY__` sub-field for each identifiable main field with old production, and exposes that production as historical sub-field production on the old entry. The backfill is idempotent. Unmatched historical lines remain visible with a historical source label even if their old field master no longer exists.

Old sheets stored opening, dispatch and adjustment at block level, so those amounts cannot be allocated among main fields without inventing data. Old sheets therefore remain block-level, visible and read-only for editing; they continue to appear in block/entity reports. Deletion still requires the existing Delete permission. New field-level sheets must follow the last historical block-level sheet for the same entity, block and product. Enter an explicit opening for each main field at cutover; the system will not automatically split a historical block balance. As usual, take and verify a database backup before upgrading.

## Bulk upload and reports

The daily-entry bulk template has one row per date/entity/block/product and a **Field Stocks JSON** column. The template example is built from the current configuration. Main-field and sub-field IDs are shown in the Sub-Fields table. Example for a block with two main fields:

```json
[{"field_id":1,"opening_stock":100,"dispatch":20,"adjustment":-5,"sub_field_productions":[{"sub_field_id":10,"production_qty":40},{"sub_field_id":11,"production_qty":10}]},{"field_id":2,"opening_stock":200,"dispatch":30,"adjustment":0,"sub_field_productions":[{"sub_field_id":20,"production_qty":50}]}]
```

Use `null` for an auto-carried opening (except at a historical cutover), or a number for a manual opening. The server validates every field and sub-field and reports each bulk row separately. The previous block-level upload format is rejected rather than silently assigning block balances to fields.

Existing block reports and the `book_stock_daily_entries` and `book_stock_field_productions` report sources remain available. Report Builder also exposes the new field-stock and sub-field-production tables, including dates, product and entity scope. Sub-field management uses the existing Book Stock Field CRUD permissions; no role assignments need to be replaced.
