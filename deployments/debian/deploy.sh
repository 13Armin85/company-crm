#!/usr/bin/env bash
set -Eeuo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$project_root"

phase="checking deployment prerequisites"
on_error() {
    status=$?
    printf 'Deployment failed while %s (exit %s). Stop here and resolve the error before continuing.\n' "$phase" "$status" >&2
    exit "$status"
}
trap on_error ERR

if [[ ! -f .env.production ]]; then
    printf 'First run: bash deployments/debian/init-env.sh http://192.168.10.24\n' >&2
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

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    printf 'Docker Engine and Compose are required. On Ubuntu run: bash deployments/ubuntu/setup-server.sh\n' >&2
    exit 1
fi
docker_command=(docker)
if [[ "$EUID" -ne 0 ]] && ! docker info >/dev/null 2>&1; then
    if [[ -n "${DOCKER_HOST:-}" || -n "${DOCKER_CONTEXT:-}" || "$(docker context show)" != default ]]; then
        printf 'The selected Docker connection is unavailable. Resolve it before deploying.\n' >&2
        exit 1
    fi
    docker_command=(sudo docker)
fi
"${docker_command[@]}" info >/dev/null
export COMPOSE_PARALLEL_LIMIT=1

dc() {
    "${docker_command[@]}" compose --env-file .env.production -f docker-compose-production.yml "$@"
}

dc config --quiet
if [[ "${1:-}" != --no-build ]]; then
    phase="checking free space for the Docker build"
    minimum_disk_gb=${PLANE_BUILD_MIN_FREE_GB:-20}
    if [[ ! "$minimum_disk_gb" =~ ^[1-9][0-9]*$ ]]; then
        printf 'PLANE_BUILD_MIN_FREE_GB must be a positive integer.\n' >&2
        exit 1
    fi
    docker_data_root=$("${docker_command[@]}" info --format '{{.DockerRootDir}}')
    if [[ -z "$docker_data_root" || ! -d "$docker_data_root" ]]; then
        printf 'Cannot inspect the local Docker data directory. Verify Docker is running on this server.\n' >&2
        exit 1
    fi
    disk_command=(df)
    if [[ $EUID -ne 0 ]] && command -v sudo >/dev/null 2>&1; then disk_command=(sudo df); fi
    available_kb=$("${disk_command[@]}" -Pk -- "$docker_data_root" | awk 'NR == 2 {print $4}')
    if [[ ! "$available_kb" =~ ^[0-9]+$ ]]; then
        printf 'Cannot determine free space in the Docker data filesystem.\n' >&2
        exit 1
    fi
    if (( available_kb < minimum_disk_gb * 1024 * 1024 )); then
        printf 'Build stopped: Docker has %s GiB free; this deployment requires at least %s GiB free to start a build. Expand its filesystem before retrying.\n' \
            "$((available_kb / 1024 / 1024))" "$minimum_disk_gb" >&2
        exit 1
    fi
    phase="building production images"
    dc build --pull
fi
phase="starting infrastructure"
dc up -d --wait --wait-timeout 600 plane-db plane-redis plane-mq plane-minio
phase="running database migrations"
dc run --rm --no-deps migrator
phase="starting application services"
dc up -d --wait --wait-timeout 900 api worker beat-worker web admin space live proxy
dc ps -a
printf '\nDeployment started. Verify the public URL and /api/instances/ in your browser.\n'
