from app.routers.admin_db_browser import _is_sensitive_column
from app.utils.logging_config import REDACTED, redact


def test_redact_catches_credentials_in_common_log_shapes():
    samples = [
        "INITIAL_ADMIN_PASSWORD=synthetic-secret",
        '"password": "synthetic-secret"',
        "PASSWORD_HISTORY_JSON=synthetic-secret",
        "totp_secret_encrypted=synthetic-secret",
        "token_hash=synthetic-secret",
        "'password' = 'synthetic-secret'",
        "Set-Cookie: hydrocarbon_refresh=synthetic-secret; Path=/; HttpOnly",
        "postgresql://operator:synthetic-secret@db.example/app",
        "Authorization: Bearer eyJabcdefghijk.abcdefghijk.abcdefghijk",
        "JWT_SECRET_KEY=synthetic-secret",
        "SECURITY_KDF_SALT=synthetic-secret",
        "ENCRYPTION_KEY=synthetic-secret",
        "PGPASSWORD=synthetic-secret",
    ]
    for sample in samples:
        result = redact(sample)
        assert "synthetic-secret" not in result
        assert REDACTED in result


def test_database_browser_masks_secrets_without_hiding_safe_metadata():
    for name in (
        "password_hash",
        "password_history_json",
        "totp_secret_encrypted",
        "backup_codes_hash_json",
        "token_hash",
        "session_id",
        "api_token",
    ):
        assert _is_sensitive_column(name)

    for name in (
        "password_changed_at",
        "password_expiry_days",
        "password_never_expires",
        "force_password_change",
        "handler_key",
        "config_key",
        "check_key",
    ):
        assert not _is_sensitive_column(name)

    assert _is_sensitive_column("token_hash", "token_blacklist")
    assert _is_sensitive_column("password_history_json", "users")
    assert _is_sensitive_column("challenge_id", "auth_login_challenges")
