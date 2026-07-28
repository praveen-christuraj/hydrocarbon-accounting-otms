import os
import sys
from datetime import date

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.routers.export_operations import (
    build_permit_quarter_code,
    parse_permit_quarter_code,
    expand_export_transaction_payloads,
)


def test_build_permit_quarter_code_combines_quarter_and_year():
    assert build_permit_quarter_code('Q2', 2025) == 'Q2_2025'
    assert build_permit_quarter_code('q3', '2024') == 'Q3_2024'


def test_parse_permit_quarter_code_splits_existing_code():
    assert parse_permit_quarter_code('Q4_2027') == ('Q4', 2027)
    assert parse_permit_quarter_code('Q1') == ('Q1', None)


def test_expand_export_transaction_payloads_creates_one_entry_per_block():
    payload = {
        'bl_date': date(2024, 2, 10),
        'location_code': 'LOC1',
        'entity_code': 'ENT1',
        'consignee': 'Buyer',
        'destination': 'Port',
        'country': 'USA',
        'permit_number': 'PERMIT-1',
        'block_entries': [
            {'block_code': 'B1', 'volume': 100},
            {'block_code': 'B2', 'volume': 0},
        ],
    }

    entries = expand_export_transaction_payloads(payload)

    assert len(entries) == 2
    assert entries[0]['block_code'] == 'B1'
    assert entries[0]['volume'] == 100
    assert entries[1]['block_code'] == 'B2'
    assert entries[1]['volume'] == 0
    assert entries[0]['quarter'] == 'Q1_2024'
