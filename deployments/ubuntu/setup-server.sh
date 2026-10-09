#!/usr/bin/env bash
# Prepare the Ubuntu host; application packages are installed inside Docker.
set -Eeuo pipefail

phase="checking Ubuntu"
on_error() {
    status=$?
    printf 'Ubuntu setup failed while %s (exit %s). Stop here and resolve the error before deploying.\n' "$phase" "$status" >&2
    exit "$status"
}
trap on_error ERR

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --no-install ) ]]; then
    printf 'Usage: bash deployments/ubuntu/setup-server.sh [--no-install]\n' >&2
    exit 1
fi
os_release_file=${PLANE_OS_RELEASE_FILE:-/etc/os-release}
if [[ "$(uname -s)" != Linux || ! -r "$os_release_file" ]]; then
    printf 'Run this script inside the Ubuntu server SSH session.\n' >&2
    exit 1
fi
. "$os_release_file"
if [[ "${ID:-}" != ubuntu ]]; then
    printf 'This setup script requires Ubuntu; detected %s.\n' "${ID:-unknown}" >&2
    exit 1
fi
codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
if [[ -z "$codename" || ! "$codename" =~ ^[a-z]+$ ]]; then
    printf 'Cannot determine a valid Ubuntu release codename.\n' >&2
    exit 1
fi
if [[ -n "${DOCKER_HOST:-}" || -n "${DOCKER_CONTEXT:-}" ]]; then
    printf 'This script prepares the local Ubuntu Docker Engine. Clear the remote Docker environment settings first.\n' >&2
    exit 1
fi

root_command=()
if [[ $EUID -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
        printf 'Run with a sudo-enabled account or a root shell.\n' >&2
        exit 1
    fi
    root_command=(sudo)
    sudo -v
fi

docker_ready=false
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker_ready=true
fi
host_tools_ready=true
for tool in openssl nano tmux; do
    if ! command -v "$tool" >/dev/null 2>&1; then host_tools_ready=false; fi
done
if [[ "${1:-}" == --no-install && ( "$docker_ready" == false || "$host_tools_ready" == false ) ]]; then
    printf 'Docker Compose, OpenSSL, nano and tmux must already be installed when using --no-install.\n' >&2
    exit 1
fi

printf 'Preparing Ubuntu %s (%s).\n' "${VERSION_ID:-unknown}" "$codename"
if [[ "$docker_ready" == false ]]; then
    # Existing container runtimes may serve other applications. Never uninstall them.
    for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
        if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" == 'install ok installed' ]]; then
            printf 'Package %s conflicts with official Docker packages. Resolve the package conflict before retrying; setup stopped.\n' "$package" >&2
            exit 1
        fi
    done

    phase="installing host tools"
    # Override only in isolated tests; the real host uses /etc.
    etc_dir=${PLANE_ETC_DIR:-/etc}
    sources_dir="$etc_dir/apt/sources.list.d"
    docker_sources="$sources_dir/docker.sources"
    "${root_command[@]}" install -m 0755 -d "$sources_dir"
    # Repair the Debian source from the earlier manual instructions before apt update.
    if [[ -f "$docker_sources" ]] && grep -q 'download.docker.com/linux/debian' "$docker_sources"; then
        "${root_command[@]}" cp -p "$docker_sources" "$docker_sources.before-ubuntu-$(date +%Y%m%d%H%M%S)"
        "${root_command[@]}" sed -i \
            -e 's|download.docker.com/linux/debian|download.docker.com/linux/ubuntu|g' \
            -e "s|^Suites:.*|Suites: $codename|" "$docker_sources"
    fi
    "${root_command[@]}" apt-get update
    "${root_command[@]}" apt-get install -y ca-certificates curl openssl nano tmux

    phase="configuring the official Ubuntu Docker repository"
    "${root_command[@]}" install -m 0755 -d "$etc_dir/apt/keyrings"
    key_file=$(mktemp)
    source_file=$(mktemp)
    trap 'rm -f -- "$key_file" "$source_file"' EXIT
    curl --fail --show-error --silent --location --retry 5 \
        https://download.docker.com/linux/ubuntu/gpg -o "$key_file"
    "${root_command[@]}" install -m 0644 "$key_file" "$etc_dir/apt/keyrings/docker.asc"
    if [[ -f "$docker_sources" ]]; then
        "${root_command[@]}" cp -p "$docker_sources" "$docker_sources.before-setup-$(date +%Y%m%d%H%M%S)"
    fi
    printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: %s/apt/keyrings/docker.asc\n' \
        "$codename" "$(dpkg --print-architecture)" "$etc_dir" > "$source_file"
    "${root_command[@]}" install -m 0644 "$source_file" "$docker_sources"

    phase="installing Docker Engine and Compose"
    "${root_command[@]}" apt-get update
    "${root_command[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
elif [[ "$host_tools_ready" == false ]]; then
    phase="installing host tools"
    "${root_command[@]}" apt-get update
    "${root_command[@]}" apt-get install -y openssl nano tmux
fi

phase="starting the Docker service"
"${root_command[@]}" systemctl enable --now docker
phase="verifying Docker"
"${root_command[@]}" docker info >/dev/null
"${root_command[@]}" docker compose version
printf 'Ubuntu host is ready. Next: bash deployments/ubuntu/init-env.sh http://192.168.10.20\n'
