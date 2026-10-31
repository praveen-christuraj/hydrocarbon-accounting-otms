# Secure Deployment Runbook

This runbook deploys the hardened backend + SPA behind a single TLS origin. It
is written for the IT/infrastructure team; every step is verifiable.

Related documents: [`SECURITY_REMEDIATION.md`](SECURITY_REMEDIATION.md) (finding
register), [`SECURITY_AUDIT_REPORT.md`](SECURITY_AUDIT_REPORT.md) (audit report),
[`SECURITY_MODULE.md`](SECURITY_MODULE.md) (password/session/2FA behaviour).

## 1. Prerequisites

- Docker Engine 24+ with Compose v2, or an equivalent runtime for the two images.
- A TLS certificate for the public hostname (nginx, an upstream load balancer,
  or an appliance). The application must be reachable only over HTTPS.
- A PostgreSQL 16 server (the compose file provisions one; a managed instance
  is fine — set `DATABASE_URL` accordingly).
- An approved backup directory on persistent storage.

## 2. Configure secrets

```bash
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # repeat per secret
```

Fill `.env`:

| Variable | Required | Notes |
|---|---|---|
| `ENVIRONMENT` | yes | `production` enables HSTS, Secure cookies, docs gating and HTTPS assertions |
| `CORS_ORIGINS` | yes | Exact public origin(s), comma separated. `*` is rejected at startup |
| `JWT_SECRET_KEY` | yes | 48+ random bytes; rotating it signs everyone out |
| `ENCRYPTION_KEY` | yes | Encrypts TOTP secrets; keep stable, back it up |
| `SECURITY_KDF_SALT` | yes | ≥16 bytes, persistent; rotating it makes existing v2 ciphertext unreadable |
| `INITIAL_ADMIN_PASSWORD` | first boot | Policy-compliant; the admin must change it at first sign-in |
| `POSTGRES_PASSWORD` | yes | Strong, unique |
| `TRUSTED_HOSTS` | recommended | Public hostname(s); enables Host-header allowlisting |
| `TRUST_PROXY_HEADERS` / `TRUSTED_PROXY_IPS` | behind a proxy | `true` / `*` only when the API port is unpublished |
| `ENFORCE_HTTPS` | recommended | Redirects plain HTTP when nginx terminates TLS |

`.env` must be readable only by the deployment account (`chmod 600 .env`) and
never committed to Git.

## 3. Build and start

```bash
docker compose -f docker-compose.prod.yaml up -d --build
docker compose -f docker-compose.prod.yaml ps
```

What the stack does:

- `postgres` — no published port; internal network only.
- `backend` — API on the internal network, `--proxy-headers`, no server banner,
  `WEB_CONCURRENCY` workers. **Do not publish port 8000.**
- `frontend` — multi-stage build of the Vite bundle served by nginx on
  `PUBLIC_PORT` (default 8080): SPA fallback, `/api/` reverse proxy, security
  headers, 25 MB body ceiling.

If TLS terminates upstream, forward `X-Forwarded-Proto: https` and
`X-Forwarded-For: <client ip>` (overwrite, do not append) and keep
`TRUST_PROXY_HEADERS=true`.

## 4. Database migration

Startup runs idempotent migrations, including the Pass-2 columns
`users.session_epoch` (new) and the existing `session_revoked_at`,
`password_history_json`, `totp_last_used_step`, `totp_confirmed_at`.
Verify after the first boot:

```bash
docker compose -f docker-compose.prod.yaml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\d users' | grep -E 'session_epoch|session_revoked_at|password_history'
```

The migration backfills `password_changed_at` for legacy accounts and caps
administrator expiry, so nobody is locked out by the upgrade.

## 5. Post-deployment verification

Run from a machine that can reach the public hostname.

