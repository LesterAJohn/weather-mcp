# MCP Tool Definitions (LLM-Facing)

All tools return:
- Success: `{ ok: true, status: 200, data: ... }`
- Error: `{ ok: false, status: <http-like-code>, error: <message> }` with MCP `isError=true`

## weather_query_suggestion
- Use when: You need recommendation on the safest tool flow and schema discovery.
- Do not use when: You already know exact tool + params.
- Mode: Read-only.
- Risk: Low.
- Required permissions: None.
- Prerequisites: None.
- Environment behavior: Indicates if mutating flow would require `authorizationKey` under `MCP_ADMIN_AUTH_KEY`.
- Parameters:
  - `intent?`: free text
  - `operationType?`: `discover|read|mutate|key_management|config|token|weather`
  - `includeExamples?`: boolean
  - `includeToolSchemas?`: boolean
- Response shape:
  - `data.summary`, `data.recommendedOrder`, `data.safetyChecks`, `data.endpointInventory`
- Common failures:
  - `500` internal exception
- Recommended prerequisites:
  - none
- Follow-up tools:
  - `weather_connection_info`, `weather_endpoint_inventory`, `weather_current`
- Example:
```json
{"name":"weather_query_suggestion","arguments":{"intent":"get hourly forecast then alert details"}}
```

## weather_connection_info
- Use when: Inspect server runtime posture and persistence model.
- Do not use when: You need weather data itself.
- Mode: Read-only.
- Risk: Low.
- Permissions: None.
- Prerequisites: None.
- Environment behavior: Reflects configured defaults and auth posture.
- Parameters: none.
- Response shape: server metadata + service connection info.
- Common failures: rare `500`.
- Follow-up: `weather_scope_info`, `weather_health_check`.
- Example:
```json
{"name":"weather_connection_info","arguments":{}}
```

## weather_scope_info
- Use when: Need resolved tenant/principal model and derived vault/postgres paths.
- Do not use when: Scope is already validated.
- Mode: Read-only.
- Risk: Low.
- Permissions: None.
- Prerequisites: Exactly one of `userId` or `accountId`.
- Environment behavior: Resolves defaults when ids are omitted.
- Parameters:
  - `tenantId` required
  - exactly one of `userId` or `accountId`
- Response shape: `data.appName`, `data.vault`, `data.postgres`, principal fields.
- Common failures: `400` when both/neither user/account supplied.
- Follow-up: `weather_api_key_upsert`, config tools.
- Example:
```json
{"name":"weather_scope_info","arguments":{"tenantId":"acme","userId":"sam"}}
```

## weather_endpoint_inventory
- Use when: Need endpoint coverage list and schema metadata.
- Do not use when: You only need one known endpoint call.
- Mode: Read-only.
- Risk: Low.
- Permissions: None.
- Prerequisites: None.
- Environment behavior: none.
- Parameters: none.
- Response shape: generated inventory artifact JSON.
- Common failures: `500` internal.
- Follow-up: endpoint-specific weather tools.
- Example:
```json
{"name":"weather_endpoint_inventory","arguments":{}}
```

## weather_health_check
- Use when: Validate Postgres, Vault, and OpenWeather call path together.
- Do not use when: You only need cached local metadata.
- Mode: Read-only external call.
- Risk: Medium (consumes API call quota).
- Permissions: scoped key must exist.
- Prerequisites: Vault key configured or env fallback.
- Environment behavior: checks selected scope.
- Parameters: optional scope fields.
- Response shape: `{configStore,vault,openWeather,scope}`.
- Common failures: `400` key missing, `401/429/5xx` from upstream.
- Follow-up: key/config tools.
- Example:
```json
{"name":"weather_health_check","arguments":{"tenantId":"acme","userId":"sam"}}
```

## weather_current
- Use when: current conditions snapshot.
- Do not use when: timeline/history needed.
- Mode: Read-only.
- Risk: Low.
- Permissions: scoped key required.
- Prerequisites: key exists for scope.
- Environment behavior: applies scope and optional units/lang.
- Parameters: `lat`,`lon`,`units?`,`lang?`,`tenantId?`,`userId?`,`accountId?`.
- Response shape: OpenWeather current payload wrapper.
- Common failures: invalid coordinates, auth/rate-limit errors.
- Follow-up: timeline or alert tools.
- Example:
```json
{"name":"weather_current","arguments":{"lat":52.52,"lon":13.4,"units":"metric","tenantId":"acme","userId":"sam"}}
```

