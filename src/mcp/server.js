import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createBearerToken,
  createVaultTokenEntry,
  getVaultTenantPrincipalTokenIndexPath,
  mergeVaultTokenIndex,
  normalizeAppName,
  normalizePrincipalIdForPath,
  normalizeTenantIdForPath,
  resolveTenantPrincipalScope,
  sha256Hex
} from "../config/vaultAuthTokenIndex.js";
import { buildEndpointInventoryArtifact, OPENWEATHER_ONECALL4_ENDPOINTS } from "../services/openWeatherEndpoints.js";
import { redactObject } from "../services/security.js";

const MUTATING_TOOLS = new Set([
  "weather_api_key_upsert",
  "weather_api_key_delete",
  "weather_config_set",
  "weather_config_delete",
  "weather_openweather_key_request_create",
  "weather_http_token_create",
  "weather_http_token_revoke"
]);

const OPENWEATHER_KEY_REQUEST_CONFIG_KEY = "openweather.keyRequest";

const ScopeSchema = {
  tenantId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional()
};

const LocationSchema = {
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  units: z.enum(["standard", "metric", "imperial"]).optional(),
  lang: z.string().min(2).optional(),
  ...ScopeSchema
};

const TimelineSchema = {
  ...LocationSchema,
  start: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  tz: z.string().min(1).optional(),
  cnt: z.number().int().positive().optional()
};

const TOOL_CATALOG = [
  {
    name: "weather_query_suggestion",
    useWhen: "You need schema discovery, endpoint selection, and safety guidance before invoking weather tools.",
    avoidWhen: "You already know the exact tool, parameters, and scope.",
    category: "read-only",
    risk: "low",
    permissions: "No special permissions",
    prerequisites: "None",
    environmentSelection: "Reports whether admin authorization key is required for mutating workflows.",
    params: ["intent?", "operationType?", "includeExamples?", "includeToolSchemas?"],
    response: "summary + recommendedOrder + safetyChecks + endpointInventory (+toolSchemas/examples optional)",
    failureModes: ["500 internal failure"],
    followUp: ["weather_connection_info", "weather_endpoint_inventory", "weather_current"],
    example: { name: "weather_query_suggestion", arguments: { intent: "hourly forecast for tenant acme user sam" } }
  },
  {
    name: "weather_current",
    useWhen: "Get current weather conditions for a location.",
    avoidWhen: "You need timeline/history; use weather_timeline_* tools.",
    category: "read-only",
    risk: "low",
    permissions: "Scoped OpenWeather API key must exist in Vault or OPENWEATHER_API_KEY env fallback.",
    prerequisites: "Set scoped API key with weather_api_key_upsert if no key exists.",
    environmentSelection: "Resolves tenant/principal scope for Vault key lookup.",
    params: ["lat", "lon", "units?", "lang?", "tenantId?", "userId?", "accountId?"],
    response: "OpenWeather current endpoint payload wrapper",
    failureModes: ["400 missing or invalid key", "401/429/5xx from OpenWeather"],
    followUp: ["weather_timeline_1h", "weather_alert_details"],
    example: { name: "weather_current", arguments: { lat: 40.71, lon: -74.0, units: "metric", tenantId: "acme", userId: "sam" } }
  },
  {
    name: "weather_api_key_upsert",
    useWhen: "Create or rotate scoped OpenWeather API keys for tenant/user or tenant/account.",
    avoidWhen: "Read-only calls; this mutates Vault state.",
    category: "mutating",
    risk: "high",
    permissions: "Requires authorizationKey when MCP_ADMIN_AUTH_KEY is configured.",
    prerequisites: "Vault connectivity and write access",
    environmentSelection: "Writes to vault path under app/tenants/{tenant}/{principalType}s/{principal}/http/auth/token-index/openweather.",
    params: ["apiKey", "tenantId", "userId?", "accountId?", "authorizationKey?"],
    response: "path + tenant/principal metadata",
    failureModes: ["401 unauthorized admin key", "Vault write errors"],
    followUp: ["weather_api_key_status", "weather_current"],
    example: { name: "weather_api_key_upsert", arguments: { tenantId: "acme", userId: "sam", apiKey: "owm_...", authorizationKey: "<admin>" } }
  },
  {
    name: "weather_openweather_key_request_create",
    useWhen: "Submit or refresh a scoped request ticket for obtaining an OpenWeather API key from the website.",
    avoidWhen: "A valid scoped key is already configured in Vault.",
    category: "mutating",
    risk: "medium",
    permissions: "Requires authorizationKey when MCP_ADMIN_AUTH_KEY is configured.",
    prerequisites: "Resolved tenant/principal scope and operational key request process.",
    environmentSelection: "Stores request metadata in Postgres scoped config key openweather.keyRequest.",
    params: ["tenantId?", "userId?", "accountId?", "requester?", "reason?", "authorizationKey?"],
    response: "request metadata plus OpenWeather key portal URLs",
    failureModes: ["401 unauthorized admin key", "database write failures"],
    followUp: ["weather_openweather_key_request_status", "weather_api_key_upsert"],
    example: { name: "weather_openweather_key_request_create", arguments: { tenantId: "acme", userId: "sam", reason: "new tenant onboarding" } }
  },
  {
    name: "weather_openweather_key_request_status",
    useWhen: "Check scoped key-request status and whether an API key is already configured.",
    avoidWhen: "You only need weather data and key already exists.",
    category: "read-only",
    risk: "low",
    permissions: "No special permissions",
    prerequisites: "Resolved tenant/principal scope.",
    environmentSelection: "Reads Postgres request metadata and scoped Vault key status.",
    params: ["tenantId?", "userId?", "accountId?"],
    response: "scope + keyConfigured + request record + recommendedNextSteps",
    failureModes: ["Vault/Postgres read failures"],
    followUp: ["weather_openweather_key_request_create", "weather_api_key_upsert", "weather_current"],
    example: { name: "weather_openweather_key_request_status", arguments: { tenantId: "acme", userId: "sam" } }
  }
];

