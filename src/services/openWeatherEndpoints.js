export const OPENWEATHER_ONECALL4_BASE_PATH = "/data/4.0/onecall";

export const OPENWEATHER_ONECALL4_ENDPOINTS = [
  {
    operationId: "onecall_current",
    method: "GET",
    path: `${OPENWEATHER_ONECALL4_BASE_PATH}/current`,
    summary: "Current weather conditions",
    tools: ["weather_current"],
    parameters: {
      required: ["lat", "lon"],
      optional: ["units", "lang"]
    },
    responseShape: {
      topLevel: ["lat", "lon", "timezone", "timezone_offset", "data"],
      dataRecord: "single-object"
    }
  },
  {
    operationId: "onecall_timeline_1min",
    method: "GET",
    path: `${OPENWEATHER_ONECALL4_BASE_PATH}/timeline/1min`,
    summary: "1-minute precipitation timeline",
    tools: ["weather_timeline_1min"],
    parameters: {
      required: ["lat", "lon"],
      optional: ["units", "lang", "start", "tz", "cnt"]
    },
    responseShape: {
      topLevel: ["lat", "lon", "timezone", "timezone_offset", "data", "next", "prev"],
      dataRecord: "array"
    }
  },
  {
    operationId: "onecall_timeline_15min",
    method: "GET",
    path: `${OPENWEATHER_ONECALL4_BASE_PATH}/timeline/15min`,
    summary: "15-minute weather timeline",
    tools: ["weather_timeline_15min"],
    parameters: {
      required: ["lat", "lon"],
      optional: ["units", "lang", "start", "tz", "cnt"]
    },
    responseShape: {
      topLevel: ["lat", "lon", "timezone", "timezone_offset", "data", "next", "prev"],
      dataRecord: "array"
    }
  },
  {
    operationId: "onecall_timeline_1h",
    method: "GET",
    path: `${OPENWEATHER_ONECALL4_BASE_PATH}/timeline/1h`,
    summary: "1-hour weather timeline",
    tools: ["weather_timeline_1h"],
    parameters: {
      required: ["lat", "lon"],
      optional: ["units", "lang", "start", "tz", "cnt"]
    },
    responseShape: {
      topLevel: ["lat", "lon", "timezone", "timezone_offset", "data", "next", "prev"],
      dataRecord: "array"
    }
  },
  {
    operationId: "onecall_timeline_1day",
    method: "GET",
    path: `${OPENWEATHER_ONECALL4_BASE_PATH}/timeline/1day`,
    summary: "1-day weather timeline",
    tools: ["weather_timeline_1day"],
    parameters: {
      required: ["lat", "lon"],
      optional: ["units", "lang", "start", "tz", "cnt"]
    },
    responseShape: {
      topLevel: ["lat", "lon", "timezone", "timezone_offset", "data", "next", "prev"],
      dataRecord: "array"
    }
  },
  {
    operationId: "onecall_alert",
    method: "GET",
    path: `${OPENWEATHER_ONECALL4_BASE_PATH}/alert/{alert_id}`,
    summary: "Weather alert details by alert id",
    tools: ["weather_alert_details"],
    parameters: {
      required: ["alert_id"],
      optional: []
    },
    responseShape: {
      topLevel: ["id", "sender_name", "event", "start", "end", "description"],
      dataRecord: "single-object"
    }
  }
];

export function buildEndpointInventoryArtifact() {
  return {
    generatedAt: new Date().toISOString(),
    product: "OpenWeather One Call API 4.0",
    baseUrl: "https://api.openweathermap.org",
    endpoints: OPENWEATHER_ONECALL4_ENDPOINTS
  };
}
