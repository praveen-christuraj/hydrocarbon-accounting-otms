import pytest
from fastapi import HTTPException
from app.routers.backup_restore import get_validation_database_url, run_production_restore


def test_validation_rejects_production_database_even_with_different_user(monkeypatch):
    monkeypatch.setenv('DATABASE_URL', 'postgresql://owner:password@db:5432/production')
    monkeypatch.setenv('BACKUP_VALIDATION_DATABASE_URL', 'postgresql://other:password@db/production')
    with pytest.raises(HTTPException) as error:
        get_validation_database_url()
    assert 'production database' in error.value.detail


def test_production_restore_is_transactional(monkeypatch, tmp_path):
    from app.routers import backup_restore
    monkeypatch.setenv('DATABASE_URL', 'postgresql://owner:password@db/production')
    monkeypatch.setattr(backup_restore.shutil, 'which', lambda _: '/usr/bin/pg_restore')
    calls = []
    class Result:
        returncode = 0
    monkeypatch.setattr(backup_restore.subprocess, 'run', lambda command, **kw: calls.append(command) or Result())
    run_production_restore(tmp_path / 'backup.dump', 'R1')
    assert '--single-transaction' in calls[0]
    assert '--exit-on-error' in calls[0]
    backup_restore.restore_maintenance_state.update(active=False, started_at=None, request_number=None, message=None)
