---
description: "Changelog for pi-deep-research skill"
---

# Changelog

## [0.4.0] - 2026-07-31

### BREAKING CHANGES
- Removed the custom `web_search` and `web_extract` tools from this extension.
  Search and page extraction now use pi's built-in `web_search` and `web_read`
  tools (or configurable alternatives). The extension no longer ships its own
  search/extraction implementation.
- Removed SearXNG and Tavily configuration. The following are no longer used:
  - settings.json key `deepresearch.searxngBaseUrl`
  - environment variables `SEARXNG_BASE_URL` and `TAVILY_API_KEY`
  - the `getSearXngBaseUrl`, `searchSearXNG`, `searchTavily`, `doSearch`,
    `extractContent`, and `batchSearch` helpers
  Configure search backends through pi's built-in `web_search` instead.

### Added
- Configurable tool names via `settings.json` under `deepresearch`:
  - `searchTool` (default: `web_search`) - tool name used for web searches
  - `extractTool` (default: `web_read`) - tool name used for page extraction
  Project-local settings override global.
- On `session_start`, the extension activates the configured tools and warns
  the user (non-blocking) if a configured name is not registered.
- When a configured tool name differs from the default, the extension injects a
  system-prompt note via `before_agent_start` so the LLM substitutes the tool
  name in the research workflow.
- `## Tool Configuration` section in `references/config.md` documenting the
  new keys and the activation/injection behavior.

### Changed
- `SKILL.md` references updated: `web_extract` -> `web_read`; the "Available
  tools" section now states that search/extraction use pi's built-in tools.
- `extension.ts` now imports `SettingsManager` only for the new tool-name
  settings; the SearXNG-specific reader is gone.
- `README.md` Install and Configuration sections rewritten to drop SearXNG/
  Tavily setup and document the new tool-name settings.
- `package.json` keyword `web-search` removed (this package no longer provides
  a search implementation).

### Notes
- `research_checkpoint` is unchanged (pure evaluator, no I/O). It remains
  owned by this extension and is not configurable.

## [0.3.0] - 2026-07-15

### Changed
- Search provider swap: **Brave Search is removed**. SearXNG (self-hosted) is now the primary provider, with Tavily as the fallback. Failover order: SearXNG -> Tavily -> error.
- All SearXNG errors fall through silently to Tavily, matching the prior Tavily->Brave blanket-catch behavior. Note: a permanent SearXNG misconfiguration (e.g. JSON output disabled, returning 403) is masked by this silent fallback - check the instance's `search.formats` if SearXNG results never appear.
- `web_search` `execute` upgraded to the full 5-arg signature `(toolCallId, params, signal, onUpdate, ctx)` so it can read project settings.

### Added
- SearXNG base URL configuration via pi `settings.json`: `deepresearch.searxngBaseUrl` (nested under `deepresearch`, room to grow). Project-local `.pi/settings.json` overrides global.
- `SEARXNG_BASE_URL` environment variable as a fallback when no settings.json key is present.
- `getSearXngBaseUrl(cwd)` helper reads settings per-call via the exported `SettingsManager` (global + project merged for our key) then falls back to the env var. pi's `Settings` type is closed (no custom keys), so the `deepresearch` key is read via a cast.
- `searchSearXNG` provider: `GET {baseUrl}/search?q=...&format=json&pageno=1` with the `PiDeepResearch` User-Agent and the agent abort signal threaded in. Sends only `q` + `format=json` + `pageno=1` (SearXNG cannot limit result count; `search_depth`/`include_domains`/`exclude_domains` remain Tavily-only).
- `## Search Provider Configuration` section in `references/config.md` documenting the settings key, env var, instance requirements, and failover order.

### Removed
- Brave Search support (`BRAVE_API_KEY` no longer has any effect). Existing users should switch to SearXNG or Tavily.

### Notes
- SearXNG's relevance score is not 0-1 normalized, so it is dropped from results (the output formatter's `if (h.score)` guard skips the Relevance line).
- `research_checkpoint` is unchanged.

## [0.2.0] - 2026-07-15

### Fixed
- Extension failed to load under the current pi SDK (`@earendil-works/pi-coding-agent`): corrected import paths `@mariozechner/pi-coding-agent` -> `@earendil-works/pi-coding-agent` and `@sinclair/typebox` -> `typebox`.
- Error signaling was broken: returning `{ isError: true }` is a no-op in the current SDK. `web_search` and `web_extract` now `throw` to signal failures to the LLM (per SDK convention), while agent cancellation (Esc) in `web_extract` returns a normal `"Cancelled"` result instead of being misreported as an error.

### Changed
- Thread the agent `AbortSignal` into `web_search` and `web_extract` fetch calls so Esc cancels in-flight requests. `web_extract` composes the agent signal with a 15s timeout via `AbortSignal.any`.
- Added `details: {}` to `web_search`, `web_extract`, and `research_checkpoint` return values to follow the SDK's tool-result convention (the new `AgentToolResult` type requires it).
- Preserved Tavily -> Brave failover; per-query batch failures stay silent (`allSettled`), matching prior behavior.
- `research_checkpoint` logic is unchanged (pure evaluator, no I/O); only its return shape gained `details`.

### Added
- `devDependencies` for `@earendil-works/pi-coding-agent` and `typebox` so `tsc --noEmit` type-checking works from a clean clone. `dependencies` remains empty to avoid skill-collision on `pi install`.

## [0.1.0] - 2026-03-21

### Added
- Initial release
- `web_search` tool (Tavily primary, Brave fallback, batch parallel)
- `web_extract` tool (full page content extraction)
- `research_checkpoint` tool (code-enforced reflection with CONTINUE/PROCEED verdicts)
- 4-phase research workflow: Plan → Search → Reflect → Report
- Multi-hop reasoning patterns: Entity Expansion, Temporal Progression, Conceptual Deepening, Causal Chain
- Source Triangulation for cross-validation
- Human-in-the-Loop plan approval gate
- `/research` slash command with 4 depth levels (quick, standard, deep, exhaustive)
- Strict English keyword matching for depth selection
- Markdown report output with structured sections
- Writing quality anti-patterns guidance
- Confidence scoring with calibration examples
