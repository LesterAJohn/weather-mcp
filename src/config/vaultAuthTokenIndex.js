import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  normalizePrincipalIdForPath,
  normalizePrincipalType,
  normalizeTenantIdForPath,
  resolveTenantPrincipalScope
} from "./scope.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [...fallback];
}

export function normalizeAppName(appName) {
  return String(appName ?? "weather").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "weather";
}

export { normalizeTenantIdForPath, normalizePrincipalIdForPath, resolveTenantPrincipalScope } from "./scope.js";

export function normalizeUserIdForPath(userId) {
  return String(userId ?? "default").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "default";
}

export function getVaultTokenIndexPath(appName) {
  return `${normalizeAppName(appName)}/http/auth/token-index`;
}

export function getVaultUserTokenIndexPath(appName, userId) {
  return `${normalizeAppName(appName)}/users/${normalizeUserIdForPath(userId)}/http/auth/token-index`;
}

export function getVaultTenantPrincipalTokenIndexPath(appName, scope = {}) {
  const resolvedScope = resolveTenantPrincipalScope(scope);
  const principalPathSegment = `${normalizePrincipalType(resolvedScope.principalType)}s`;
  return `${normalizeAppName(appName)}/tenants/${normalizeTenantIdForPath(resolvedScope.tenantId)}/${principalPathSegment}/${normalizePrincipalIdForPath(resolvedScope.principalId)}/http/auth/token-index`;
}

export function getVaultTenantUserTokenIndexPath(appName, tenantId, userId) {
  return getVaultTenantPrincipalTokenIndexPath(appName, { tenantId, userId });
}

export function getVaultTenantAccountTokenIndexPath(appName, tenantId, accountId) {
  return getVaultTenantPrincipalTokenIndexPath(appName, { tenantId, accountId });
}

export function createBearerToken({ byteLength = 32 } = {}) {
  return randomBytes(byteLength).toString("base64url");
}

export function createTokenId() {
  return `tok-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function createVaultTokenEntry({
  tenantId,
  userId,
  accountId,
  tokenId,
  token,
  scopes,
  audience,
  expiresAt,
  tokenType = "bearer"
}) {
  const resolvedScope = resolveTenantPrincipalScope(
    { tenantId, userId, accountId },
    { defaultTenantId: "default", defaultPrincipalType: "user", defaultPrincipalId: "default" }
  );
  const resolvedTokenId = String(tokenId ?? "").trim() || createTokenId();
  const resolvedScopes = normalizeList(scopes, ["mcp:invoke", "mcp:read"]);
  const resolvedAudience = normalizeList(audience, ["codex"]);
  const tokenValue = String(token ?? "").trim();
  const resolvedTokenType = String(tokenType ?? "bearer").trim().toLowerCase() || "bearer";

  if (!tokenValue) {
    throw new Error("Token value is required");
  }

  const entry = {
    tenantId: resolvedScope.tenantId,
    principalType: resolvedScope.principalType,
    principalId: resolvedScope.principalId,
    userId: resolvedScope.userId,
    accountId: resolvedScope.accountId,
    tokenId: resolvedTokenId,
    active: true,
    scopes: resolvedScopes,
    audience: resolvedAudience,
    tokenType: resolvedTokenType,
    createdAt: new Date().toISOString()
  };

  if (expiresAt) {
    entry.expiresAt = String(expiresAt);
  }

  return {
    token: tokenValue,
    tokenHash: sha256Hex(tokenValue),
    entry
  };
}

function mergeTokenMaps(existingMap, tokenHash, entry) {
  const currentMap = isPlainObject(existingMap) ? existingMap : {};
  return {
    ...currentMap,
    [tokenHash]: entry
  };
}

function mergePrincipalTokenEntry(existingPrincipalEntry, tokenHash, entry) {
  const currentPrincipalEntry = isPlainObject(existingPrincipalEntry) ? existingPrincipalEntry : {};
  return {
    ...currentPrincipalEntry,
    tokens: mergeTokenMaps(currentPrincipalEntry.tokens, tokenHash, entry)
  };
}

export function mergeVaultTokenIndex(existingPayload, { userId, accountId, tokenHash, entry }) {
  const resolvedScope = resolveTenantPrincipalScope(
    {
      tenantId: entry.tenantId,
      userId: userId ?? entry.userId,
      accountId: accountId ?? entry.accountId
    },
    {
      defaultTenantId: entry.tenantId ?? "default",
      defaultPrincipalType: entry.principalType ?? "user",
      defaultPrincipalId: entry.principalId ?? entry.userId ?? entry.accountId ?? "default"
    }
  );
  const currentPayload = isPlainObject(existingPayload) ? existingPayload : {};
  const tokens = isPlainObject(currentPayload.tokens) ? currentPayload.tokens : {};
  const users = isPlainObject(currentPayload.users) ? currentPayload.users : {};
  const accounts = isPlainObject(currentPayload.accounts) ? currentPayload.accounts : {};

  if (resolvedScope.principalType === "account") {
    const resolvedAccountId = resolvedScope.accountId ?? resolvedScope.principalId;
    return {
      ...currentPayload,
      defaultTenantId: String(currentPayload.defaultTenantId ?? resolvedScope.tenantId).trim() || resolvedScope.tenantId,
      defaultAccountId: String(currentPayload.defaultAccountId ?? resolvedAccountId).trim() || resolvedAccountId,
      defaultPrincipalType: String(currentPayload.defaultPrincipalType ?? "account").trim() || "account",
      tokens: mergeTokenMaps(tokens, tokenHash, entry),
      users,
      accounts: {
        ...accounts,
        [resolvedAccountId]: mergePrincipalTokenEntry(accounts[resolvedAccountId], tokenHash, entry)
      }
    };
  }

  const resolvedUserId = resolvedScope.userId ?? resolvedScope.principalId;
  return {
    ...currentPayload,
    defaultTenantId: String(currentPayload.defaultTenantId ?? resolvedScope.tenantId).trim() || resolvedScope.tenantId,
    defaultUserId: String(currentPayload.defaultUserId ?? resolvedUserId).trim() || resolvedUserId,
    defaultPrincipalType: String(currentPayload.defaultPrincipalType ?? "user").trim() || "user",
    tokens: mergeTokenMaps(tokens, tokenHash, entry),
    users: {
      ...users,
      [resolvedUserId]: mergePrincipalTokenEntry(users[resolvedUserId], tokenHash, entry)
    },
    accounts
  };
}