# Hydrocarbon Accounting System — Deployment Guide

This guide walks you through deploying the Hydrocarbon Accounting system locally using Docker Compose.

---

## Prerequisites

Install the following on your machine:

| Tool | Version | Download |
|------|---------|----------|
| **Docker Desktop** | 4.x+ | https://docs.docker.com/get-docker/ |
| **Docker Compose** | 2.x+ | Bundled with Docker Desktop |
| **Git** | 2.x+ | https://git-scm.com/downloads |

Verify installation:

```bash
docker --version
docker compose version
git --version
```

---

## 1. Clone the Repository

```bash
git clone <repository-url>
cd hydrocarbon-accounting
```

---

## 2. Create the Root `.env` File

Create a `.env` file in the project root (`hydrocarbon-accounting/.env`):

```bash
# Required — generate your own secrets
POSTGRES_USER=hydrocarbon
POSTGRES_PASSWORD=hydrocarbon123
POSTGRES_DB=hydrocarbon_db

JWT_SECRET_KEY=<generate-with: python -c "import secrets; print(secrets.token_urlsafe(64))">
ENCRYPTION_KEY=<generate-with: python -c "import secrets; print(secrets.token_urlsafe(64))">

ENVIRONMENT=development
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Generate secrets quickly (run these in a terminal):

```bash
# Windows PowerShell
python -c "import secrets; print('JWT_SECRET_KEY=' + secrets.token_urlsafe(64))"
python -c "import secrets; print('ENCRYPTION_KEY=' + secrets.token_urlsafe(64))"

# macOS / Linux
echo "JWT_SECRET_KEY=$(openssl rand -base64 48)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 48)"
```

Copy each generated value into your `.env` file.

---

## 3. Build and Start All Services

From the project root:

```bash
docker compose up --build -d
```

This builds three containers:

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| **postgres** | hydrocarbon-postgres | 5432 | PostgreSQL 16 database |
| **backend** | hydrocarbon-backend | 8000 | FastAPI REST API |
| **frontend** | hydrocarbon-frontend | 5173 | React + Vite dev server |

Check that all containers are running:

```bash
docker compose ps
```

Expected output:

```
NAME                    STATUS          PORTS
hydrocarbon-postgres    running (healthy)  127.0.0.1:5432->5432/tcp
hydrocarbon-backend     running            0.0.0.0:8000->8000/tcp
hydrocarbon-frontend    running            0.0.0.0:5173->5173/tcp
```

---

## 4. Seed the Admin User

Wait for the backend to fully start (about 10-15 seconds), then run the seed script:

```bash
docker compose exec backend python seed_admin.py
```

Expected output:

```
Connecting to database...
Database connected.
[CREATE] Role 'Admin' created (id=1)
[PERMISSIONS] Created 129, skipped 0
[ROLE_PERMISSIONS] Assigned 129, skipped 0
[CREATE] User 'admin' created (id=1)

=== SEED COMPLETE ===
Username: admin
Password: <random-password>
Login at: http://localhost:5173
```

**Save the generated password** — you will need it to log in.

---

## 5. Access the Application

| URL | Purpose |
|-----|---------|
| http://localhost:5173 | Frontend UI |
| http://localhost:8000/docs | Swagger API docs |
| http://localhost:8000/redoc | ReDoc API docs |

Open http://localhost:5173 in your browser and log in with:

- **Username:** `admin`
- **Password:** `<the one shown during seed>`

---

## 6. Verify the Backend API

Run a quick health check:

```bash
curl http://localhost:8000/docs -o /dev/null -w "%{http_code}"
```

Expected: `200`

Test login via API:

```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "<your-seed-password>"}'
```

Expected: JSON with `access_token`.

---

## 7. View Logs

```bash
# All services
docker compose logs -f

# Backend only
docker compose logs -f backend

# Database only
docker compose logs -f postgres

# Frontend only
docker compose logs -f frontend
```

---

## 8. Stop the System

```bash
# Stop containers (data is preserved in volumes)
docker compose down

# Stop and delete all data (including database)
docker compose down -v
```

---

## 9. Rebuild After Code Changes

```bash
# Rebuild and restart
docker compose up --build -d

