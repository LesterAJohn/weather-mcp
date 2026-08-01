import assert from "node:assert/strict";
import test from "node:test";

import {
  createBearerToken,
  createVaultTokenEntry,
  getVaultTokenIndexPath,
  getVaultTenantAccountTokenIndexPath,
  getVaultTenantPrincipalTokenIndexPath,
  getVaultTenantUserTokenIndexPath,
  mergeVaultTokenIndex,
  normalizeAppName,
  sha256Hex
} from "../src/config/vaultAuthTokenIndex.js";

test("normalizeAppName and token path derive from app name", () => {
  assert.equal(normalizeAppName("Skeleton MCP"), "skeleton-mcp");
  assert.equal(getVaultTokenIndexPath("Skeleton"), "skeleton/http/auth/token-index");
  assert.equal(
    getVaultTenantUserTokenIndexPath("Skeleton", "Tenant-A", "User-123"),
    "skeleton/tenants/tenant-a/users/user-123/http/auth/token-index"
  );
  assert.equal(
    getVaultTenantAccountTokenIndexPath("Skeleton", "Tenant-A", "Account-123"),
    "skeleton/tenants/tenant-a/accounts/account-123/http/auth/token-index"
  );
  assert.equal(
    getVaultTenantPrincipalTokenIndexPath("Skeleton", {
      tenantId: "Tenant-A",
      accountId: "Account-123"
    }),
    "skeleton/tenants/tenant-a/accounts/account-123/http/auth/token-index"
  );
});

test("createVaultTokenEntry builds bearer token metadata", () => {
  const token = "opaque-bearer-token";
  const { tokenHash, entry } = createVaultTokenEntry({
    tenantId: "tenant-a",
    userId: "default",
    tokenId: "tok-123",
    token,
    scopes: ["mcp:invoke", "mcp:read"],
    audience: "codex"
  });

  assert.equal(tokenHash, sha256Hex(token));
  assert.equal(entry.tenantId, "tenant-a");
  assert.equal(entry.userId, "default");
  assert.equal(entry.tokenId, "tok-123");
  assert.equal(entry.tokenType, "bearer");
  assert.deepEqual(entry.scopes, ["mcp:invoke", "mcp:read"]);
  assert.deepEqual(entry.audience, ["codex"]);
  assert.equal(typeof entry.createdAt, "string");
});

test("createVaultTokenEntry supports oauth2 token metadata", () => {
  const token = "opaque-oauth-token";
  const { entry } = createVaultTokenEntry({
    tenantId: "tenant-a",
    accountId: "account-1",
    tokenId: "tok-oauth",
    token,
    scopes: "openid profile",
    audience: "my-app",
    tokenType: "oauth2"
  });

  assert.equal(entry.tokenType, "oauth2");
  assert.equal(entry.tokenId, "tok-oauth");
  assert.equal(entry.principalType, "account");
  assert.equal(entry.accountId, "account-1");
  assert.deepEqual(entry.scopes, ["openid", "profile"]);
  assert.deepEqual(entry.audience, ["my-app"]);
});

test("mergeVaultTokenIndex keeps users and top-level token maps aligned", () => {
  const token = "opaque-bearer-token-2";
  const { tokenHash, entry } = createVaultTokenEntry({
    tenantId: "tenant-a",
    userId: "user-a",
    tokenId: "tok-a",
    token,
    scopes: "mcp:invoke mcp:read",
    audience: ["codex", "claude"]
  });

  const merged = mergeVaultTokenIndex(
    {
      users: {
        existing: {
          tokens: {
            keep: { active: true }
          },
          note: "preserve-me"
        }
      },
      tokens: {
        keep: { active: true }
      }
    },
    { userId: "user-a", tokenHash, entry }
  );

  assert.equal(merged.defaultUserId, "user-a");
  assert.equal(merged.users.existing.note, "preserve-me");
  assert.equal(merged.users["user-a"].tokens[tokenHash].tokenId, "tok-a");
  assert.equal(merged.tokens[tokenHash].tokenId, "tok-a");
  assert.equal(merged.tokens.keep.active, true);
});

test("mergeVaultTokenIndex stores account-scoped tokens separately", () => {
  const token = "opaque-account-token";
  const { tokenHash, entry } = createVaultTokenEntry({
    tenantId: "tenant-a",
    accountId: "account-1",
    tokenId: "tok-account",
    token,
    scopes: "mcp:invoke",
    audience: ["codex"]
  });

  const merged = mergeVaultTokenIndex({}, { accountId: "account-1", tokenHash, entry });

  assert.equal(merged.defaultAccountId, "account-1");
  assert.equal(merged.accounts["account-1"].tokens[tokenHash].tokenId, "tok-account");
  assert.equal(merged.tokens[tokenHash].tokenId, "tok-account");
});

test("createBearerToken returns a usable opaque token", () => {
  const token = createBearerToken();
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 32);
});