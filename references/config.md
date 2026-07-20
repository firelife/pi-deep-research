# Research Configuration

## Depth Levels

### Quick
```yaml
depth: quick
max_searches: 3
max_sources: 5
confidence_threshold: 60
time_budget: "2 minutes"
strategy: "Direct search → extract → report"
use_cases:
  - Simple factual questions
  - "What is X?" queries
  - Quick verification
```

### Standard (default)
```yaml
depth: standard
max_searches: 6
max_sources: 10
confidence_threshold: 75
time_budget: "5 minutes"
strategy: "Plan → search → reflect → fill gaps → report"
use_cases:
  - Technology comparisons
  - "Should I use X or Y?"
  - Feature investigations
```

### Deep
```yaml
depth: deep
max_searches: 10
max_sources: 15
confidence_threshold: 85
time_budget: "10 minutes"
strategy: "Decompose → parallel search → cross-reference → iterate → comprehensive report"
use_cases:
  - Architecture decisions
  - Competitive analysis
  - Technology evaluations
```

### Exhaustive
```yaml
depth: exhaustive
max_searches: 20
max_sources: 30
confidence_threshold: 95
time_budget: "20 minutes"
strategy: "Full decomposition → systematic search → multi-hop reasoning → verify all claims → detailed report with appendices"
use_cases:
  - Academic literature reviews
  - Comprehensive market research
  - Security audits
  - Due diligence reports
```

## Source Credibility Tiers

```yaml
tier_1_authoritative:
  weight: 1.0
  examples:
    - Official documentation
    - Peer-reviewed papers (arXiv, ACM, IEEE)
    - Official announcements / press releases
    - Government / regulatory sources

tier_2_reliable:
  weight: 0.8
  examples:
    - Established tech blogs (InfoQ, The Verge, Ars Technica)
    - Developer blogs from known engineers
    - Conference talks / proceedings
    - Well-maintained GitHub repos (>1k stars)

tier_3_community:
  weight: 0.5
  examples:
    - Stack Overflow answers (high vote count)
    - Reddit discussions (verified claims only)
    - Medium / Dev.to articles
    - Forum posts

tier_4_unverified:
  weight: 0.2
  examples:
    - Anonymous blog posts
    - Social media posts (unverified accounts)
    - SEO-optimized content farms
    - Undated or unsigned content
```

## Confidence Scoring

For each sub-question, track confidence:

```
confidence = (source_count_weight × 0.3) + (source_quality_weight × 0.4) + (consistency_weight × 0.3)

source_count_weight:
  1 source  → 0.3
  2 sources → 0.6
  3+ sources → 1.0

source_quality_weight:
  tier_1 only → 1.0
  tier_1 + tier_2 → 0.85
  tier_2 only → 0.7
  tier_3+ only → 0.4

consistency_weight:
  all sources agree → 1.0
  minor differences → 0.7
  contradictions → 0.3
```

## Search Provider Configuration

The `web_search` tool uses SearXNG as the primary provider and Tavily as the
fallback. At least one must be configured.

### SearXNG (primary)

Self-hosted metasearch engine. Free, unlimited, and privacy-respecting.

Configure the instance base URL in pi's `settings.json` (global or
project-local `.pi/settings.json`):

```json
{
  "deepresearch": {
    "searxngBaseUrl": "http://localhost:8080"
  }
}
```

Project-local settings override global. As a fallback, set the
`SEARXNG_BASE_URL` environment variable.

**Requirements for the SearXNG instance:**
- The base URL must **not** include the `/search` path (the tool appends it).
  Trailing slashes are stripped. Example: `http://localhost:8080`.
- JSON output must be enabled in the instance's `settings.yml`:
  ```yaml
  search:
    formats: [html, json]
  ```
  Without it the API returns 403 and the tool silently falls back to Tavily.

The tool sends only `q`, `format=json`, and `pageno=1`. SearXNG's relevance
score is not 0-1 normalized, so it is omitted from results (the Relevance line
is skipped).

### Tavily (fallback)

Set the `TAVILY_API_KEY` environment variable. Free tier: 1000 requests/month.
Get a key at https://tavily.com.

### Failover order

1. SearXNG (if `deepresearch.searxngBaseUrl` or `SEARXNG_BASE_URL` is set)
2. Tavily (if `TAVILY_API_KEY` is set)
3. Error: no provider configured

All SearXNG errors (network, timeout, 403, etc.) fall through silently to
Tavily. Note that a permanent misconfiguration (e.g. JSON output disabled) is
masked by this silent fallback - check the instance settings if SearXNG results
never appear.
