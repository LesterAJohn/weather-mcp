import assert from "node:assert/strict";
import test from "node:test";

import { createHttpMcpServer } from "../src/http/server.js";
import { createMcpServer } from "../src/mcp/server.js";

function createServiceClientMock() {
  return {
    getConnectionInfo() {
      return { baseUrl: "https://api.openweathermap.org", timeoutMs: 1000, apiKeySource: "vault_or_env_fallback" };
    },
    listKnownEndpoints() {
      return [];
    },
    async healthCheck() {
      return { status: 200, data: null };
    },
    async fetchCurrent(payload) {
      return { status: 200, data: null, payload };
    },
    async fetchTimeline(step, payload) {
      return { status: 200, data: [{ step }], payload };
    },
    async fetchAlert(payload) {
      return { status: 200, data: payload };
    },
    async followPaginationUrl({ url }) {
      return { status: 200, data: { followed: url } };
    }
  };
}

function createTestServer() {
  const serviceClient = createServiceClientMock();
  return createHttpMcpServer({
    host: "127.0.0.1",
    port: 0,
    mcpPath: "/mcp",
    healthPath: "/healthz",
    authTokens: ["test-token"],
    trustedProxy: false,
    allowedOrigins: [],
    allowedIps: [],
    maxBodyBytes: 1024 * 1024,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 60,
    createMcpServer: () =>
      createMcpServer({
        name: "weather-mcp",
        version: "0.1.0",
        serviceClient,
        configStore: {
          async healthcheck() {
            return { ok: true };
          },
          async listConfigs() {
            return [];
          },
          async getConfig() {
            return null;
          },
          async setConfig(key, value) {
            return { key, value };
          },
          async deleteConfig() {
            return true;
          }
        },
        vaultService: {
          async healthcheck() {
            return { ok: true };
          },
          async getSecret() {
            return { apiKey: "test" };
          },
          async setSecret() {
            return { ok: true };
          },
          async deleteSecret() {
            return { ok: true };
          }
        },
        appName: "weather",
        scopeDefaults: {
          tenantId: "default",
          principalType: "user",
          principalId: "default"
        }
      })
  });
}

function initializeRequestPayload() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0"
      }
    }
  };
}

test("unauthorized HTTP request is rejected", async () => {
  const server = createTestServer();
  await server.start();

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(initializeRequestPayload())
    });

    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test("authorized HTTP MCP initialize call succeeds", async () => {
  const server = createTestServer();
  await server.start();

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-token"
      },
      body: JSON.stringify(initializeRequestPayload())
    });

    assert.equal(response.status, 200);
  } finally {
    await server.close();
  }
});

test("health endpoint reports HTTP MCP status", async () => {
  const server = createTestServer();
  await server.start();

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 200);
    assert.equal(payload.transport, "http");
    assert.equal(payload.path, "/mcp");
  } finally {
    await server.close();
  }
});
