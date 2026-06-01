#!/bin/sh
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dodo Backend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Wait for Postgres to be reachable ────────────────────────────────────────
# depends_on + service_healthy in docker-compose covers this, but belt-and-suspenders
echo "▶ Checking database connection..."
RETRIES=20
until npx prisma db execute --stdin <<< "SELECT 1" > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  echo "  Waiting for database... ($RETRIES retries left)"
  RETRIES=$((RETRIES - 1))
  sleep 2
done

if [ $RETRIES -eq 0 ]; then
  echo "✗ Could not connect to database. Exiting."
  exit 1
fi

echo "✓ Database reachable"

# ── Apply schema ─────────────────────────────────────────────────────────────
echo "▶ Applying database schema..."
npx prisma db push
echo "✓ Schema up to date"

# ── Seed (only when SEED_DB=true) ────────────────────────────────────────────
if [ "${SEED_DB}" = "true" ]; then
  echo "▶ Seeding database..."
  npx tsx prisma/seed.ts
  echo "✓ Seed complete  (demo@dodo.app / password123)"
fi

# ── Start app ────────────────────────────────────────────────────────────────
echo "▶ Starting server on port ${PORT:-3000}..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exec node dist/index.js
