#!/usr/bin/env bash
# One-command startup after git clone; no host Node.js or Python needed.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

install_docker=true
build=true
setup_args=()
for argument in "$@"; do
    case "$argument" in
        --no-install) install_docker=false ;;
        --no-build) build=false ;;
        --build) build=true ;;
        --watch) setup_args+=("$argument") ;;
        --help|-h)
            printf 'Usage: bash start.sh [--watch] [--no-install] [--no-build]\n'
            printf 'Installs missing Docker on Ubuntu/Debian, then starts the complete application.\n'
            printf 'Other systems need Docker Desktop/Engine installed first.\n'
            exit 0 ;;
        *) printf 'Unknown option: %s\n' "$argument" >&2; exit 1 ;;
    esac
done
if [[ "$build" == true ]]; then setup_args+=(--build); fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    if [[ "$install_docker" == false ]]; then
        printf 'Docker Engine and its Compose plugin are required (--no-install was supplied).\n' >&2
        exit 1
    fi
    bash deployments/dev/install-docker.sh
fi

# Use sudo only for a local Linux Engine. Never silently switch a remote context.
if ! docker info >/dev/null 2>&1; then
    if [[ "$(uname -s)" == Linux && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" && "$(docker context show)" == default ]]; then
        root_command=()
        if [[ $EUID -ne 0 ]]; then
            if ! command -v sudo >/dev/null 2>&1; then
                printf 'Local Docker requires root access; install sudo or run as root.\n' >&2
                exit 1
            fi
            root_command=(sudo)
        fi
        if ! "${root_command[@]}" docker info >/dev/null 2>&1; then
            if command -v systemctl >/dev/null 2>&1; then
                "${root_command[@]}" systemctl enable --now docker
            else
                printf 'Start the Docker service, then run this command again.\n' >&2
                exit 1
            fi
        fi
        if [[ $EUID -ne 0 ]]; then export PLANE_DOCKER_USE_SUDO=1; fi
    elif [[ "$(uname -s)" == Darwin && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]]; then
        open -g -a Docker
    else
        exec bash setup-dev.sh "${setup_args[@]}"
    fi
    for attempt in {1..60}; do
        if [[ "${PLANE_DOCKER_USE_SUDO:-0}" == 1 ]]; then
            if sudo docker info >/dev/null 2>&1; then break; fi
        elif docker info >/dev/null 2>&1; then break
        fi
        sleep 2
    done
fi
exec bash setup-dev.sh "${setup_args[@]}"
