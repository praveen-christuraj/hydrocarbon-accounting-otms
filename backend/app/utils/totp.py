import base64
import hashlib
import hmac
import io
import secrets
import time
from datetime import timedelta

import pyotp
import qrcode
from sqlalchemy.orm import Session

from app.config import TOTP_SETUP_TTL_MINUTES
from app.models import AuthLoginChallenge, User
from app.utils.security import decrypt_security_value, verify_password
from app.utils.time import utcnow

BACKUP_CODE_COUNT = 10
BACKUP_CODE_LENGTH = 10  # 5 characters, dash, 5 characters
TOTP_ISSUER = "Hydrocarbon Accounting System"


def _canonical_backup_code(code: str) -> str:
    raw = "".join(ch for ch in str(code or "").strip().upper() if ch.isalnum())
    if len(raw) == BACKUP_CODE_LENGTH:
        return f"{raw[:5]}-{raw[5:]}"
    return raw


def generate_backup_codes(count: int = BACKUP_CODE_COUNT) -> list[str]:
    codes = []
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1 ambiguity
    for _ in range(count):
        raw = "".join(secrets.choice(alphabet) for _ in range(BACKUP_CODE_LENGTH))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def hash_backup_codes(codes: list[str]) -> list[str]:
    """Hash recovery codes with SHA-256.

    Recovery codes are high-entropy (32^10 ≈ 2^50) random values, so a fast
    cryptographic hash is appropriate. The previous implementation ran bcrypt
    for every code, which made enabling 2FA and verifying a backup code take
    several seconds. Legacy bcrypt hashes are still accepted on verification
    so existing enrolments keep working.
    """
    return [
        hashlib.sha256(_canonical_backup_code(code).encode("utf-8")).hexdigest()
        for code in codes
    ]


def _backup_code_matches(entered: str, stored_hash: str) -> bool:
    canonical = _canonical_backup_code(entered)
    if not canonical or not stored_hash:
        return False
    if str(stored_hash).startswith(("$2a$", "$2b$", "$2y$")):
        return verify_password(canonical, stored_hash)
    expected = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return hmac.compare_digest(expected, str(stored_hash))


def count_backup_codes(user: User) -> int:
    return len(list(getattr(user, "backup_codes_hash_json", None) or []))


def verify_backup_code(user: User, code: str) -> bool:
    entered = str(code or "").strip()
    hashes = list(getattr(user, "backup_codes_hash_json", None) or [])
    for idx, code_hash in enumerate(hashes):
        if _backup_code_matches(entered, code_hash):
            hashes.pop(idx)
            user.backup_codes_hash_json = hashes
            return True
    return False


def verify_totp_code(secret: str | None, code: str, user: User | None = None, mark_used: bool = True) -> bool:
    """Verify a 6-digit TOTP code with a ±1 step clock-skew window.

    When ``user`` is supplied the accepted time step is recorded so the same
    code cannot be replayed within its validity window.
    """
    if not secret:
        return False
    normalized = "".join(ch for ch in str(code or "").strip() if ch.isdigit())
    if len(normalized) != 6:
        return False

    totp = pyotp.TOTP(secret)
    current_step = int(time.time() // totp.interval)
    for offset in (0, -1, 1):
        step = current_step + offset
        try:
            candidate = totp.at(step * totp.interval)
        except Exception:
            continue
        if hmac.compare_digest(candidate, normalized):
            if user is not None:
                last_step = getattr(user, "totp_last_used_step", None)
                if last_step is not None and step <= int(last_step):
                    return False
                if mark_used:
                    user.totp_last_used_step = step
            return True
    return False


def seconds_until_next_totp(secret: str | None) -> int | None:
    if not secret:
        return None
    interval = pyotp.TOTP(secret).interval
    return int(interval - (time.time() % interval))


def verify_totp_or_backup_code(user: User, code: str) -> bool:
    secret = decrypt_security_value(getattr(user, "totp_secret_encrypted", None))
    if verify_totp_code(secret, code, user=user):
        return True
    return verify_backup_code(user, code)


def build_totp_qr_data_url(provisioning_uri: str):
    qr = qrcode.QRCode(version=1, box_size=8, border=4)
    qr.add_data(provisioning_uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    stream = io.BytesIO()
    img.save(stream, format="PNG")
    encoded = base64.b64encode(stream.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def build_provisioning_uri(user: User, secret: str) -> str:
    account_name = str(user.username or "").strip() or f"user-{user.id}"
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=TOTP_ISSUER)


def setup_is_expired(user: User) -> bool:
    started_at = getattr(user, "totp_setup_started_at", None)
    if started_at is None:
        return True
    return utcnow() > started_at + timedelta(minutes=TOTP_SETUP_TTL_MINUTES)


def create_login_challenge(db: Session, user: User, ip_address: str | None = None, user_agent: str | None = None):
    # Only one live challenge per user: a new password login supersedes any
    # older pending challenge instead of leaving several valid windows open.
    (
        db.query(AuthLoginChallenge)
        .filter(
            AuthLoginChallenge.user_id == user.id,
            AuthLoginChallenge.status == "Pending",
        )
        .update({"status": "Superseded"}, synchronize_session=False)
    )
    challenge = AuthLoginChallenge(
        challenge_id=secrets.token_urlsafe(32),
        user_id=user.id,
        status="Pending",
        expires_at=utcnow() + timedelta(minutes=5),
        ip_address=ip_address,
        user_agent=str(user_agent or "")[:2000] or None,
        attempt_count=0,
    )
    db.add(challenge)
    db.flush()
    return challenge
