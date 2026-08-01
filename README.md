# weather-mcp

Multi-tenant MCP server for OpenWeather One Call API 4.0, built from the skeleton pattern with:
- Persistent secrets in Vault
- Persistent configuration in Postgres
- Tenant/principal scoping (`tenant/user` and `tenant/account`)
- Admin-guarded mutation tools through `MCP_ADMIN_AUTH_KEY`
- Full One Call 4.0 endpoint coverage

## What This MCP Exposes

OpenWeather One Call 4.0 endpoints covered:
- `GET /data/4.0/onecall/current`
- `GET /data/4.0/onecall/timeline/1min`
- `GET /data/4.0/onecall/timeline/15min`
- `GET /data/4.0/onecall/timeline/1h`
- `GET /data/4.0/onecall/timeline/1day`
- `GET /data/4.0/onecall/alert/{alert_id}`

Extra dedicated MCP tools:
- Scope metadata and discovery
- Query suggestion and schema discovery
- Vault API key upsert/delete/status per tenant/principal
- Postgres config get/list/set/delete per tenant/principal
- Vault HTTP token create/revoke per tenant/principal
- Safe pagination URL follower

## Persistence Model

- Secrets (`OpenWeather API key`, `HTTP auth token index`) are stored in Vault KV.
- Config values are stored in Postgres table `<app_name>_config`.

Scope path examples:
- Vault token index: `weather/tenants/acme/users/sam/http/auth/token-index`
- Vault API key secret: `weather/tenants/acme/users/sam/http/auth/token-index/openweather`

## Quick Start

1. Copy `.env.example` to `.env` and fill values.
2. Start local dependencies:
   - `docker compose up -d postgres vault`
3. Install dependencies:
   - `npm ci`
4. Generate endpoint inventory artifact:
   - `npm run inventory:generate`
5. Run tests:
   - `npm test`
6. Start MCP:
   - stdio: `npm run start:stdio`
   - http: `npm run start:http`

## Key Environment Variables

- `MCP_ADMIN_AUTH_KEY`: Required for mutating tools when set.
- `MCP_CONFIG_DEFAULT_TENANT_ID`
- `MCP_CONFIG_DEFAULT_PRINCIPAL_TYPE`
- `MCP_CONFIG_DEFAULT_PRINCIPAL_ID`
- `OPENWEATHER_API_KEY`: global fallback only; recommended pattern is scoped Vault key via tool.
- `MCP_HTTP_TOKEN_SOURCE=vault|static`

See `.env.example` for complete list.

## Tooling Reference

Detailed LLM-oriented tool contracts are in:
- `docs/tools.md`

Coverage inventory artifact:
- `artifacts/openweather-onecall4-inventory.json`

## Inventory and Push Enforcement

Scripts:
- `npm run inventory:generate`
- `npm run inventory:check`
- `npm run verify:prepush`

CI workflow `.github/workflows/inventory-and-tests.yml` enforces:
- Inventory generation
- Inventory file committed and stable
- Full test pass through `verify:prepush`

## Security Notes

- Do not place production OpenWeather keys in plaintext env if scoped Vault keys are available.
- Mutating tools should always be invoked with `authorizationKey` when `MCP_ADMIN_AUTH_KEY` is configured.
- `MCP_ALLOW_SENSITIVE_OUTPUT=false` redacts sensitive values from tool output.

## License

MIT (see `LICENSE`).
