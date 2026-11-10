# Quick Start

## 1. Boot the local stack

```bash
git clone https://github.com/vfvincentwong2026/ai-native-dam.git
cd ai-native-dam
cp .env.example .env
docker compose up -d
```

Postgres: `localhost:5432` · MinIO S3: `localhost:9000` · MinIO Console: `localhost:9001`

## 2. Apply migrations

```bash
docker compose exec -T postgres psql -U dam -d dam < infra/migrations/0001_init.sql
docker compose exec -T postgres psql -U dam -d dam < infra/seed/0001_channels.sql
```

## 3. Verify the public showcase MCP endpoint

```bash
curl -s https://ai-native-dam.pages.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 4. Install and typecheck locally

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

## 5. Next: full governance plane

The showcase endpoint is read-only. For write tools (`create_asset`,
`apply_skill`, `submit_system_spec`), follow `docs/architecture.md` and stand
up Artbucket + the MCP Gateway on your own host.