# Or rebuild only one service
docker compose up --build -d backend
```

---

## 10. Common Issues

### Port already in use

```
Error: Bind for 0.0.0.0:5432 failed: port is already allocated
```

**Fix:** Stop the conflicting service or change the port mapping in `docker-compose.yaml`.

### Backend fails to start

```
hydrocarbon-backend  | ValueError: JWT_SECRET_KEY must be set in production
```

**Fix:** Ensure `ENVIRONMENT=development` in your root `.env` file, or set proper secrets.

### Database connection refused

```
sqlalchemy.exc.OperationalError: could not connect to server
```

**Fix:** Wait for PostgreSQL to be healthy. Check with:

```bash
docker compose ps postgres
```

If unhealthy, restart:

```bash
docker compose restart postgres
```

### Frontend cannot reach backend API

- Ensure `CORS_ORIGINS` in `.env` includes `http://localhost:5173`
- Check backend is running: `docker compose ps backend`
- Check backend logs: `docker compose logs backend`

### Seed script fails with import error

```
ModuleNotFoundError: No module named 'passlib'
```

**Fix:** Rebuild the backend image:

```bash
docker compose up --build -d backend
```

---

## 11. Development Workflow

### Hot Reload

Both frontend and backend support hot reload in development:

- **Frontend:** Vite dev server auto-reloads on file changes
- **Backend:** Install `uvicorn[standard]` and run with `--reload` for auto-reload

To enable backend auto-reload, modify the `CMD` in `backend/Dockerfile`:

```dockerfile
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

### Running Tests

```bash
# Install test dependencies
docker compose exec backend pip install pytest httpx

# Run all tests
docker compose exec backend pytest tests/ -v

# Run specific test file
docker compose exec backend pytest tests/test_auth.py -v
```

### Database Access

Connect directly to PostgreSQL:

```bash
# Using psql inside container
docker compose exec postgres psql -U hydrocarbon -d hydrocarbon_db

# Using external client (e.g., pgAdmin, DBeaver)
Host: 127.0.0.1
Port: 5432
Database: hydrocarbon_db
User: hydrocarbon
Password: hydrocarbon123
```

---

## 12. Production Deployment Checklist

Before deploying to production:

- [ ] Set `ENVIRONMENT=production` in `.env`
- [ ] Generate strong secrets for `JWT_SECRET_KEY` and `ENCRYPTION_KEY`
- [ ] Use a strong `POSTGRES_PASSWORD` (not `hydrocarbon123`)
- [ ] Change `POSTGRES_USER` from default
- [ ] Update `CORS_ORIGINS` to your production domain
- [ ] Remove `--reload` from backend Dockerfile CMD
- [ ] Set up SSL/TLS termination (nginx, Traefik, or cloud load balancer)
- [ ] Configure backup strategy for PostgreSQL volume
- [ ] Set up monitoring and alerting

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│  PostgreSQL  │
│  React/Vite │     │   FastAPI   │     │     16       │
│  Port 5173  │     │  Port 8000  │     │  Port 5432   │
└─────────────┘     └─────────────┘     └─────────────┘
                         │
                    ┌────┴────┐
                    │  Redis  │ (future)
                    └─────────┘
```

**Data flow:**
1. User interacts with the React frontend at `localhost:5173`
2. Frontend sends API requests to the FastAPI backend at `localhost:8000`
3. Backend validates JWT tokens and checks RBAC permissions
4. Backend queries/modifies data in PostgreSQL
5. Response flows back to the frontend

---

## Quick Start (TL;DR)

```bash
git clone <repo-url>
cd hydrocarbon-accounting

# Create .env with secrets (see Section 2)
cat > .env << 'EOF'
POSTGRES_USER=hydrocarbon
POSTGRES_PASSWORD=hydrocarbon123
POSTGRES_DB=hydrocarbon_db
JWT_SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(64))")
ENCRYPTION_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(64))")
ENVIRONMENT=development
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
EOF

# Build and start
docker compose up --build -d

# Seed admin (wait 15s first)
sleep 15
docker compose exec backend python seed_admin.py

# Open http://localhost:5173 and login
```
