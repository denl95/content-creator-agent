#!/usr/bin/env bash
set -euo pipefail

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
