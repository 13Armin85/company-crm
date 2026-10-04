#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$project_root"

if [[ ! -f .env.production ]]; then
    printf 'First run: bash deployments/debian/init-env.sh http://192.168.10.20\n' >&2
    exit 1
fi
if grep -q '^\([A-Z_]*\)=CHANGE_ME_' .env.production; then
    printf 'Replace every CHANGE_ME_ value in .env.production before deploying.\n' >&2
    exit 1
fi
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --no-build ) ]]; then
    printf 'Usage: bash deployments/debian/deploy.sh [--no-build]\n' >&2
    exit 1
fi

docker_command=(docker)
if [[ "$EUID" -ne 0 ]] && ! docker info >/dev/null 2>&1; then
    docker_command=(sudo docker)
fi
"${docker_command[@]}" info >/dev/null
export COMPOSE_PARALLEL_LIMIT=1

dc() {
    "${docker_command[@]}" compose --env-file .env.production -f docker-compose-production.yml "$@"
}

dc config --quiet
if [[ "${1:-}" != --no-build ]]; then
    dc build --pull
fi
dc up -d --wait --wait-timeout 600 plane-db plane-redis plane-mq plane-minio
dc run --rm --no-deps migrator
dc up -d --wait --wait-timeout 900 api worker beat-worker web admin space live proxy
dc ps -a
printf '\nDeployment started. Verify the public URL and /api/instances/ in your browser.\n'