## weather_timeline_1min / weather_timeline_15min / weather_timeline_1h / weather_timeline_1day
- Use when: timeline data at specific resolution is needed.
- Do not use when: single current snapshot is enough.
- Mode: Read-only.
- Risk: Low to medium (larger responses, quota usage).
- Permissions: scoped key required.
- Prerequisites: key exists.
- Environment behavior: supports optional `start`, `tz`, `cnt` where API supports it.
- Parameters: location params + timeline params.
- Response shape: timeline payload with possible `next`/`prev`.
- Common failures: `400` invalid date/start/cnt, `429` quota limits.
- Follow-up: `weather_follow_pagination_url`, `weather_alert_details`.
- Example:
```json
{"name":"weather_timeline_1h","arguments":{"lat":34.05,"lon":-118.24,"cnt":20,"tenantId":"acme","accountId":"ops"}}
```

## weather_alert_details
- Use when: resolve alert metadata by `alertId`.
- Do not use when: you do not yet have alert ids.
- Mode: Read-only.
- Risk: Low.
- Permissions: scoped key required.
- Prerequisites: obtain alert id from current/timeline response.
- Environment behavior: scope-based key lookup.
- Parameters: `alertId` + optional scope.
- Response shape: `id,sender_name,event,start,end,description`.
- Common failures: `404` invalid id, auth/rate-limit issues.
- Follow-up: downstream incident workflows.
- Example:
```json
{"name":"weather_alert_details","arguments":{"alertId":"8B46C632-DCA7-44D7-8BDF-02445621BAFF","tenantId":"acme","userId":"sam"}}
```

## weather_follow_pagination_url
- Use when: following API-provided `next`/`prev` links.
- Do not use when: URL is user-invented or non-OpenWeather origin.
- Mode: Read-only.
- Risk: Medium (external request).
- Permissions: scoped key required.
- Prerequisites: valid `next`/`prev` URL from prior response.
- Environment behavior: enforces allowed origin from configured base URL.
- Parameters: `url` + optional scope.
- Response shape: same wrapper as normal request.
- Common failures: `400` invalid origin.
- Follow-up: additional pagination requests.
- Safety warning: never provide arbitrary third-party URLs.
- Example:
```json
{"name":"weather_follow_pagination_url","arguments":{"url":"https://api.openweathermap.org/data/4.0/onecall/timeline/1h?...","tenantId":"acme","userId":"sam"}}
```

## weather_config_list / weather_config_get
- Use when: inspect scoped Postgres configuration.
- Do not use when: you need secret material.
- Mode: Read-only.
- Risk: Low.
- Permissions: none beyond MCP access.
- Prerequisites: scope understanding.
- Environment behavior: default scope fallback if omitted.
- Parameters:
  - `weather_config_list`: `prefix?` + scope
  - `weather_config_get`: `key` + scope
- Response shape: config rows or single row.
- Common failures: database connectivity errors.
- Follow-up: `weather_config_set`.
- Example:
```json
{"name":"weather_config_get","arguments":{"key":"weather.defaults.units","tenantId":"acme","userId":"sam"}}
```

## weather_config_set / weather_config_delete
- Use when: mutate scoped Postgres config.
- Do not use when: read-only access is sufficient.
- Mode: Mutating.
- Risk: High (behavioral changes across workloads).
- Required permissions: `authorizationKey` when `MCP_ADMIN_AUTH_KEY` exists.
- Prerequisites: validate current value with read tools first.
- Environment behavior: scope-aware writes/deletes.
- Parameters:
  - `weather_config_set`: `key`,`value`,`authorizationKey?` + scope
  - `weather_config_delete`: `key`,`authorizationKey?` + scope
- Response shape: affected row metadata / deleted flag.
- Common failures: unauthorized (`401`), DB errors.
- Follow-up: `weather_config_get`.
- Safety warning: destructive if deleting essential defaults.
- Example:
```json
{"name":"weather_config_set","arguments":{"key":"weather.defaults.lang","value":"en","tenantId":"acme","accountId":"ops","authorizationKey":"<admin>"}}
```

