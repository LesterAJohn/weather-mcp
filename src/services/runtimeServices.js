import { ConfigStore } from "./configStore.js";
import { VaultService } from "./vault.js";
import { TargetServiceClient } from "./targetService.js";
import {
  getVaultTenantPrincipalTokenIndexPath,
  normalizeAppName,
  resolveTenantPrincipalScope
} from "../config/vaultAuthTokenIndex.js";

function parseMaybeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createRuntimeServices(env) {
  const appName = normalizeAppName(env.appName);

  const configStore = new ConfigStore(env.postgres, {
    appName,
    defaultTenantId: env.scopeDefaults.tenantId,
    defaultPrincipalType: env.scopeDefaults.principalType,
    defaultPrincipalId: env.scopeDefaults.principalId
  });

  const vaultService = new VaultService({
    endpoint: env.vault.addr,
    token: env.vault.token,
    agentEnabled: env.vault.agentEnabled,
    agentAuthMode: env.vault.agentAuthMode,
    agentTokenFilePath: env.vault.agentTokenFilePath,
    agentListenerEnabled: env.vault.agentListenerEnabled,
    agentListenerAddr: env.vault.agentListenerAddr,
    kvMount: env.vault.kvMount,
    writeRetryAttempts: env.vault.writeRetryAttempts,
    writeRetryBaseDelayMs: env.vault.writeRetryBaseDelayMs,
    writeRetryMaxDelayMs: env.vault.writeRetryMaxDelayMs
  });

  async function resolveApiKey(scope = {}) {
    const resolvedScope = resolveTenantPrincipalScope(scope, {
      defaultTenantId: env.scopeDefaults.tenantId,
      defaultPrincipalType: env.scopeDefaults.principalType,
      defaultPrincipalId: env.scopeDefaults.principalId
    });

    const indexPath = getVaultTenantPrincipalTokenIndexPath(appName, resolvedScope);
    const keyPath = `${indexPath}/openweather`;
    const secret = await vaultService.getSecret(keyPath).catch(() => null);
    const scopedKey = String(secret?.apiKey ?? "").trim();
    if (scopedKey) {
      return scopedKey;
    }

    return String(env.openWeather.apiKey ?? "").trim();
  }

  const serviceClient = new TargetServiceClient({
    baseUrl: env.openWeather.baseUrl,
    timeoutMs: env.openWeather.timeoutMs,
    appIdResolver: resolveApiKey
  });

  return {
    appName,
    configStore,
    vaultService,
    serviceClient,
    resolveScope(input = {}) {
      return resolveTenantPrincipalScope(input, {
        defaultTenantId: env.scopeDefaults.tenantId,
        defaultPrincipalType: env.scopeDefaults.principalType,
        defaultPrincipalId: env.scopeDefaults.principalId
      });
    },
    getTokenIndexPathForScope(scope = {}) {
      return getVaultTenantPrincipalTokenIndexPath(appName, scope);
    },
    getApiKeyVaultPath(scope = {}) {
      return `${getVaultTenantPrincipalTokenIndexPath(appName, scope)}/openweather`;
    },
    getDefaultToolWeatherOptions() {
      return {
        units: env.openWeather.defaultUnits,
        lang: env.openWeather.defaultLang,
        cnt: parseMaybeNumber(env.openWeather.defaultCnt, undefined)
      };
    }
  };
}