```bash
BASE=https://hydrocarbon.example.com

# 1. Liveness and security headers
curl -sS -D- "$BASE/api/health" -o /dev/null | grep -Ei 'x-request-id|cache-control|content-security-policy|x-frame-options|strict-transport'

# 2. Request-id echo
curl -sS -D- -H 'X-Request-ID: it-verify-0001' "$BASE/api/health" -o /dev/null | grep -i x-request-id
# expect: x-request-id: it-verify-0001

# 3. API docs must be gone in production
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/docs"          # expect 404
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/openapi.json"  # expect 404

# 4. Cookie flags on sign-in (replace with a real account)
curl -sS -D- -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<password>"}' -o /dev/null | grep -i set-cookie
# expect: HttpOnly; Secure; SameSite=Strict

# 5. Oversized body refused before parsing
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' --data-binary @<(head -c 30000000 /dev/zero)   # expect 413

# 6. Password change is enforced for a freshly reset account
#    (sign in as that account; any business endpoint should return 403
#     {"code":"PASSWORD_CHANGE_REQUIRED"} until the password is changed)

# 7. Sign out everywhere invalidates the current token
#    POST /api/auth/logout-all with the bearer token, then GET /api/auth/me → 401
```

Also confirm the nginx layer:

```bash
curl -sS -D- "$BASE/" -o /dev/null | grep -Ei 'content-security-policy|cache-control'
```

## 6. Operational tasks

| Task | Cadence | Command |
|---|---|---|
| Purge expired token blacklist rows | Nightly | `POST /api/auth/cleanup-blacklist` as an admin, or call the underlying cleanup task |
| Verify backup integrity | After each backup | Admin UI → Backup → Verify checksum (uses constant-time comparison) |
| Review security audit rows | Weekly | Audit Logs → filter module `User Security`, `Authentication`, `System Settings` |
| Review locked/lapsed accounts | Weekly | Profile & Security → Security Overview (locked, expired, pending reset) |
| Rotate `JWT_SECRET_KEY` | On suspicion of compromise | Rotating invalidates all sessions; users sign in again |
| Rotate `ENCRYPTION_KEY` | Rarely | Requires re-encrypting TOTP secrets; coordinate with the DBA |
| Review admin accounts | Quarterly | Ensure each Admin-role user is still required and has 2FA |

## 7. Upgrade procedure

1. Back up the database (`pg_dump`) and `backup_data` volume.
2. Pull the new images and run `docker compose -f docker-compose.prod.yaml up -d --build`.
3. Watch the backend log for migration errors on first boot.
4. Re-run section 5 checks; sign in and confirm the security console loads.
5. Confirm the audit log records the deployment day's sign-ins.

Rollback: redeploy the previous image tag and restore the database snapshot if a
migration must be undone. The Pass-2 migrations are additive (new columns,
nullable), so the previous release can run against the upgraded schema.

## 8. Hardening checklist (copy into the change ticket)

- [ ] `ENVIRONMENT=production`, `CORS_ORIGINS` restricted to the real origin
- [ ] `JWT_SECRET_KEY`, `ENCRYPTION_KEY`, `SECURITY_KDF_SALT` generated and stored in the secret manager
- [ ] `TRUSTED_HOSTS` set to the public hostname
- [ ] Backend port not published; only nginx is exposed
- [ ] TLS certificate valid; HTTP redirects to HTTPS
- [ ] Cookie flags verified (`HttpOnly`, `Secure`, `SameSite=Strict`)
- [ ] `/api/docs`, `/api/redoc`, `/api/openapi.json` return 404
- [ ] Body ceiling returns 413
- [ ] `X-Request-ID` echoed and present on error responses
- [ ] `POSTGRES_PASSWORD` unique and rotated from any default
- [ ] `INITIAL_ADMIN_PASSWORD` unset after the first successful bootstrap
- [ ] Nightly blacklist purge scheduled
- [ ] Backup directory on encrypted, access-controlled storage
- [ ] Audit log review assigned to a named owner
- [ ] Security tests executed on the release commit and attached to the ticket
