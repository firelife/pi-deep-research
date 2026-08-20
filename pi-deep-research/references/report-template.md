# Research Report Template

## Output Format

**The final research report MUST be a Markdown file**, saved to the `research/` directory under the current working directory.

**File naming**: `[topic]-research-[YYYYMMDD].md`
- Example: `ai-coding-assistants-research-20260312.md`
- Save to `<cwd>/research/`, or `~/.agent/research/` if no project context

**CRITICAL BOUNDARY**: This is a RESEARCH REPORT ONLY — no implementation. Do not write code, make architectural decisions, or implement findings. The user decides next steps after reading the report.

---

## Report Structure

Adapt section depth based on research depth level (see table at bottom).

```markdown
# [Research Topic Title]

**Date:** YYYY-MM-DD
**Depth:** quick | standard | deep | exhaustive
**Confidence:** XX%
**Sources:** N sources from N search rounds

---

## Executive Summary

2-4 sentences directly answering the core research question.
Lead with the answer, not the process. The reader should understand your conclusion without reading anything else.
State overall confidence level and the most important caveat upfront.

## Key Findings

1. **Finding Title** — One-sentence summary with evidence. [Source](url)
2. **Finding Title** — One-sentence summary with evidence. [Source](url)
3. **Finding Title** — One-sentence summary with evidence. [Source](url)
...

Findings should be ordered by importance, not by search order.
Each finding should be a standalone insight, not a source summary.

## Detailed Analysis

This is the CORE of the report — not a repeat of Key Findings with more words.

### Sub-question 1: [Question]

[Multi-paragraph ANALYSIS — not a list of "Source X says Y" bullets]

Structure each sub-question analysis as:
1. **Opening statement** — your analytical conclusion for this sub-question (1-2 sentences)
2. **Evidence and reasoning** — support the conclusion with specific evidence from multiple sources, explain WHY the evidence supports the conclusion
3. **Nuance and caveats** — what complicates the picture, what the limitations are
4. **Connection to other sub-questions** — how this finding relates to or builds upon other sub-questions

> Key quote or data point — [Source Name](url)

**Cross-reference**: This finding connects to Sub-question N because [explanation].

### Sub-question 2: [Question]

Building on the findings from Sub-question 1, ...

[Analysis continues with explicit connections to previous sub-questions]

## Comparison (if applicable)

| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| Feature 1 | ✅ Supported | ❌ Not available | ⚠️ Partial |
| Feature 2 | ... | ... | ... |
| Pricing   | $X/mo | Free | $Y/mo |

**Analysis of the comparison:**

[2-3 paragraphs explaining what the table reveals — patterns, key differentiators,
 surprises, and what matters most for the user's context. The table is data;
 this narrative is the insight.]

## Contradictions & Debates

Actively identify and analyze disagreements. "No contradictions found" is almost never true
for non-trivial research — look harder.

Types of contradictions to look for:
- Vendor claims vs independent testing/reviews
- Different sources citing different numbers or dates
- Optimistic vs pessimistic assessments of the same technology
- Marketing language vs technical reality

For each contradiction:
- **[Topic]**: Source A ([url]) claims "X", while Source B ([url]) argues "Y".
  **Evidence weight**: [which side has stronger evidence and why]
  **Resolution**: [your assessment — which claim is more likely accurate, or is the truth somewhere in between]

## Uncertainties & Gaps

- ⚠️ **[Topic]**: No reliable data found. Latest source from YYYY.
- ⚠️ **[Topic]**: Only Tier 3-4 sources available — claims not independently verified.
- ⚠️ **[Topic]**: Information may be outdated (pre-YYYY).
- ⚠️ **[Topic]**: All sources originate from the same entity (vendor/PR) — independent verification needed.

## Recommendations

### Primary Recommendation
[Recommendation with clear reasoning tied to specific evidence from findings.
 Not just "use X" but "use X because evidence shows [specific reasons], particularly
 relevant given [user's context]."]

### Alternative
[When to consider this instead — specific different constraints or priorities
 that would change the recommendation]

### Not Recommended
[What to avoid and why — tied to specific evidence, not just opinion]

## Methodology

- **Depth**: [quick|standard|deep|exhaustive]
- **Search rounds**: N rounds, M total queries
- **Final confidence**: XX% (from research_checkpoint)
- **Sub-questions**: N defined, N answered, N partially answered
- **Multi-hop chains used**: [brief description of entity expansions, temporal progressions, etc.]
- **Key challenges**: [brief note on any difficulties encountered]

## Sources

| # | Title | Date | Credibility |
|---|-------|------|:-----------:|
| 1 | [Title](url) | YYYY-MM-DD | ⭐ Tier 1 |
| 2 | [Title](url) | YYYY-MM-DD | 🔵 Tier 2 |
| 3 | [Title](url) | YYYY-MM-DD | 🟡 Tier 3 |
| 4 | [Title](url) | YYYY-MM-DD | 🔴 Tier 4 |
```

