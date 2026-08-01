import pg from "pg";
import { resolveTenantPrincipalScope } from "../config/scope.js";

const { Pool } = pg;

function normalizeIdentifier(value, fallback) {
  const candidate = String(value ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!candidate || !/^[a-z][a-z0-9_]*$/.test(candidate)) {
    throw new Error(`Invalid Postgres table name: ${value}`);
  }

  return candidate;
}

function normalizeAppName(value, fallback = "weather") {
  const candidate = String(value ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  if (!candidate || !/^[a-z][a-z0-9_]*$/.test(candidate)) {
    return fallback;
  }

  return candidate;
}

export class ConfigStore {
  constructor(postgresConfig, options = {}) {
    this.pool = new Pool(postgresConfig);
    this.appName = normalizeAppName(options.appName ?? process.env.APP_NAME, "weather");
    this.defaultTenantId = String(options.defaultTenantId ?? process.env.MCP_CONFIG_DEFAULT_TENANT_ID ?? "default").trim() || "default";
    this.defaultPrincipalType = String(
      options.defaultPrincipalType ?? process.env.MCP_CONFIG_DEFAULT_PRINCIPAL_TYPE ?? "user"
    )
      .trim()
      .toLowerCase() === "account"
      ? "account"
      : "user";
    this.defaultPrincipalId = String(
      options.defaultPrincipalId ??
        process.env.MCP_CONFIG_DEFAULT_ACCOUNT_ID ??
        process.env.MCP_CONFIG_DEFAULT_USER_ID ??
        "default"
    ).trim() || "default";
    this.defaultUserId = this.defaultPrincipalType === "user" ? this.defaultPrincipalId : "default";
    this.defaultAccountId = this.defaultPrincipalType === "account" ? this.defaultPrincipalId : "";
    this.tableName = normalizeIdentifier(options.tableName ?? `${this.appName}_config`, `${this.appName}_config`);
    this.defaultScope = resolveTenantPrincipalScope(
      {
        tenantId: this.defaultTenantId,
        userId: this.defaultUserId,
        accountId: this.defaultAccountId
      },
      {
        defaultTenantId: this.defaultTenantId,
        defaultPrincipalType: this.defaultPrincipalType,
        defaultPrincipalId: this.defaultPrincipalId
      }
    );
  }

  normalizeScope(scope = {}) {
    return resolveTenantPrincipalScope(scope, {
      defaultTenantId: this.defaultTenantId,
      defaultPrincipalType: this.defaultPrincipalType,
      defaultPrincipalId: this.defaultPrincipalId
    });
  }

  async healthcheck() {
    await this.pool.query("SELECT 1");
    return { ok: true };
  }

  async listConfigs(prefix, scope) {
    const effectiveScope = this.normalizeScope(scope);
    const hasPrefix = Boolean(prefix && prefix.trim());
    const result = hasPrefix
      ? await this.pool.query(
          `SELECT tenant_id, principal_type, principal_id, key, value, updated_at FROM ${this.tableName} WHERE tenant_id = $1 AND principal_type = $2 AND principal_id = $3 AND key ILIKE $4 ORDER BY key ASC`,
          [effectiveScope.tenantId, effectiveScope.principalType, effectiveScope.principalId, `${prefix}%`]
        )
      : await this.pool.query(
          `SELECT tenant_id, principal_type, principal_id, key, value, updated_at FROM ${this.tableName} WHERE tenant_id = $1 AND principal_type = $2 AND principal_id = $3 ORDER BY key ASC`,
          [effectiveScope.tenantId, effectiveScope.principalType, effectiveScope.principalId]
        );

    return result.rows;
  }

  async getConfig(key, scope) {
    const effectiveScope = this.normalizeScope(scope);
    const result = await this.pool.query(
      `SELECT tenant_id, principal_type, principal_id, key, value, updated_at FROM ${this.tableName} WHERE tenant_id = $1 AND principal_type = $2 AND principal_id = $3 AND key = $4`,
      [effectiveScope.tenantId, effectiveScope.principalType, effectiveScope.principalId, key]
    );

    return result.rows[0] ?? null;
  }

  async setConfig(key, value, scope) {
    const effectiveScope = this.normalizeScope(scope);
    const result = await this.pool.query(
      `
      INSERT INTO ${this.tableName} (tenant_id, principal_type, principal_id, key, value, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
      ON CONFLICT (tenant_id, principal_type, principal_id, key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      RETURNING tenant_id, principal_type, principal_id, key, value, updated_at
      `,
      [effectiveScope.tenantId, effectiveScope.principalType, effectiveScope.principalId, key, JSON.stringify(value)]
    );

    return result.rows[0];
  }

  async deleteConfig(key, scope) {
    const effectiveScope = this.normalizeScope(scope);
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE tenant_id = $1 AND principal_type = $2 AND principal_id = $3 AND key = $4`,
      [effectiveScope.tenantId, effectiveScope.principalType, effectiveScope.principalId, key]
    );
    return result.rowCount > 0;
  }

  async getTokenRotationIntervalMs({ tenantId, userId, accountId, userIntervalConfigKey, defaultIntervalMs }) {
    const effectiveScope = this.normalizeScope({ tenantId, userId, accountId });
    const scopedConfig = await this.getConfig(userIntervalConfigKey, effectiveScope);
    const scopedValue = Number(scopedConfig?.value);
    if (Number.isFinite(scopedValue) && scopedValue > 0) {
      return {
        intervalMs: scopedValue,
        source: "scope",
        tenantId: effectiveScope.tenantId,
        principalType: effectiveScope.principalType,
        principalId: effectiveScope.principalId,
        userId: effectiveScope.userId,
        accountId: effectiveScope.accountId,
        key: userIntervalConfigKey
      };
    }

    const defaultScopedConfig = await this.getConfig(userIntervalConfigKey, this.defaultScope);
    const defaultScopedValue = Number(defaultScopedConfig?.value);
    if (Number.isFinite(defaultScopedValue) && defaultScopedValue > 0) {
      return {
        intervalMs: defaultScopedValue,
        source: "default-scope",
        tenantId: this.defaultScope.tenantId,
        principalType: this.defaultScope.principalType,
        principalId: this.defaultScope.principalId,
        userId: this.defaultScope.userId,
        accountId: this.defaultScope.accountId,
        key: userIntervalConfigKey
      };
    }

    return {
      intervalMs: defaultIntervalMs,
      source: "env-default",
      tenantId: this.defaultScope.tenantId,
      principalType: this.defaultScope.principalType,
      principalId: this.defaultScope.principalId,
      userId: this.defaultScope.userId,
      accountId: this.defaultScope.accountId,
      key: userIntervalConfigKey
    };
  }

  async close() {
    await this.pool.end();
  }
}
