#!/bin/sh
set -e

echo "[entrypoint] running prisma db push..."
npx --no-install prisma db push --skip-generate --accept-data-loss=false

echo "[entrypoint] ensuring storage dirs..."
mkdir -p "${PHOTO_STORAGE_DIR:-/data/photos}/originals" "${PHOTO_STORAGE_DIR:-/data/photos}/thumbs"

echo "[entrypoint] starting app: $*"
exec "$@"
