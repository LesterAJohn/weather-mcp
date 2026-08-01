import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEndpointInventoryArtifact,
  OPENWEATHER_ONECALL4_ENDPOINTS
} from "../src/services/openWeatherEndpoints.js";

test("OpenWeather endpoint inventory covers all documented One Call 4.0 endpoints", () => {
  const paths = OPENWEATHER_ONECALL4_ENDPOINTS.map((entry) => entry.path);

  assert.equal(OPENWEATHER_ONECALL4_ENDPOINTS.length, 6);
  assert.ok(paths.includes("/data/4.0/onecall/current"));
  assert.ok(paths.includes("/data/4.0/onecall/timeline/1min"));
  assert.ok(paths.includes("/data/4.0/onecall/timeline/15min"));
  assert.ok(paths.includes("/data/4.0/onecall/timeline/1h"));
  assert.ok(paths.includes("/data/4.0/onecall/timeline/1day"));
  assert.ok(paths.includes("/data/4.0/onecall/alert/{alert_id}"));
});

test("inventory artifact contains expected metadata", () => {
  const artifact = buildEndpointInventoryArtifact();

  assert.equal(artifact.product, "OpenWeather One Call API 4.0");
  assert.equal(artifact.baseUrl, "https://api.openweathermap.org");
  assert.equal(Array.isArray(artifact.endpoints), true);
  assert.equal(artifact.endpoints.length, 6);
  assert.equal(typeof artifact.generatedAt, "string");
});
