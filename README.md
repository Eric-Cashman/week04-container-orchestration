# week04-container-orchestration

A small TypeScript/Express web app packaged as a hardened, multi-stage Docker image and orchestrated with Docker Compose behind an nginx load balancer. Built for the Week 04 assignment on containerization, image optimization, and orchestration.

## Architecture Overview

```
 browser / curl
       │  :8080
       ▼
 ┌─────────────────────────┐
 │ nginx-unprivileged (LB) │  non-root (uid 101), listens on 8080
 └───────────┬─────────────┘
             │ Docker DNS round-robin (service name "web")
   ┌─────────┼─────────┐
   ▼         ▼         ▼
 web-1     web-2     web-3      node:20.20.2-alpine, non-root (uid 1000)
 (Express, port 3000, /healthz healthcheck, 0.50 CPU / 128 MB limit each)
```

| Piece | Choice |
|---|---|
| App | TypeScript on Node.js (Express): `/` landing page, `/healthz`, `/info` (hostname, pid, uptime) |
| Build | 3-stage Dockerfile: `build` (compile TS) → `deps` (prod-only `npm ci`) → `runtime` (only `dist/` and prod `node_modules`) |
| Base image | `node:20.20.2-alpine` (pinned) |
| Load balancer | `nginxinc/nginx-unprivileged:1.27-alpine` |
| Orchestration | Docker Compose: 2 replicas by default, scaled to 3, `restart: unless-stopped`, healthchecks, CPU/memory limits, `.env` file |
| Hardening | `USER node`, `read_only` root filesystem, `cap_drop: ALL`, `no-new-privileges`, no secrets in the image |

## Prerequisites

- Docker Desktop (with Docker Compose v2)
- Node.js and npm (only needed to generate `package-lock.json` or type-check locally)
- PowerShell or any shell

## Run Guide

```powershell
# 1. Create your env file (gitignored)
Copy-Item .env.example .env        # macOS/Linux: cp .env.example .env

# 2. Build the image
docker compose build

# 3. Start the stack (2 web replicas + nginx)
docker compose up -d
docker compose ps                  # wait for web containers to show (healthy)

# 4. Access the app (use curl.exe in PowerShell)
curl.exe -i http://localhost:8080/
curl.exe -i http://localhost:8080/healthz
curl.exe http://localhost:8080/info

# 5. Scale to 3 replicas
docker compose up -d --scale web=3

# 6. See load balancing across replicas
1..12 | ForEach-Object { (curl.exe -s http://localhost:8080/info | ConvertFrom-Json).hostname }

# 7. Tear down
docker compose down
```

Browser: open http://localhost:8080 and refresh to see the container hostname change.

## AI Disclosure & Prompt Appendix

**AI tool used:** Claude (Anthropic). It generated the application code, Dockerfile, Compose file, nginx config, and run commands. I committed its output unmodified as `888911c` ("AI first draft (unmodified)") and made my fixes in separate commits so the diff shows exactly what I changed.

### Exact prompt submitted

```
Act as a senior DevOps and cloud infrastructure architect. I need to containerize and orchestrate a lightweight web application written in TypeScript on Node.js (Express) using Docker Compose.

The deliverable must include:

1. A production-ready Dockerfile that uses a lightweight base image, implements a multi-stage build to keep the final image minimal, follows security best practices (non-root user, minimal layers, no cached package manager files), and supports a health check on /healthz.
2. A docker-compose.yml with a multi-replica web service, CPU/memory limits, health checks, restart policies, and an environment file (.env).
3. Minimal application code in TypeScript: a landing page, a /healthz endpoint, and an endpoint displaying runtime metadata (hostname/container ID and uptime).

Provide the Dockerfile, compose file, application code, package.json, tsconfig.json, and clear terminal commands to build, run, and scale the system.
```

### What the AI got right

