#!/usr/bin/env bash
# Official signed apt repository; never run a downloaded installation script.
set -euo pipefail
if [[ "$(uname -s)" != Linux || ! -r /etc/os-release ]]; then
    printf 'Install Docker Desktop on this system, then run bash start.sh again.\n' >&2
    exit 1
fi
. /etc/os-release
case "$ID" in
    ubuntu|debian) ;;
    *) printf 'Automatic Docker installation supports Ubuntu and Debian. Install Docker Engine + Compose on %s, then retry.\n' "$ID" >&2; exit 1 ;;
esac
codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
if [[ -z "$codename" ]]; then
    printf 'Cannot determine the Linux release codename.\n' >&2
    exit 1
fi
root_command=()
if [[ $EUID -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
        printf 'Docker installation needs sudo or a root shell.\n' >&2
        exit 1
    fi
    root_command=(sudo)
fi
# Do not remove another application's container runtime to make installation work.
for package in docker.io podman-docker containerd runc; do
    if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" == 'install ok installed' ]]; then
        printf 'Existing package %s conflicts with official Docker packages. Install a compatible Compose plugin for your engine manually; no packages were removed.\n' "$package" >&2
        exit 1
    fi
done
printf 'Installing Docker Engine and Compose from the official %s apt repository (sudo may request your password).\n' "$ID"
"${root_command[@]}" apt-get update
"${root_command[@]}" apt-get install -y ca-certificates curl
"${root_command[@]}" install -m 0755 -d /etc/apt/keyrings
key_file=$(mktemp)
source_file=$(mktemp)
trap 'rm -f -- "$key_file" "$source_file"' EXIT
curl --fail --show-error --silent --location --retry 5 "https://download.docker.com/linux/$ID/gpg" -o "$key_file"
"${root_command[@]}" install -m 0644 "$key_file" /etc/apt/keyrings/plane-docker.asc
printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/plane-docker.asc\n' "$ID" "$codename" "$(dpkg --print-architecture)" > "$source_file"
# Leave an existing administrator-managed Docker repository untouched.
if [[ ! -f /etc/apt/sources.list.d/docker.sources && ! -f /etc/apt/sources.list.d/docker.list ]]; then
    "${root_command[@]}" install -m 0644 "$source_file" /etc/apt/sources.list.d/plane-docker.sources
fi
"${root_command[@]}" apt-get update
"${root_command[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version