function ensureSinglePrincipal({ userId, accountId }) {
  if (Boolean(userId) === Boolean(accountId)) {
    throw Object.assign(new Error("Provide exactly one of userId or accountId"), { status: 400 });
  }
}

function normalizeScope(scope, defaults) {
  return resolveTenantPrincipalScope(scope, {
    defaultTenantId: defaults.tenantId,
    defaultPrincipalType: defaults.principalType,
    defaultPrincipalId: defaults.principalId
  });
}

function safeParseExpiresAt(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return undefined;
  }

  if (/^\d+$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw Object.assign(new Error("expiresAt must be ISO timestamp or unix seconds"), { status: 400 });
  }

  return new Date(parsed).toISOString();
}

export function createMcpServer({
  name,
  version,
  serviceClient,
  configStore,
  vaultService,
  appName,
  scopeDefaults,
  allowSensitiveOutput = false
}) {
  const server = new McpServer({ name, version });
  const adminAuthKey = process.env.MCP_ADMIN_AUTH_KEY;
  const normalizedAppName = normalizeAppName(appName ?? process.env.APP_NAME ?? "weather");

  function asText(value) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(redactObject(value, allowSensitiveOutput), null, 2)
        }
      ]
    };
  }

  function withErrorHandling(handler) {
    return async (args) => {
      try {
        return asText(await handler(args));
      } catch (error) {
        const status = Number(error?.status ?? error?.statusCode ?? 500);
        const payload = {
          ok: false,
          status: Number.isFinite(status) ? status : 500,
          error: error instanceof Error ? error.message : String(error)
        };
        return { ...asText(payload), isError: true };
      }
    };
  }

  function assertAuthorized(authorizationKey, toolName) {
    if (!MUTATING_TOOLS.has(toolName)) {
      return;
    }

    if (!adminAuthKey) {
      return;
    }

    if (!authorizationKey || authorizationKey !== adminAuthKey) {
      throw Object.assign(new Error("Unauthorized: invalid authorizationKey for mutating tool"), { status: 401 });
    }
  }

  function buildScopeModel(scope = {}) {
    const resolvedScope = normalizeScope(scope, scopeDefaults);
    return {
      appName: normalizedAppName,
      tenantId: resolvedScope.tenantId,
      tenantIdPathSegment: normalizeTenantIdForPath(resolvedScope.tenantId),
      principalType: resolvedScope.principalType,
      principalId: resolvedScope.principalId,
      principalIdPathSegment: normalizePrincipalIdForPath(resolvedScope.principalId),
      userId: resolvedScope.userId,
      accountId: resolvedScope.accountId,
      postgres: {
        tableName: `${normalizedAppName}_config`,
        primaryKey: ["tenant_id", "principal_type", "principal_id", "key"]
      },
      vault: {
        tokenIndexPath: getVaultTenantPrincipalTokenIndexPath(normalizedAppName, resolvedScope),
        apiKeyPath: `${getVaultTenantPrincipalTokenIndexPath(normalizedAppName, resolvedScope)}/openweather`
      }
    };
  }

  server.tool(
    "weather_query_suggestion",
    "Schema-discovery and tool recommendation helper for OpenWeather One Call workflows.",
    {
      intent: z.string().min(1).optional(),
      operationType: z.enum(["discover", "read", "mutate", "key_management", "config", "token", "weather"]).optional(),
      includeExamples: z.boolean().optional(),
      includeToolSchemas: z.boolean().optional()
    },
    withErrorHandling(async ({ intent, operationType, includeExamples, includeToolSchemas }) => {
      const text = String(intent ?? "").toLowerCase();
      const op = String(operationType ?? "").toLowerCase();
      const wantsMutating = op === "mutate" || op === "key_management" || op === "config" || op === "token";
      const wantsTimeline = text.includes("timeline") || text.includes("hour") || text.includes("forecast");
      const wantsAlert = text.includes("alert");
      const wantsConfig = op === "config" || text.includes("config");
      const wantsToken = op === "token" || text.includes("token");
      const wantsKey = op === "key_management" || text.includes("api key") || text.includes("apikey");
      const wantsKeyRequest = text.includes("request key") || text.includes("get key") || text.includes("obtain key");

      const recommendedOrder = [
        { tool: "weather_connection_info", reason: "Validate runtime posture and scope model." },
        { tool: "weather_endpoint_inventory", reason: "Review endpoint coverage and parameters." }
      ];

      if (wantsTimeline) {
        recommendedOrder.push({ tool: "weather_timeline_1h", reason: "Hourly timeline is typically the best starting timeline signal." });
      } else if (wantsAlert) {
        recommendedOrder.push({ tool: "weather_alert_details", reason: "Resolve alert metadata using alert id." });
      } else if (wantsConfig) {
        recommendedOrder.push({ tool: "weather_config_list", reason: "Inspect existing scoped configuration before mutation." });
      } else if (wantsToken) {
        recommendedOrder.push({ tool: "weather_http_token_create", reason: "Create tenant/principal scoped HTTP token entry in Vault." });
      } else if (wantsKeyRequest) {
        recommendedOrder.push({ tool: "weather_openweather_key_request_create", reason: "Track a scoped key request workflow before key ingestion." });
        recommendedOrder.push({ tool: "weather_openweather_key_request_status", reason: "Verify pending/completed request state and readiness." });
      } else if (wantsKey) {
        recommendedOrder.push({ tool: "weather_api_key_upsert", reason: "Set scoped OpenWeather API key in Vault for multi-tenant calls." });
      } else {
        recommendedOrder.push({ tool: "weather_current", reason: "Start with current conditions to validate parameters and key readiness." });
      }

      const payload = {
        ok: true,
        status: 200,
        data: {
          summary: {
            intent: intent ?? null,
            operationType: operationType ?? null,
            mutatingIntent: wantsMutating,
            adminAuthorizationKeyRequired: Boolean(adminAuthKey) && wantsMutating
          },
          recommendedOrder,
          safetyChecks: [
            "Use weather_scope_info to confirm tenant/principal resolution before scoped updates.",
            "Use weather_openweather_key_request_create to track website key acquisition before storing keys.",
            "Apply weather_api_key_upsert prior to weather reads if the scoped key is missing.",
            "Treat weather_config_set and weather_http_token_* as mutating operations.",
            "For mutating tools, provide authorizationKey when MCP_ADMIN_AUTH_KEY is configured.",
            "Use weather_follow_pagination_url only with API-provided next/prev links."
          ],
          endpointInventory: buildEndpointInventoryArtifact()
        }
      };

      if (includeExamples !== false) {
        payload.data.examples = {
          read: {
            name: "weather_current",
            arguments: { lat: 37.7749, lon: -122.4194, units: "metric", tenantId: "acme", userId: "sam" }
          },
          mutate: {
            name: "weather_api_key_upsert",
            arguments: {
              tenantId: "acme",
              userId: "sam",
              apiKey: "owm_...",
              authorizationKey: "<admin-key-if-required>"
            }
          }
        };
      }

      if (includeToolSchemas !== false) {
        payload.data.toolSchemas = TOOL_CATALOG;
      }

      return payload;
    })
  );

  server.tool(
    "weather_connection_info",
    "Return MCP + OpenWeather connection metadata and persistence model details.",
    {},
    withErrorHandling(async () => ({
      ok: true,
      status: 200,
      data: {
        server: {
          name,
          version,
          adminAuthConfigured: Boolean(adminAuthKey),
          scopeDefaults,
          appName: normalizedAppName
        },
        service: serviceClient.getConnectionInfo(),
        persistence: {
          secrets: "vault",
          config: "postgres"
        }
      }
    }))
  );

  server.tool(
    "weather_scope_info",
    "Resolve tenant/user or tenant/account scope metadata and derived Vault/Postgres paths.",
    {
      tenantId: z.string().min(1),
      userId: z.string().min(1).optional(),
      accountId: z.string().min(1).optional()
    },
    withErrorHandling(async ({ tenantId, userId, accountId }) => {
      ensureSinglePrincipal({ userId, accountId });
      return { ok: true, status: 200, data: buildScopeModel({ tenantId, userId, accountId }) };
    })
  );

  server.tool(
    "weather_endpoint_inventory",
    "Return generated endpoint inventory for One Call 4.0 coverage.",
    {},
    withErrorHandling(async () => ({ ok: true, status: 200, data: buildEndpointInventoryArtifact() }))
  );

  server.tool(
    "weather_health_check",
    "Run health checks for Postgres, Vault, and a sample OpenWeather call.",
    { ...ScopeSchema },
    withErrorHandling(async ({ tenantId, userId, accountId }) => {
      if (userId && accountId) {
        throw Object.assign(new Error("Provide exactly one of userId or accountId"), { status: 400 });
      }

      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      const [configHealth, vaultHealth, serviceHealth] = await Promise.all([
        configStore.healthcheck(),
        vaultService.healthcheck(),
        serviceClient.healthCheck(scope)
      ]);

      return {
        ok: true,
        status: 200,
        data: { configStore: configHealth, vault: vaultHealth, openWeather: serviceHealth.status, scope }
      };
    })
  );

  server.tool(
    "weather_current",
    "OpenWeather current weather endpoint wrapper.",
    { ...LocationSchema },
    withErrorHandling(async (args) => {
      const scope = normalizeScope(args, scopeDefaults);
      return {
        ok: true,
        status: 200,
        data: await serviceClient.fetchCurrent({ ...args, scope })
      };
    })
  );

  for (const step of ["1min", "15min", "1h", "1day"]) {
    server.tool(
      `weather_timeline_${step}`,
      `OpenWeather timeline ${step} endpoint wrapper.`,
      { ...TimelineSchema },
      withErrorHandling(async (args) => {
        const scope = normalizeScope(args, scopeDefaults);
        return {
          ok: true,
          status: 200,
          data: await serviceClient.fetchTimeline(step, { ...args, scope })
        };
      })
    );
  }

  server.tool(
    "weather_alert_details",
    "OpenWeather alert detail endpoint wrapper by alert id.",
    {
      alertId: z.string().min(1),
      ...ScopeSchema
    },
    withErrorHandling(async ({ alertId, tenantId, userId, accountId }) => {
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      return {
        ok: true,
        status: 200,
        data: await serviceClient.fetchAlert({ alertId, scope })
      };
    })
  );

  server.tool(
    "weather_follow_pagination_url",
    "Follow OpenWeather next/prev timeline pagination URL safely.",
    {
      url: z.string().url(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ url, tenantId, userId, accountId }) => {
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      return {
        ok: true,
        status: 200,
        data: await serviceClient.followPaginationUrl({ url, scope })
      };
    })
  );

  server.tool(
    "weather_config_list",
    "List scoped configuration rows stored in Postgres.",
    {
      prefix: z.string().min(1).optional(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ prefix, tenantId, userId, accountId }) => {
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      return {
        ok: true,
        status: 200,
        data: await configStore.listConfigs(prefix, scope)
      };
    })
  );

  server.tool(
    "weather_config_get",
    "Get one scoped configuration value stored in Postgres.",
    {
      key: z.string().min(1),
      ...ScopeSchema
    },
    withErrorHandling(async ({ key, tenantId, userId, accountId }) => {
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      return {
        ok: true,
        status: 200,
        data: await configStore.getConfig(key, scope)
      };
    })
  );

  server.tool(
    "weather_config_set",
    "Mutating: upsert scoped configuration value in Postgres.",
    {
      key: z.string().min(1),
      value: z.unknown(),
      authorizationKey: z.string().min(1).optional(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ key, value, authorizationKey, tenantId, userId, accountId }) => {
      assertAuthorized(authorizationKey, "weather_config_set");
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      return {
        ok: true,
        status: 200,
        data: await configStore.setConfig(key, value, scope)
      };
    })
  );

  server.tool(
    "weather_config_delete",
    "Mutating: delete scoped configuration key in Postgres.",
    {
      key: z.string().min(1),
      authorizationKey: z.string().min(1).optional(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ key, authorizationKey, tenantId, userId, accountId }) => {
      assertAuthorized(authorizationKey, "weather_config_delete");
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      return {
        ok: true,
        status: 200,
        data: { deleted: await configStore.deleteConfig(key, scope) }
      };
    })
  );

  server.tool(
    "weather_openweather_key_request_create",
    "Mutating: create or refresh a scoped OpenWeather key request workflow record.",
    {
      requester: z.string().min(1).optional(),
      reason: z.string().min(1).optional(),
      authorizationKey: z.string().min(1).optional(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ requester, reason, authorizationKey, tenantId, userId, accountId }) => {
      assertAuthorized(authorizationKey, "weather_openweather_key_request_create");
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      const existing = await configStore.getConfig(OPENWEATHER_KEY_REQUEST_CONFIG_KEY, scope);
      const now = new Date().toISOString();
      const requestRecord = {
        status: "pending",
        provider: "openweather",
        requester: requester ?? null,
        reason: reason ?? null,
        requestedAt: now,
        updatedAt: now,
        previousStatus: existing?.value?.status ?? null,
        urls: {
          signup: "https://home.openweathermap.org/users/sign_up",
          apiKeys: "https://home.openweathermap.org/api_keys",
          pricing: "https://openweathermap.org/price#onecall"
        }
      };

      await configStore.setConfig(OPENWEATHER_KEY_REQUEST_CONFIG_KEY, requestRecord, scope);

      return {
        ok: true,
        status: 200,
        data: {
          scope,
          key: OPENWEATHER_KEY_REQUEST_CONFIG_KEY,
          request: requestRecord,
          nextStep: "Create/retrieve API key from OpenWeather portal, then call weather_api_key_upsert."
        }
      };
    })
  );

  server.tool(
    "weather_openweather_key_request_status",
    "Read-only: get scoped OpenWeather key-request workflow state and key readiness.",
    {
      ...ScopeSchema
    },
    withErrorHandling(async ({ tenantId, userId, accountId }) => {
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      const keyRequest = await configStore.getConfig(OPENWEATHER_KEY_REQUEST_CONFIG_KEY, scope);
      const vaultPath = `${getVaultTenantPrincipalTokenIndexPath(normalizedAppName, scope)}/openweather`;
      const secret = await vaultService.getSecret(vaultPath).catch(() => null);
      const keyConfigured = Boolean(secret?.apiKey);

      return {
        ok: true,
        status: 200,
        data: {
          scope,
          keyConfigured,
          vaultPath,
          request: keyRequest?.value ?? null,
          recommendedNextSteps: keyConfigured
            ? ["Use weather_current or timeline tools with this scope."]
            : [
                "Use weather_openweather_key_request_create to track request workflow.",
                "Obtain key from OpenWeather portal.",
                "Store key with weather_api_key_upsert."
              ]
        }
      };
    })
  );

  server.tool(
    "weather_api_key_status",
    "Check whether a scoped OpenWeather API key exists in Vault.",
    {
      ...ScopeSchema
    },
    withErrorHandling(async ({ tenantId, userId, accountId }) => {
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      const path = `${getVaultTenantPrincipalTokenIndexPath(normalizedAppName, scope)}/openweather`;
      const secret = await vaultService.getSecret(path).catch(() => null);
      return {
        ok: true,
        status: 200,
        data: {
          path,
          configured: Boolean(secret?.apiKey),
          updatedAt: secret?.updatedAt ?? null,
          scope
        }
      };
    })
  );

  server.tool(
    "weather_api_key_upsert",
    "Mutating: upsert scoped OpenWeather API key in Vault.",
    {
      apiKey: z.string().min(1),
      authorizationKey: z.string().min(1).optional(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ apiKey, authorizationKey, tenantId, userId, accountId }) => {
      assertAuthorized(authorizationKey, "weather_api_key_upsert");
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      const path = `${getVaultTenantPrincipalTokenIndexPath(normalizedAppName, scope)}/openweather`;
      await vaultService.setSecret(path, { apiKey, updatedAt: new Date().toISOString() });
      return {
        ok: true,
        status: 200,
        data: {
          path,
          scope,
          stored: true
        }
      };
    })
  );

  server.tool(
    "weather_api_key_delete",
    "Mutating: delete scoped OpenWeather API key in Vault.",
    {
      authorizationKey: z.string().min(1).optional(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ authorizationKey, tenantId, userId, accountId }) => {
      assertAuthorized(authorizationKey, "weather_api_key_delete");
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      const path = `${getVaultTenantPrincipalTokenIndexPath(normalizedAppName, scope)}/openweather`;
      await vaultService.deleteSecret(path);
      return {
        ok: true,
        status: 200,
        data: { path, scope, deleted: true }
      };
    })
  );

  server.tool(
    "weather_http_token_create",
    "Mutating: create scoped bearer token in Vault index for HTTP transport auth.",
    {
      tokenId: z.string().min(1).optional(),
      token: z.string().min(1).optional(),
      scopes: z.array(z.string().min(1)).optional(),
      audience: z.array(z.string().min(1)).optional(),
      expiresAt: z.string().min(1).optional(),
      authorizationKey: z.string().min(1).optional(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ tokenId, token, scopes, audience, expiresAt, authorizationKey, tenantId, userId, accountId }) => {
      assertAuthorized(authorizationKey, "weather_http_token_create");
      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      const indexPath = getVaultTenantPrincipalTokenIndexPath(normalizedAppName, scope);
      const plaintextToken = String(token ?? "").trim() || createBearerToken();
      const expiresAtIso = safeParseExpiresAt(expiresAt);
      const entryBundle = createVaultTokenEntry({
        tenantId: scope.tenantId,
        userId: scope.userId ?? undefined,
        accountId: scope.accountId ?? undefined,
        tokenId,
        token: plaintextToken,
        scopes: scopes && scopes.length > 0 ? scopes : ["mcp:invoke", "mcp:read"],
        audience: audience && audience.length > 0 ? audience : ["codex"],
        expiresAt: expiresAtIso
      });

      const existingPayload = await vaultService.getSecret(indexPath).catch(() => null);
      const merged = mergeVaultTokenIndex(existingPayload, {
        userId: scope.userId ?? undefined,
        accountId: scope.accountId ?? undefined,
        tokenHash: entryBundle.tokenHash,
        entry: entryBundle.entry
      });

      await vaultService.setSecret(indexPath, merged);

      return {
        ok: true,
        status: 200,
        data: {
          indexPath,
          token: plaintextToken,
          tokenHash: entryBundle.tokenHash,
          hash: entryBundle.tokenHash,
          tokenId: entryBundle.entry.tokenId,
          scope,
          scopes: entryBundle.entry.scopes,
          audience: entryBundle.entry.audience,
          expiresAt: entryBundle.entry.expiresAt ?? null
        }
      };
    })
  );

  server.tool(
    "weather_http_token_revoke",
    "Mutating: revoke scoped bearer token entry by plaintext token or token hash.",
    {
      token: z.string().min(1).optional(),
      tokenHash: z.string().min(16).optional(),
      authorizationKey: z.string().min(1).optional(),
      ...ScopeSchema
    },
    withErrorHandling(async ({ token, tokenHash, authorizationKey, tenantId, userId, accountId }) => {
      assertAuthorized(authorizationKey, "weather_http_token_revoke");
      if (!token && !tokenHash) {
        throw Object.assign(new Error("Provide token or tokenHash"), { status: 400 });
      }

      const scope = normalizeScope({ tenantId, userId, accountId }, scopeDefaults);
      const indexPath = getVaultTenantPrincipalTokenIndexPath(normalizedAppName, scope);
      const payload = (await vaultService.getSecret(indexPath).catch(() => null)) ?? {};
      const resolvedTokenHash = String(tokenHash ?? "").trim() || sha256Hex(token);

      if (!payload.tokens || !payload.tokens[resolvedTokenHash]) {
        throw Object.assign(new Error("Token entry not found"), { status: 404 });
      }

      payload.tokens[resolvedTokenHash].active = false;
      payload.tokens[resolvedTokenHash].revokedAt = new Date().toISOString();

      await vaultService.setSecret(indexPath, payload);

      return {
        ok: true,
        status: 200,
        data: {
          indexPath,
          tokenHash: resolvedTokenHash,
          revoked: true,
          scope
        }
      };
    })
  );

  return server;
}
