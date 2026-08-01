# Weather MCP Agent Notes

This directory contains weather-mcp onboarding and planning material.

Design assumptions:
- The MCP wraps OpenWeather One Call API 4.0.
- Vault stores secrets only.
- Postgres stores configuration only.
- Scope is tenant/principal (`user` or `account`).

Use `agent/playbooks/service-onboarding.md` to onboard new weather features.
