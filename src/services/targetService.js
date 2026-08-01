import { OPENWEATHER_ONECALL4_ENDPOINTS } from "./openWeatherEndpoints.js";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_BASE_URL = "https://api.openweathermap.org";

function joinUrl(baseUrl, path, query) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function parseResponseBody(contentType, text) {
  if (!text) {
    return null;
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

function buildError(response, method, path, parsed) {
  const error = new Error(`OpenWeather request failed: ${method} ${path} -> ${response.status}`);
  error.status = response.status;
  error.response = parsed;
  return error;
}

export class TargetServiceClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS, appIdResolver }) {
    this.baseUrl = String(baseUrl ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
    this.timeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;

    if (typeof appIdResolver !== "function") {
      throw new Error("appIdResolver must be a function");
    }

    this.appIdResolver = appIdResolver;
  }

  getConnectionInfo() {
    return {
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      apiKeySource: "vault_or_env_fallback"
    };
  }

  listKnownEndpoints() {
    return OPENWEATHER_ONECALL4_ENDPOINTS.map((entry) => ({
      method: entry.method,
      path: entry.path,
      operationId: entry.operationId,
      summary: entry.summary,
      parameters: entry.parameters,
      tools: entry.tools
    }));
  }

  async request({ method = "GET", path = "/", query, headers = {}, scope }) {
    const upperMethod = String(method).toUpperCase();
    const appid = await this.appIdResolver(scope ?? {});
    if (!appid) {
      const error = new Error("OpenWeather API key is not configured for this tenant/principal scope");
      error.status = 400;
      throw error;
    }

    const url = joinUrl(this.baseUrl, path, { ...query, appid });
    const requestHeaders = {
      Accept: "application/json, text/plain",
      ...headers
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: upperMethod,
        headers: requestHeaders,
        signal: controller.signal
      });

      const text = await response.text();
      const contentType = String(response.headers.get("content-type") ?? "");
      const parsed = parseResponseBody(contentType, text);

      if (!response.ok) {
        throw buildError(response, upperMethod, path, parsed);
      }

      return {
        method: upperMethod,
        path,
        url: url.toString().replace(/appid=[^&]+/, "appid=[REDACTED]"),
        status: response.status,
        contentType,
        data: parsed
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchCurrent({ lat, lon, units, lang, scope }) {
    return this.request({
      method: "GET",
      path: "/data/4.0/onecall/current",
      query: { lat, lon, units, lang },
      scope
    });
  }

  async fetchTimeline(step, { lat, lon, units, lang, start, tz, cnt, scope }) {
    return this.request({
      method: "GET",
      path: `/data/4.0/onecall/timeline/${step}`,
      query: { lat, lon, units, lang, start, tz, cnt },
      scope
    });
  }

  async fetchAlert({ alertId, scope }) {
    return this.request({
      method: "GET",
      path: `/data/4.0/onecall/alert/${encodeURIComponent(String(alertId))}`,
      scope
    });
  }

  async followPaginationUrl({ url, scope }) {
    const parsed = new URL(String(url));
    const expectedOrigin = new URL(this.baseUrl).origin;
    if (parsed.origin !== expectedOrigin) {
      const error = new Error("Pagination URL origin is not allowed");
      error.status = 400;
      throw error;
    }

    return this.request({
      method: "GET",
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams.entries()),
      scope
    });
  }

  async healthCheck(scope = {}) {
    return this.fetchCurrent({ lat: 0, lon: 0, scope });
  }
}
