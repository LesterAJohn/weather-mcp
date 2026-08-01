function normalizePathSegment(value, fallback) {
  const candidate = String(value ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return candidate || fallback;
}

export function normalizeTenantIdForPath(tenantId) {
  return normalizePathSegment(tenantId, "default");
}

export function normalizePrincipalIdForPath(principalId) {
  return normalizePathSegment(principalId, "default");
}

export function normalizePrincipalType(principalType) {
  const candidate = String(principalType ?? "user").trim().toLowerCase();
  if (candidate === "account") {
    return "account";
  }

  return "user";
}

export function resolveTenantPrincipalScope(
  { tenantId, userId, accountId } = {},
  { defaultTenantId = "default", defaultPrincipalType = "user", defaultPrincipalId = "default" } = {}
) {
  const resolvedTenantId = normalizeTenantIdForPath(tenantId ?? defaultTenantId);
  const hasUserId = userId !== undefined && userId !== null && String(userId).trim() !== "";
  const hasAccountId = accountId !== undefined && accountId !== null && String(accountId).trim() !== "";

  if (hasUserId && hasAccountId) {
    throw new Error("Provide exactly one of userId or accountId");
  }

  if (hasUserId) {
    const resolvedUserId = String(userId).trim();
    return {
      tenantId: resolvedTenantId,
      principalType: "user",
      principalId: resolvedUserId,
      userId: resolvedUserId,
      accountId: null
    };
  }

  if (hasAccountId) {
    const resolvedAccountId = String(accountId).trim();
    return {
      tenantId: resolvedTenantId,
      principalType: "account",
      principalId: resolvedAccountId,
      userId: null,
      accountId: resolvedAccountId
    };
  }

  const resolvedPrincipalType = normalizePrincipalType(defaultPrincipalType);
  const resolvedPrincipalId = normalizePrincipalIdForPath(defaultPrincipalId);

  return resolvedPrincipalType === "account"
    ? {
        tenantId: resolvedTenantId,
        principalType: "account",
        principalId: resolvedPrincipalId,
        userId: null,
        accountId: resolvedPrincipalId
      }
    : {
        tenantId: resolvedTenantId,
        principalType: "user",
        principalId: resolvedPrincipalId,
        userId: resolvedPrincipalId,
        accountId: null
      };
}