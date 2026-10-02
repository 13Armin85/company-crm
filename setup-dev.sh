#!/usr/bin/env bash
# Start the complete local Docker environment on Linux or macOS.
set -euo pipefail

watch=false
build=false
for argument in "$@"; do
    case "$argument" in
        --watch) watch=true ;;
        --build) build=true ;;
        --help|-h)
            printf 'Usage: bash setup-dev.sh [--build] [--watch]\n'
            printf 'Starts all services in the background. --watch keeps source sync running.\n'
            exit 0
            ;;
        *) printf 'Unknown option: %s\n' "$argument" >&2; exit 1 ;;
    esac
done

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
docker_command=(docker)
if [[ "${PLANE_DOCKER_USE_SUDO:-0}" == 1 ]]; then docker_command=(sudo docker); fi
if ! command -v docker >/dev/null 2>&1; then
    printf 'Docker is required. Install Docker Engine and the Compose plugin (Linux), or Docker Desktop.\n' >&2
    exit 1
fi
if ! "${docker_command[@]}" compose version >/dev/null 2>&1; then
    printf 'The Docker Compose plugin is required (docker compose).\n' >&2
    exit 1
fi
if ! "${docker_command[@]}" info >/dev/null 2>&1; then
    printf 'Docker is not available. Start Docker and check that your user can access its socket.\n' >&2
    exit 1
fi

# Serialize startup and watch on Linux without leaving stale lock directories.
if command -v flock >/dev/null 2>&1; then
    exec 9>.docker-dev.lock
    if ! flock -n 9; then
        printf 'Setup or watch is already running for this project. Stop its watch before restarting.\n' >&2
        exit 1
    fi
fi

if [[ ! -f .env.dev ]]; then
    # Only publish the completed file. Never replace existing credentials.
    umask 077
    env_temp=$(mktemp .env.dev.XXXXXX)
    trap 'rm -f -- "$env_temp"' EXIT
    secret=$(od -An -N48 -tx1 /dev/urandom | tr -d ' \n')
    if [[ ${#secret} -ne 96 ]]; then
        printf 'Could not generate DEV_SECRET_KEY.\n' >&2
        exit 1
    fi
    tr -d '\r' < .env.dev.example | sed "s/^DEV_SECRET_KEY=$/DEV_SECRET_KEY=$secret/" > "$env_temp"
    mv -- "$env_temp" .env.dev
    trap - EXIT
fi

compose=("${docker_command[@]}" compose --project-name plane-dev --env-file .env.dev -f docker-compose-dev.yml)
"${compose[@]}" config --quiet
up_args=(up -d --wait --wait-timeout 900)
if [[ "$build" == true ]]; then up_args+=(--build); fi
if ! "${compose[@]}" "${up_args[@]}"; then
    printf 'Docker startup failed. Inspect logs with:\n' >&2
    printf 'docker compose --env-file .env.dev -f docker-compose-dev.yml logs --tail 100 migrator api frontend\n' >&2
    exit 1
fi

# Compose healthchecks validate pages and the browser API, including instance setup.
printf 'Ready. User: http://localhost:3000 | Admin: http://localhost:3001/god-mode/ | Database: http://localhost:5050\n'
printf 'Local login credentials: .env.dev and README.md.\n'
if [[ "$watch" == true ]]; then
    printf 'Watching frontend sources. Keep this terminal open. Ctrl+C stops sync; containers keep running.\n'
    "${compose[@]}" watch --no-up --prune=false
else
    printf 'Containers keep running after this terminal closes. Use --watch to sync frontend edits.\n'
fi
