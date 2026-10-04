#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
env_file="$project_root/.env.production"

if [[ $# -ne 1 ]]; then
    printf 'Usage: bash deployments/debian/init-env.sh http://192.168.10.20\n' >&2
    printf '   or: bash deployments/debian/init-env.sh https://crm.example.com\n' >&2
    exit 1
fi

if [[ -e "$env_file" || -L "$env_file" ]]; then
    printf '.env.production already exists; kept its settings and secrets. Edit it with nano.\n'
    exit 0
fi

public_url=${1%/}
if [[ ! "$public_url" =~ ^(https?)://([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)$ ]]; then
    printf 'Provide one HTTP(S) origin with a hostname/IP, without a path or custom port.\n' >&2
    exit 1
fi
scheme=${BASH_REMATCH[1]}
public_host=${BASH_REMATCH[2]}

for command in openssl sed mktemp; do
    if ! command -v "$command" >/dev/null 2>&1; then
        printf 'Missing command: %s\n' "$command" >&2
        exit 1
    fi
done

umask 077
temporary_env=$(mktemp "$project_root/.env.production.XXXXXX")
trap 'rm -f -- "$temporary_env"' EXIT
cp "$project_root/deployments/debian/production.env.example" "$temporary_env"

replace_value() {
    sed -i "s|^$1=.*|$1=$2|" "$temporary_env"
}

replace_value PUBLIC_URL "$public_url"
replace_value SITE_ADDRESS "$public_url"
replace_value ALLOWED_HOSTS "$public_host,localhost,127.0.0.1,api"
if [[ "$scheme" == https ]]; then
    replace_value MINIO_ENDPOINT_SSL 1
fi
for key in SECRET_KEY LIVE_SERVER_SECRET_KEY POSTGRES_PASSWORD RABBITMQ_PASSWORD AWS_SECRET_ACCESS_KEY PGADMIN_PASSWORD; do
    replace_value "$key" "$(openssl rand -hex 32)"
done
replace_value AWS_ACCESS_KEY_ID "$(openssl rand -hex 16)"

# A hard link publishes the complete file without overwriting a competing initializer.
ln "$temporary_env" "$env_file"
printf 'Created .env.production with independent random secrets (permissions 600).\n'
printf 'Review it with nano .env.production before deploying.\n'