## weather_api_key_status
- Use when: check if scoped OpenWeather API key exists.
- Do not use when: you need actual key material.
- Mode: Read-only.
- Risk: Low.
- Permissions: none beyond MCP access.
- Prerequisites: scope selection.
- Environment behavior: scoped Vault lookup.
- Parameters: optional scope.
- Response shape: `{configured,path,updatedAt,scope}`.
- Common failures: vault availability errors.
- Follow-up: `weather_api_key_upsert`.
- Example:
```json
{"name":"weather_api_key_status","arguments":{"tenantId":"acme","userId":"sam"}}
```

## weather_openweather_key_request_create
- Use when: you need to track/request key acquisition workflow for a tenant/principal before key ingestion.
- Do not use when: a scoped key is already configured and active.
- Mode: Mutating.
- Risk: Medium.
- Required permissions: `authorizationKey` when `MCP_ADMIN_AUTH_KEY` exists.
- Prerequisites: scope selection.
- Environment behavior: stores request metadata at scoped Postgres config key `openweather.keyRequest`.
- Parameters: `requester?`, `reason?`, `authorizationKey?` + scope.
- Response shape: `{scope,key,request,nextStep}`.
- Common failures: unauthorized (`401`), Postgres write failures.
- Follow-up: `weather_openweather_key_request_status`, `weather_api_key_upsert`.
- Safety warning: this does not create OpenWeather key automatically; it tracks workflow state only.
- Example:
```json
{"name":"weather_openweather_key_request_create","arguments":{"tenantId":"acme","userId":"sam","reason":"tenant onboarding","authorizationKey":"<admin>"}}
```

## weather_openweather_key_request_status
- Use when: check whether key request is pending/completed and whether a scoped key exists.
- Do not use when: you only need portal instructions with no scope context.
- Mode: Read-only.
- Risk: Low.
- Required permissions: none.
- Prerequisites: scope selection.
- Environment behavior: combines scoped Postgres request record and Vault key presence check.
- Parameters: scope.
- Response shape: `{scope,keyConfigured,vaultPath,request,recommendedNextSteps}`.
- Common failures: Postgres/Vault read failures.
- Follow-up: `weather_openweather_key_request_create`, `weather_api_key_upsert`, weather data tools.
- Example:
```json
{"name":"weather_openweather_key_request_status","arguments":{"tenantId":"acme","userId":"sam"}}
```

## weather_api_key_upsert / weather_api_key_delete
- Use when: create/rotate/remove scoped API keys.
- Do not use when: weather reads can use existing key.
- Mode: Mutating.
- Risk: High.
- Required permissions: admin `authorizationKey` if configured.
- Prerequisites: valid scope.
- Environment behavior: writes/deletes under scoped Vault path.
- Parameters:
  - `weather_api_key_upsert`: `apiKey`,`authorizationKey?` + scope
  - `weather_api_key_delete`: `authorizationKey?` + scope
- Response shape: path + scope + mutation result flag.
- Common failures: unauthorized, vault write/delete failures.
- Follow-up: `weather_api_key_status`, `weather_current`.
- Safety warning: deleting key breaks downstream weather calls for that scope.
- Example:
```json
{"name":"weather_api_key_upsert","arguments":{"tenantId":"acme","userId":"sam","apiKey":"owm_...","authorizationKey":"<admin>"}}
```

## weather_http_token_create / weather_http_token_revoke
- Use when: managing scoped MCP HTTP auth tokens in Vault.
- Do not use when: stdio mode without HTTP auth.
- Mode: Mutating.
- Risk: High.
- Required permissions: admin `authorizationKey` if configured.
- Prerequisites: Vault write access and scope selection.
- Environment behavior: token index path derives from app + tenant + principal.
- Parameters:
  - create: `tokenId?`,`token?`,`scopes?`,`audience?`,`expiresAt?`,`authorizationKey?` + scope
  - revoke: `token?` or `tokenHash`,`authorizationKey?` + scope
- Response shape: token metadata, hash, index path, revoked flag.
- Common failures: unauthorized, missing token inputs, unknown token hash.
- Follow-up: HTTP client auth validation tests.
- Safety warning: revoking active tokens may break running clients.
- Example:
```json
{"name":"weather_http_token_create","arguments":{"tenantId":"acme","accountId":"ops","scopes":["mcp:invoke"],"audience":["codex"],"authorizationKey":"<admin>"}}
```
