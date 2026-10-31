import base64
import io
import secrets
import time
from datetime import datetime, timedelta, timezone

import pyotp
import qrcode
from sqlalchemy.orm import Session

from app.config import TWO_FA_CHALLENGE_MINUTES
from app.models import AuthLoginChallenge, User
from app.utils.security import decrypt_security_value, hash_password, verify_password

TOTP_STEP_SECONDS = 30
TOTP_VALID_WINDOW = 1


def generate_backup_codes(count: int = 10):
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def hash_backup_codes(codes: list[str]):
    return [hash_password(code.upper()) for code in codes]


def verify_backup_code(user: User, code: str):
    entered = str(code or "").strip().upper().replace(" ", "")
    hashes = list(getattr(user, "backup_codes_hash_json", None) or [])
    for idx, code_hash in enumerate(hashes):
        if verify_password(entered, code_hash):
            hashes.pop(idx)
            user.backup_codes_hash_json = hashes
            return True
    return False


def verify_totp(user: User, normalized_code: str, *, enforce_replay: bool) -> bool:
    secret = decrypt_security_value(getattr(user, "totp_secret_encrypted", None))
    if not secret or len(normalized_code) != 6:
        return False

    totp = pyotp.TOTP(secret)
    current_step = int(time.time()) // TOTP_STEP_SECONDS
    matched_step = None
    # Valid window is +/- one 30-second step for clock drift.
    for step in (current_step, current_step - 1, current_step + 1):
        if secrets.compare_digest(totp.at(step * TOTP_STEP_SECONDS), normalized_code):
            matched_step = step
            break

    if matched_step is None:
        return False

    if enforce_replay:
        last_step = getattr(user, "totp_last_used_step", None)
        if isinstance(last_step, int) and matched_step <= last_step:
            # A one-time code was already accepted; treat as a failed attempt.
            return False
        user.totp_last_used_step = matched_step
    return True


def verify_totp_or_backup_code(user: User, code: str, *, enforce_replay: bool = True):
    normalized = "".join(ch for ch in str(code or "").strip() if ch.isdigit())
    if verify_totp(user, normalized, enforce_replay=enforce_replay):
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


def create_login_challenge(
    db: Session,
    user: User,
    ip_address: str | None = None,
    user_agent: str | None = None,
):
    # Stored naive in UTC to match the TIMESTAMP (without time zone) column, so
    # expiry comparisons never mix naive and aware datetimes.
    # Only one live challenge per account: a new password verification
    # supersedes any challenge that is still pending.
    db.query(AuthLoginChallenge).filter(
        AuthLoginChallenge.user_id == user.id,
        AuthLoginChallenge.status == "Pending",
    ).update({"status": "Superseded"}, synchronize_session=False)

    expires_at = (
        datetime.now(timezone.utc) + timedelta(minutes=TWO_FA_CHALLENGE_MINUTES)
    ).replace(tzinfo=None)
    challenge = AuthLoginChallenge(
        challenge_id=secrets.token_urlsafe(32),
        user_id=user.id,
        status="Pending",
        attempt_count=0,
        expires_at=expires_at,
        ip_address=ip_address,
        user_agent=(str(user_agent or "")[:400] or None),
    )
    db.add(challenge)
    db.flush()
    return challenge