- Multi-stage build with dependency files copied before source (good layer caching), `npm ci`, and `npm ci --omit=dev` with cache cleaned for the runtime stage
- Non-root runtime user (`USER node`) with `--chown` on copied files
- CPU/memory limits and reservations, healthcheck on `/healthz`, restart policy
- No hardcoded secrets (`.env` is gitignored; `.env.example` is committed)
- `.dockerignore` present; graceful SIGTERM handling for PID 1
- Added an nginx load balancer on its own, which the prompt did not ask for (needed so replicas can share one published port)

### Problems I found and patched

**1. nginx ran as root** (commit `654d4c9`)

Evidence before the fix (`docker compose top nginx`): the master process ran as `root`.

```yaml
# Before (AI draft)
nginx:
  image: nginx:1.27-alpine
  ports: ["8080:80"]
  volumes: ["./nginx/nginx.conf:/etc/nginx/nginx.conf:ro"]

# After
nginx:
  image: nginxinc/nginx-unprivileged:1.27-alpine
  ports: ["8080:8080"]
  volumes: ["./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro"]
```

The unprivileged image cannot bind port 80, so nginx now listens on 8080 inside the container and the config became a single `server` block. Evidence after: `docker compose exec nginx id` → `uid=101(nginx) gid=101(nginx)`.

**2. Floating base-image tag** (commit `df1275d`)

```dockerfile
# Before
FROM node:20-alpine AS build

# After (all three stages)
FROM node:20.20.2-alpine AS build
```

`node:20-alpine` moves with every 20.x and Alpine update, so builds are not reproducible. I pinned to the version the running container reported (`v20.20.2`).

**3. Incorrect claim about `docker kill` and the restart policy** (found by testing)

The AI told me `restart: unless-stopped` would restart a container killed with `docker kill`. In my test it did not: after `docker kill`, the container stayed at `Exited (137)` and `docker inspect` showed `unless-stopped exited 137`. It only came back when I ran `docker compose up -d`, which recreates missing replicas. A crash where the process exits on its own is the case the restart policy handles (see QA below). I had to verify this against real behavior rather than trusting the explanation.

**Minor observations, not changed:** the healthcheck is declared in both the Dockerfile and `docker-compose.yml` (redundant but harmless), and the nginx service has no healthcheck of its own.

## QA Checklist Summary

### 1. Container image & build verification
- [x] Image builds cleanly (`docker compose build` finished with no errors or warnings)
- [x] Image is lean and tagged: `week04-web:1.0.0`, **199 MB** disk usage / **49.1 MB** content size (`docker images week04-web`)
- [x] Non-root verified: `docker compose exec web whoami` → `node`; `docker compose top web` shows UID 1000
- [x] nginx non-root verified: `docker compose exec nginx id` → `uid=101(nginx)`

### 2. Functional & endpoint testing
- [x] `curl.exe -i http://localhost:8080/` → `HTTP/1.1 200 OK`
- [x] `/healthz` → `200 OK`, body `{"status":"ok","uptimeSeconds":...}`
- [x] Page and `/info` show the container hostname; repeated requests alternate between replica hostnames (load balancing confirmed with 3 distinct hostnames)

### 3. Orchestration & resilience testing
- [x] **Scaling:** `docker compose up -d --scale web=3` → all three `web` containers `(healthy)`
- [x] **`docker kill` behavior:** killed `web-2` → status `Exited (137)`, not auto-restarted by the policy; `docker compose up -d` recreated it
- [ ] **Crash self-healing:** `docker exec <web-2> sh -c "kill 1"` → `RestartCount` = `TODO`, container returned to `(healthy)` = `TODO`, no manual `compose up` used

### 4. Browser console & health check status
- [ X] DevTools Network tab: 200 responses, headers, and response times (`TODO: add screenshot or note`)
- [ X] DevTools Console free of errors (`TODO`)

## Repository Contents

| Path | Purpose |
|---|---|
| `src/server.ts` | Express app |
| `Dockerfile` | 3-stage build |
| `docker-compose.yml` | web (replicated) + nginx |
| `nginx/nginx.conf` | Load balancer server block |
| `.env.example` | Env template (copy to `.env`) |
| `.dockerignore`, `.gitignore` | Keep context small, keep secrets out |