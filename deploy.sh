#!/usr/bin/env bash
# =============================================================================
#  Dodo Backend — Single-Machine Deployment Script
#  Deploys PostgreSQL (Docker, 6 GB dedicated filesystem) + Node.js backend
#
#  Supported OS : Ubuntu 20.04/22.04/24.04 · Debian 11/12
#                 CentOS/RHEL 8/9 · Amazon Linux 2023
#  Run as       : sudo bash deploy.sh          (fresh install)
#                 sudo bash deploy.sh --update  (update app code only)
# =============================================================================
set -euo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
hr()      { echo -e "${BOLD}────────────────────────────────────────────────────${RESET}"; }

# ── Constants ──────────────────────────────────────────────────────────────────
APP_NAME="dodo"
APP_DIR="/opt/dodo/backend"
DB_DIR="/var/dodo"
DB_IMG="${DB_DIR}/pgdata.img"
DB_MOUNT="${DB_DIR}/pgdata"
DB_IMG_SIZE="6G"
NODE_VERSION="20"
BACKEND_PORT="3000"
LOG_DIR="/var/log/dodo"
UPDATE_ONLY=false

[[ "${1:-}" == "--update" ]] && UPDATE_ONLY=true

# ── Root check ─────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run this script as root: sudo bash deploy.sh"

# ── OS detection ───────────────────────────────────────────────────────────────
if   [[ -f /etc/os-release ]]; then source /etc/os-release; OS_ID="${ID}"; OS_VER="${VERSION_ID:-}";
else die "Cannot detect OS. /etc/os-release not found."; fi

case "${OS_ID}" in
  ubuntu|debian)          PKG="apt-get"; PKG_INSTALL="${PKG} install -y"; PKG_UPDATE="${PKG} update -qq" ;;
  centos|rhel|amzn|rocky|almalinux) PKG="yum";     PKG_INSTALL="${PKG} install -y"; PKG_UPDATE="${PKG} update -y" ;;
  *) warn "Untested OS: ${OS_ID}. Proceeding anyway…" ; PKG="apt-get"; PKG_INSTALL="${PKG} install -y"; PKG_UPDATE="${PKG} update -qq" ;;
esac

hr
echo -e "${BOLD}  Dodo Backend Deployment${RESET}"
echo    "  OS      : ${OS_ID} ${OS_VER}"
echo    "  App dir : ${APP_DIR}"
echo    "  DB size : ${DB_IMG_SIZE} (dedicated loop filesystem)"
echo    "  Port    : ${BACKEND_PORT}"
hr

# ══════════════════════════════════════════════════════════════════════════════
#  1. SYSTEM PACKAGES
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$UPDATE_ONLY" == false ]]; then
  info "Updating package index…"
  $PKG_UPDATE >/dev/null 2>&1

  info "Installing system utilities (curl, git, util-linux, e2fsprogs)…"
  if [[ "$PKG" == "apt-get" ]]; then
    $PKG_INSTALL curl git util-linux e2fsprogs ca-certificates gnupg lsb-release >/dev/null 2>&1
  else
    $PKG_INSTALL curl git util-linux e2fsprogs ca-certificates >/dev/null 2>&1
  fi
  success "System packages ready"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  2. DOCKER
# ══════════════════════════════════════════════════════════════════════════════
if ! command -v docker &>/dev/null; then
  info "Installing Docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
  systemctl enable docker >/dev/null 2>&1
  systemctl start  docker >/dev/null 2>&1
  success "Docker installed: $(docker --version)"
else
  success "Docker already installed: $(docker --version)"
fi

# Docker Compose v2 (plugin)
if ! docker compose version &>/dev/null; then
  info "Installing Docker Compose plugin…"
  if [[ "$PKG" == "apt-get" ]]; then
    $PKG_INSTALL docker-compose-plugin >/dev/null 2>&1
  else
    COMPOSE_VER=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
    curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-$(uname -s)-$(uname -m)" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
  success "Docker Compose ready: $(docker compose version)"
else
  success "Docker Compose already installed: $(docker compose version)"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  3. NODE.JS + PM2
# ══════════════════════════════════════════════════════════════════════════════
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt "$NODE_VERSION" ]]; then
  info "Installing Node.js ${NODE_VERSION} LTS via NodeSource…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null 2>&1 || \
  curl -fsSL "https://rpm.nodesource.com/setup_${NODE_VERSION}.x"  | bash - >/dev/null 2>&1
  $PKG_INSTALL nodejs >/dev/null 2>&1
  success "Node.js installed: $(node -v)"
else
  success "Node.js already installed: $(node -v)"
fi

if ! command -v pm2 &>/dev/null; then
  info "Installing PM2 globally…"
  npm install -g pm2 --silent
  success "PM2 installed: $(pm2 -v)"
