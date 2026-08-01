# Service Onboarding Playbook (weather-mcp)

1. Confirm endpoint in OpenWeather One Call 4.0 docs.
2. Add or update entry in `src/services/openWeatherEndpoints.js`.
3. Expose/extend dedicated MCP tool in `src/mcp/server.js`.
4. Add test coverage in `tests/`.
5. Regenerate inventory: `npm run inventory:generate`.
6. Run verification: `npm run verify:prepush`.

External services mode requirements:
- App-only compose path must continue supporting external Vault/Postgres.
- No secrets in Postgres.
- No config data in Vault.
