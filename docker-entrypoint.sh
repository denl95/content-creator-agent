#!/usr/bin/env bash
set -euo pipefail

# Migrations must land before either process serves traffic. set -e turns a
# failure here into a non-zero exit, which is what we want: the platform
# restarts rather than serving against a stale schema.
bunx prisma migrate deploy

# Every run names a brand, and POST /runs rejects one that does not exist — so a
# freshly migrated volume with no brand makes the app unusable. Seeding is
# idempotent (it exits early once a default brand exists), so this is safe on
# every restart and removes a manual post-deploy step that would be forgotten.
bun run scripts/seed-brand.ts

# Hono API (internal only)
bun run src/server.ts &
API_PID=$!

# Next.js standalone server (public)
PORT="${NEXT_PORT}" HOSTNAME=0.0.0.0 node web/server.js &
WEB_PID=$!

# If either process dies the container must exit, so the platform restarts it —
# a half-dead container that still answers HTTP is worse than a crashed one.
trap 'kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true' TERM INT
wait -n "$API_PID" "$WEB_PID"
EXIT_CODE=$?
kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
exit "$EXIT_CODE"