else
  success "PM2 already installed: $(pm2 -v)"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  4. DIRECTORIES & 6 GB DATABASE FILESYSTEM
# ══════════════════════════════════════════════════════════════════════════════
mkdir -p "${APP_DIR}" "${DB_DIR}" "${LOG_DIR}"

if [[ "$UPDATE_ONLY" == false ]]; then
  if [[ ! -f "${DB_IMG}" ]]; then
    info "Creating ${DB_IMG_SIZE} dedicated filesystem for PostgreSQL at ${DB_IMG}…"
    info "This may take ~30 seconds…"
    fallocate -l "${DB_IMG_SIZE}" "${DB_IMG}" 2>/dev/null || \
      dd if=/dev/zero of="${DB_IMG}" bs=1M count=6144 status=progress
    mkfs.ext4 -F -L dodo-pgdata "${DB_IMG}" >/dev/null 2>&1
    success "6 GB filesystem image created"
  else
    success "Database filesystem image already exists ($(du -sh ${DB_IMG} | cut -f1))"
  fi

  # Mount the filesystem
  mkdir -p "${DB_MOUNT}"
  if ! mountpoint -q "${DB_MOUNT}"; then
    mount -o loop "${DB_IMG}" "${DB_MOUNT}"
    success "Mounted ${DB_IMG} → ${DB_MOUNT}"
  else
    success "Database filesystem already mounted at ${DB_MOUNT}"
  fi

  # Persist mount across reboots
  FSTAB_ENTRY="${DB_IMG} ${DB_MOUNT} ext4 loop,defaults,nofail 0 0"
  if ! grep -qF "${DB_IMG}" /etc/fstab; then
    echo "${FSTAB_ENTRY}" >> /etc/fstab
    success "Added /etc/fstab entry for persistent mount"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
#  5. ENVIRONMENT FILE
# ══════════════════════════════════════════════════════════════════════════════
ENV_FILE="${APP_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  info "Generating .env with secure random secrets…"

  # Generate random secrets
  DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 32)
  JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 64)
  SERVER_IP=$(hostname -I | awk '{print $1}')

  cat > "${ENV_FILE}" <<EOF
# ── Dodo Backend — Production Environment ────────────────────────────────────
# Generated by deploy.sh on $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# Edit GMAIL_USER and GMAIL_APP_PASSWORD before starting the backend.

# Database (PostgreSQL running in Docker on this machine)
DATABASE_URL="postgresql://dodo:${DB_PASSWORD}@127.0.0.1:5432/dodo"
DB_NAME=dodo
DB_USER=dodo
DB_PASSWORD=${DB_PASSWORD}

# Server
PORT=${BACKEND_PORT}
NODE_ENV=production

# Frontend origin for CORS  — update to your actual domain / IP
FRONTEND_URL=http://${SERVER_IP}:5173

# App URL used in email links — update to your actual domain
APP_URL=http://${SERVER_IP}:${BACKEND_PORT}

# Auth
JWT_SECRET=${JWT_SECRET}

# ── Gmail SMTP (fill in before starting) ─────────────────────────────────────
# Google Account → Security → 2-Step Verification → App passwords
GMAIL_USER=your-gmail@gmail.com
GMAIL_APP_PASSWORD=your-16-char-app-password
EOF

  chmod 600 "${ENV_FILE}"
  success ".env created at ${ENV_FILE}"
  warn  "ACTION REQUIRED: Edit ${ENV_FILE} and set GMAIL_USER + GMAIL_APP_PASSWORD"
  warn  "Also update FRONTEND_URL and APP_URL to your actual domain."
else
  success ".env already exists — keeping existing secrets"
  # Re-export DB credentials for later use
  set -a; source "${ENV_FILE}"; set +a
fi

# Export DB credentials for docker-compose
set -a; source "${ENV_FILE}"; set +a

# ══════════════════════════════════════════════════════════════════════════════
#  6. COPY APPLICATION CODE
# ══════════════════════════════════════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info "Copying backend source to ${APP_DIR}…"
rsync -a --delete \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.env \
  --exclude='*.log' \
  "${SCRIPT_DIR}/" "${APP_DIR}/"

# Copy the production compose file
cp "${SCRIPT_DIR}/docker-compose.prod.yml" "${APP_DIR}/docker-compose.prod.yml"

success "Source files synced to ${APP_DIR}"

# ══════════════════════════════════════════════════════════════════════════════
#  7. START POSTGRESQL CONTAINER
# ══════════════════════════════════════════════════════════════════════════════
info "Starting PostgreSQL container (dodo-postgres)…"
cd "${APP_DIR}"

docker compose -f docker-compose.prod.yml up -d postgres