---

## Writing Quality Anti-Patterns

These are the patterns that make reports feel shallow. Avoid them:

### ❌ Source-dump style (DON'T)
```
### Sub-question: What is Product X's market position?

- Product X officially states in "Introducing X" that it is "...". [Source](url)
- The official GitHub repo positions it as "...". [Source](url)
- Public timeline: community sources record the first commit date as... [Source](url)
```

### ✅ Analytical style (DO)
```
### Sub-question: What is Product X's market position?

Product X occupies a unique position as the only open-source option in a market
dominated by cloud services. Its self-hosted architecture [Source](url) gives it
a clear differentiation on data sovereignty, which explains why enterprise adoption
has grown 3x since launch [Source](url).

However, this positioning creates a tension: the self-hosting requirement raises
the barrier to entry, which is precisely the gap that cloud derivatives like
Y and Z have rushed to fill (see Sub-question 3). The fact that 5+ companies
launched hosted versions within weeks [Source](url) suggests the core technology
is compelling but the deployment model is a bottleneck.

> "We saw 70% of inquiries asking for a managed version" — [CTO interview](url)

This dynamic — strong technology held back by deployment friction — is the central
theme that connects all the competitive products examined in this report.
```

---

## Section Requirements by Depth

| Section | Quick | Standard | Deep | Exhaustive |
|---------|:-----:|:--------:|:----:|:----------:|
| Executive Summary | ✅ 2 sentences | ✅ 3-4 sentences | ✅ 4+ sentences | ✅ Full paragraph |
| Key Findings | 3-4 items | 4-6 items | 6-8 items | 8+ items |
| Detailed Analysis | ❌ Skip | ✅ 1-2 ¶/question | ✅ 2-3 ¶/question with cross-refs | ✅ Full detail + quotes + cross-refs |
| Comparison | If applicable | If applicable | ✅ Required if comparing + narrative | ✅ Required + narrative analysis |
| Contradictions | ❌ Skip | ⚠️ If found | ✅ Required + resolution | ✅ Required + detailed resolution |
| Uncertainties & Gaps | ❌ Skip | ⚠️ If found | ✅ Required | ✅ Required |
| Recommendations | ❌ Skip | ✅ Primary only | ✅ Primary + Alt | ✅ Full (Primary + Alt + Not Rec) |
| Methodology | ❌ Skip | ✅ Brief | ✅ Detailed | ✅ Full with multi-hop description |
| Sources Table | ✅ Required | ✅ Required | ✅ Required | ✅ Required |

## Quality Requirements

- **Every claim must have a source** — inline `[Source](url)` citation
- **Sources table is non-negotiable** — every referenced URL must appear
- **Confidence levels must be honest** — match the final `research_checkpoint` score
- **Contradictions must be surfaced** — don't silently pick one side
- **Tier 3-4 only claims must be flagged** — mark as unverified in Uncertainties
- **Dates matter** — always note when information was published
- **Facts vs opinions clearly separated** — use "Source claims..." for unverified assertions
- **Sub-questions must cross-reference each other** — required for deep/exhaustive
- **Comparison tables must have narrative analysis** — a table alone is data, not insight
- **Detailed Analysis must contain original analysis** — "Source X says Y" repeated is NOT analysis
