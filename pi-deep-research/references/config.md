# Research Configuration

> **Single source of truth for thresholds**: the numeric values below MUST match
> the `DEPTH_THRESHOLDS` constant in `extension.ts`. If you change one, change
> both. Field names here mirror the code (`minSearchRounds`, `maxSearchRounds`,
> `minSources`, `confidenceThreshold`, `minAnsweredRatio`) so they can be
> compared at a glance.

## Depth Levels

### Quick
```yaml
depth: quick
minSearchRounds: 1
maxSearchRounds: 3
minSources: 3
confidenceThreshold: 60
minAnsweredRatio: 0.6
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
minSearchRounds: 2
maxSearchRounds: 6
minSources: 5
confidenceThreshold: 75
minAnsweredRatio: 0.7
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
minSearchRounds: 3
maxSearchRounds: 10
minSources: 10
confidenceThreshold: 85
minAnsweredRatio: 0.8
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
minSearchRounds: 5
maxSearchRounds: 20
minSources: 15
confidenceThreshold: 95
minAnsweredRatio: 0.9
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

## Tool Configuration

Search and page extraction use pi's built-in `web_search` and `web_read`
tools by default. The tool names can be overridden in pi's `settings.json`
(global or project-local `.pi/settings.json`) under the `deepresearch` key:

```json
{
  "deepresearch": {
    "searchTool": "web_search",
    "extractTool": "web_read"
  }
}
```

- `searchTool` - tool name used for web searches (default: `web_search`)
- `extractTool` - tool name used for page content extraction (default: `web_read`)

Project-local settings override global. When a configured name differs from
the default, the extension injects a system-prompt note each turn instructing
the LLM to substitute the tool name in the research workflow.

The extension validates the configured names on session start: if a tool is
not registered (e.g. a custom search tool was not installed), it warns the
user and research falls back to the built-in tools. Only already-registered
tool names take effect; unknown names are ignored.

**Note:** `research_checkpoint` (the reflection gate in Phase 3) is owned by
this extension and is not configurable.
