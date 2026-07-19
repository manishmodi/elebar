#!/usr/bin/env bash
# Production deploy — pull the built images for a tag, migrate, roll.
# Run on the host from the repo root. Idempotent; safe to re-run.
#
#   IMAGE_TAG=v0.1.0 ./deploy/deploy.sh
#
# Prereqs: docker + compose v2; deploy/.env.prod present (NOT in git); CI has
# already built & pushed ghcr.io/manishmodi/sherpa-{backend,frontend}:$TAG.
set -euo pipefail
cd "$(dirname "$0")/.."

# Images are built only for version tags — always deploy an explicit one.
[ -n "${IMAGE_TAG:-}" ] || { echo "FATAL: set IMAGE_TAG (e.g. IMAGE_TAG=v0.1.0 $0)"; exit 1; }
# --env-file makes deploy/.env.prod feed ${VAR} substitution in the compose
# YAML (POSTGRES_PASSWORD etc.) — env_file: alone only sets container env.
COMPOSE="docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml"
export IMAGE_TAG

echo "==> Deploying tag: $IMAGE_TAG"
[ -f deploy/.env.prod ] || { echo "FATAL: deploy/.env.prod missing"; exit 1; }

echo "==> Pulling images"
$COMPOSE pull api web

echo "==> Bringing up datastores"
$COMPOSE up -d db redis

# Run migrations in a one-off api container BEFORE rolling services.
echo "==> Migrating database"
$COMPOSE run --rm api python manage.py migrate --noinput

echo "==> Rolling API, worker, beat, web"
$COMPOSE up -d --remove-orphans

echo "==> Pruning old images"
docker image prune -f >/dev/null || true

echo "==> Health"
sleep 5
$COMPOSE ps
echo "==> Done. Tail logs: $COMPOSE logs -f api"
