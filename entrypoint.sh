#!/bin/sh
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dodo Backend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# docker-compose depends_on: service_healthy already ensures
# Postgres is ready before this script runs — no wait loop needed.

echo "▶ Applying database schema..."
npx prisma db push
echo "✓ Schema up to date"

if [ "${SEED_DB}" = "true" ]; then
  echo "▶ Seeding database..."
  npx tsx prisma/seed.ts
  echo "✓ Seed complete  (demo@dodo.app / password123)"
fi

echo "▶ Starting server on port ${PORT:-3000}..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exec node dist/index.js
