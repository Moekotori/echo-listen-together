#!/bin/sh
# Run from a downloaded/checked-out repository. Requires Docker, not host Node.js.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v docker >/dev/null 2>&1; then
  echo '请先安装 Docker Engine 和 Compose / Install Docker Engine and Compose first.' >&2
  exit 1
fi
docker compose version >/dev/null
docker info >/dev/null
if [ -e .env ]; then
  echo '使用已有 .env，不覆盖凭据 / Reusing .env; credentials are preserved.'
else
  printf '公网 IPv4 或域名（不含协议） / Public IPv4 or domain (no scheme): '
  IFS= read -r domain
  docker run --rm --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$(pwd),target=/workspace" --workdir /workspace \
    node:22-alpine node --input-type=module -e \
    'import { configure } from "./scripts/configure.mjs"; await configure(process.argv[1]);' "$domain"
fi
echo '构建并启动 / Building and starting containers…'
docker compose up -d --build
attempt=0
while [ "$attempt" -lt 12 ]; do
  attempt=$((attempt + 1))
  if docker compose exec -T relay npm run info; then
    echo '部署完成 / Deployment ready.'
    exit 0
  fi
  if [ "$attempt" -lt 12 ]; then
    echo '等待证书和网关就绪 / Waiting for certificate and gateway…'
    sleep 3
  fi
done
echo '公网检查未通过 / Public health check failed. Run: docker compose logs --tail=80 gateway relay' >&2
exit 1
