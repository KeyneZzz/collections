#!/usr/bin/env bash
set -euo pipefail

env_name="${1:-staging}"
printf 'deploy-demo: deploying to %s\n' "$env_name"