# Wait for healthy status (up to 60 s)
info "Waiting for PostgreSQL to be healthy…"
ATTEMPTS=0
until docker inspect --format='{{.State.Health.Status}}' dodo-postgres 2>/dev/null | grep -q "healthy"; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [[ $ATTEMPTS -ge 30 ]] && die "PostgreSQL did not become healthy after 60s. Check: docker logs dodo-postgres"
  sleep 2
done
success "PostgreSQL is healthy"

# ══════════════════════════════════════════════════════════════════════════════
#  8. BUILD THE BACKEND
# ══════════════════════════════════════════════════════════════════════════════
info "Installing Node.js dependencies…"
cd "${APP_DIR}"
npm ci --omit=dev --silent 2>&1 | tail -3
# tsx is needed for db operations — install in devDeps temporarily
npm install --silent tsx >/dev/null 2>&1

info "Building TypeScript…"
npm run build 2>&1

info "Generating Prisma client…"
npx prisma generate 2>&1 | tail -3

success "Build complete"

# ══════════════════════════════════════════════════════════════════════════════
#  9. DATABASE MIGRATION
# ══════════════════════════════════════════════════════════════════════════════
info "Running database migrations (prisma db push)…"
npx prisma db push --accept-data-loss 2>&1 | tail -5
success "Database schema is up-to-date"

# ══════════════════════════════════════════════════════════════════════════════
#  10. START BACKEND WITH PM2
# ══════════════════════════════════════════════════════════════════════════════
info "Starting backend with PM2…"

# Stop old instance if running
pm2 stop  "${APP_NAME}" 2>/dev/null || true
pm2 delete "${APP_NAME}" 2>/dev/null || true

pm2 start dist/index.js \
  --name "${APP_NAME}" \
  --log "${LOG_DIR}/app.log" \
  --error "${LOG_DIR}/error.log" \
  --time \
  --max-memory-restart 512M \
  --restart-delay 3000 \
  --env production

pm2 save
success "Backend started via PM2"

# ── PM2 startup (survive reboots) ─────────────────────────────────────────────
if [[ "$UPDATE_ONLY" == false ]]; then
  info "Configuring PM2 to start on system boot…"
  PM2_STARTUP=$(pm2 startup systemd -u root --hp /root 2>&1 | grep "sudo env")
  if [[ -n "${PM2_STARTUP}" ]]; then
    eval "${PM2_STARTUP}" >/dev/null 2>&1 || true
  fi
  pm2 save >/dev/null 2>&1
  success "PM2 startup service configured"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  11. HEALTH CHECK
# ══════════════════════════════════════════════════════════════════════════════
info "Waiting for backend to accept connections…"
sleep 3
HEALTH_ATTEMPTS=0
until curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; do
  HEALTH_ATTEMPTS=$((HEALTH_ATTEMPTS + 1))
  [[ $HEALTH_ATTEMPTS -ge 15 ]] && {
    warn "Backend health check failed. Showing PM2 logs:"
    pm2 logs "${APP_NAME}" --lines 20 --nostream
    die "Backend did not start. Check logs: ${LOG_DIR}/error.log"
  }
  sleep 2
done

HEALTH_JSON=$(curl -sf "http://127.0.0.1:${BACKEND_PORT}/health")
success "Health check passed: ${HEALTH_JSON}"

# ══════════════════════════════════════════════════════════════════════════════
#  12. SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
SERVER_IP=$(hostname -I | awk '{print $1}')
hr
echo -e "${GREEN}${BOLD}  Deployment complete!${RESET}"
hr
echo -e "  ${BOLD}Backend API${RESET}   http://${SERVER_IP}:${BACKEND_PORT}"
echo -e "  ${BOLD}Health check${RESET}  http://${SERVER_IP}:${BACKEND_PORT}/health"
echo -e "  ${BOLD}App dir${RESET}       ${APP_DIR}"
echo -e "  ${BOLD}Logs${RESET}          ${LOG_DIR}/"
echo -e "  ${BOLD}DB storage${RESET}    ${DB_IMG}  (6 GB ext4 loop device)"
echo -e "  ${BOLD}DB mount${RESET}      ${DB_MOUNT}"
echo
echo -e "  ${BOLD}Useful commands:${RESET}"
echo    "    pm2 status               — process status"
echo    "    pm2 logs dodo            — live app logs"
echo    "    pm2 restart dodo         — restart backend"
echo    "    docker logs dodo-postgres — DB container logs"
echo    "    df -h ${DB_MOUNT}         — DB disk usage"
echo
if grep -q "your-gmail@gmail.com" "${ENV_FILE}"; then
  echo -e "  ${YELLOW}${BOLD}PENDING:${RESET} Set GMAIL_USER + GMAIL_APP_PASSWORD in ${ENV_FILE}"
  echo    "  then run:  pm2 restart dodo"
fi
hr
