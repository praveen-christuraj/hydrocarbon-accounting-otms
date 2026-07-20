import io
import base64
import secrets
from datetime import datetime, timedelta, timezone

import pyotp
import qrcode
from sqlalchemy.orm import Session

from app.models import AuthLoginChallenge, User
from app.utils.security import decrypt_security_value, hash_password, verify_password


def generate_backup_codes(count: int = 10):
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def hash_backup_codes(codes: list[str]):
    return [hash_password(code.upper()) for code in codes]


def verify_backup_code(user: User, code: str):
    entered = str(code or "").strip().upper()
    hashes = list(getattr(user, "backup_codes_hash_json", None) or [])
    for idx, code_hash in enumerate(hashes):
        if verify_password(entered, code_hash):
            hashes.pop(idx)
            user.backup_codes_hash_json = hashes
            return True
    return False


def verify_totp_or_backup_code(user: User, code: str):
    secret = decrypt_security_value(getattr(user, "totp_secret_encrypted", None))
    normalized = "".join(ch for ch in str(code or "").strip() if ch.isdigit())
    if secret and len(normalized) == 6:
        totp = pyotp.TOTP(secret)
        if totp.verify(normalized, valid_window=0):
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


def create_login_challenge(db: Session, user: User, ip_address: str | None = None):
    challenge = AuthLoginChallenge(
        challenge_id=secrets.token_urlsafe(32),
        user_id=user.id,
        status="Pending",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        ip_address=ip_address,
    )
    db.add(challenge)
    db.flush()
    return challenge
