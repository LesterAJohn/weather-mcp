import assert from "node:assert/strict";
import test from "node:test";

import { createMcpServer } from "../src/mcp/server.js";

function setEnv(updates) {
  const previous = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function createServiceClientMock() {
  const calls = {
    current: 0,
    timeline: 0,
    alert: 0
  };

  const client = {
    getConnectionInfo() {
      return { baseUrl: "https://api.openweathermap.org", timeoutMs: 1000, apiKeySource: "vault_or_env_fallback" };
    },
    listKnownEndpoints() {
      return [{ method: "GET", path: "/data/4.0/onecall/current" }];
    },
    async healthCheck() {
      return { status: 200, data: { ok: true } };
    },
    async fetchCurrent(payload) {
      calls.current += 1;
      return { status: 200, data: { type: "current" }, payload };
    },
    async fetchTimeline(step, payload) {
      calls.timeline += 1;
      return { status: 200, data: [{ step }], payload };
    },
    async fetchAlert(payload) {
      calls.alert += 1;
      return { status: 200, data: { id: payload.alertId } };
    },
    async followPaginationUrl({ url }) {
      return { status: 200, data: { followed: true, url } };
    }
  };

  return { client, calls };
}

function createConfigStoreMock() {
  return {
    async healthcheck() {
      return { ok: true };
    },
    async listConfigs() {
      return [{ key: "weather.defaults.units", value: "metric" }];
    },
    async getConfig(key) {
      return { key, value: "metric" };
    },
    async setConfig(key, value) {
      return { key, value };
    },
    async deleteConfig() {
      return true;
    }
  };
}

function createVaultServiceMock() {
  const store = new Map();
  return {
    async healthcheck() {
      return { ok: true };
    },
    async getSecret(path) {
      return store.get(path) ?? null;
    },
    async setSecret(path, value) {
      store.set(path, value);
      return { ok: true };
    },
    async deleteSecret(path) {
      store.delete(path);
      return { ok: true };
    }
  };
}

async function invokeTool(server, name, args = {}) {
  const registeredTools = server._registeredTools;
  assert.ok(registeredTools[name], `Expected tool ${name} to be registered`);
  const result = await registeredTools[name].handler(args);
  const payload = JSON.parse(result.content[0].text);
  return { result, payload };
}

function createServer() {
  const { client, calls } = createServiceClientMock();
  const configStore = createConfigStoreMock();
  const vaultService = createVaultServiceMock();

  const server = createMcpServer({
    name: "weather-mcp",
    version: "0.1.0",
    serviceClient: client,
    configStore,
    vaultService,
    appName: "weather",
    scopeDefaults: {
      tenantId: "default",
      principalType: "user",
      principalId: "default"
    }
  });

  return { server, calls, vaultService };
}

test("weather_current returns success payload", async () => {
  const restoreEnv = setEnv({ MCP_ADMIN_AUTH_KEY: "" });

  try {
    const { server, calls } = createServer();
    const { payload } = await invokeTool(server, "weather_current", {
      lat: 40.7,
      lon: -74,
      tenantId: "acme",
      userId: "sam"
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 200);
    assert.equal(payload.data.status, 200);
    assert.equal(calls.current, 1);
  } finally {
    restoreEnv();
  }
});

test("mutating weather tools require authorizationKey when admin key is configured", async () => {
  const restoreEnv = setEnv({ MCP_ADMIN_AUTH_KEY: "super-secret" });

  try {
    const { server } = createServer();

    const unauthorized = await invokeTool(server, "weather_api_key_upsert", {
      tenantId: "acme",
      userId: "sam",
      apiKey: "abc123"
    });
    assert.equal(unauthorized.result.isError, true);
    assert.equal(unauthorized.payload.status, 401);

    const authorized = await invokeTool(server, "weather_api_key_upsert", {
      tenantId: "acme",
      userId: "sam",
      apiKey: "abc123",
      authorizationKey: "super-secret"
    });

    assert.equal(authorized.payload.ok, true);
    assert.equal(authorized.payload.data.stored, true);
  } finally {
    restoreEnv();
  }
});

test("weather_query_suggestion returns endpoint inventory and suggestions", async () => {
  const restoreEnv = setEnv({ MCP_ADMIN_AUTH_KEY: "" });

  try {
    const { server } = createServer();
    const { payload } = await invokeTool(server, "weather_query_suggestion", {
      intent: "hourly forecast then inspect alerts"
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 200);
    assert.equal(Array.isArray(payload.data.recommendedOrder), true);
    assert.equal(Array.isArray(payload.data.endpointInventory.endpoints), true);
    assert.ok(payload.data.endpointInventory.endpoints.length >= 6);
    assert.equal(Array.isArray(payload.data.toolSchemas), true);
  } finally {
    restoreEnv();
  }
});

test("weather_http_token_create and revoke mutate token index", async () => {
  const restoreEnv = setEnv({ MCP_ADMIN_AUTH_KEY: "super-secret" });

  try {
    const { server } = createServer();
    const created = await invokeTool(server, "weather_http_token_create", {
      tenantId: "acme",
      accountId: "ops",
      authorizationKey: "super-secret",
      scopes: ["mcp:invoke"],
      audience: ["codex"]
    });

    assert.equal(created.payload.ok, true);
    assert.equal(typeof created.payload.data.token, "string");

    const revoked = await invokeTool(server, "weather_http_token_revoke", {
      tenantId: "acme",
      accountId: "ops",
      authorizationKey: "super-secret",
      tokenHash: created.payload.data.hash
    });

    assert.equal(revoked.payload.ok, true);
    assert.equal(revoked.payload.data.revoked, true);
  } finally {
    restoreEnv();
  }
});
