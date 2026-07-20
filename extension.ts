/**
 * Deep Research Extension - web_search + web_extract tools
 *
 * Provides LLM-callable tools for internet search and content extraction.
 * Supports SearXNG (primary, self-hosted) and Tavily API (fallback).
 *
 * Configuration:
 *   SearXNG base URL - settings.json `deepresearch.searxngBaseUrl`
 *                     (or SEARXNG_BASE_URL env var as fallback)
 *   TAVILY_API_KEY   - Tavily API key (free tier: 1000 req/month)
 */

import { SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ─── Types ───

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	score?: number;
	publishedDate?: string;
}

interface ExtractResult {
	title: string;
	url: string;
	content: string;
	author?: string;
	publishedDate?: string;
	wordCount: number;
}

// ─── SearXNG Configuration ───

/**
 * Resolve the SearXNG base URL from pi settings.json (`deepresearch.searxngBaseUrl`)
 * or the SEARXNG_BASE_URL env var. Project-local settings override global; env is the
 * last resort. Returns undefined if SearXNG is not configured.
 *
 * Reads settings per-call via SettingsManager. pi's Settings type is closed (no
 * custom keys), so the deepresearch key is read via a cast.
 */
function getSearXngBaseUrl(cwd: string): string | undefined {
	type DeepResearchSettings = { deepresearch?: { searxngBaseUrl?: string } };
	try {
		const sm = SettingsManager.create(cwd);
		const global = sm.getGlobalSettings() as unknown as DeepResearchSettings;
		const project = sm.getProjectSettings() as unknown as DeepResearchSettings;
		return project.deepresearch?.searxngBaseUrl ?? global.deepresearch?.searxngBaseUrl ?? process.env.SEARXNG_BASE_URL;
	} catch {
		// Settings file unreadable/invalid - fall back to env var.
		return process.env.SEARXNG_BASE_URL;
	}
}

// ─── Search Providers ───

async function searchTavily(query: string, opts: { maxResults: number; searchDepth: string; includeDomains?: string[]; excludeDomains?: string[]; signal?: AbortSignal; }): Promise<SearchResult[]> {
	const apiKey = process.env.TAVILY_API_KEY;
	if (!apiKey) throw new Error("TAVILY_API_KEY not set");

	const body: Record<string, unknown> = {
		query,
		max_results: opts.maxResults,
		search_depth: opts.searchDepth,
		include_answer: false,
	};
	if (opts.includeDomains?.length) body.include_domains = opts.includeDomains;
	if (opts.excludeDomains?.length) body.exclude_domains = opts.excludeDomains;

	const resp = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify(body),
		signal: opts.signal,
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Tavily API error ${resp.status}: ${text}`);
	}

	const data = (await resp.json()) as { results: Array<{ title: string; url: string; content: string; score: number; published_date?: string }> };
	return data.results.map((r) => ({
		title: r.title,
		url: r.url,
		snippet: r.content,
		score: r.score,
		publishedDate: r.published_date,
	}));
}

async function searchSearXNG(query: string, opts: { baseUrl: string; signal?: AbortSignal; }): Promise<SearchResult[]> {
	// Strip trailing slash(es); caller provides a base URL without the /search path.
	const base = opts.baseUrl.replace(/\/+$/, "");
	const params = new URLSearchParams({ q: query, format: "json", pageno: "1" });
	const resp = await fetch(`${base}/search?${params}`, {
		headers: {
			Accept: "application/json",
			"User-Agent": "Mozilla/5.0 (compatible; PiDeepResearch/1.0)",
		},
		signal: opts.signal,
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`SearXNG API error ${resp.status}: ${text}`);
	}

	const data = (await resp.json()) as {
		results?: Array<{ title?: string; url?: string; content?: string; publishedDate?: string | null }>;
	};
	// SearXNG score is not 0-1 normalized, so it is dropped (the output formatter
	// guards on `if (h.score)` and skips the Relevance line when absent).
	return (data.results ?? []).map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: r.content ?? "",
		publishedDate: r.publishedDate ?? undefined,
	}));
}

async function doSearch(query: string, opts: { maxResults: number; searchDepth: string; includeDomains?: string[]; excludeDomains?: string[]; signal?: AbortSignal; searxngBaseUrl?: string; }): Promise<{ provider: string; results: SearchResult[] }> {
	// Try SearXNG first (primary), then Tavily (fallback).
	// All SearXNG errors fall through silently to Tavily - matches the prior
	// Tavily->Brave blanket-catch behavior. Note: a 403 (instance has json format
	// disabled) is permanent but still falls through; see CHANGELOG.
	if (opts.searxngBaseUrl) {
		try {
			const results = await searchSearXNG(query, { baseUrl: opts.searxngBaseUrl, signal: opts.signal });
			return { provider: "searxng", results };
		} catch (e) {
			// Fall through to Tavily
		}
	}
	if (process.env.TAVILY_API_KEY) {
		const results = await searchTavily(query, opts);
		return { provider: "tavily", results };
	}
	throw new Error(
		"No search API configured. Configure SearXNG (settings.json `deepresearch.searxngBaseUrl` or SEARXNG_BASE_URL env var) or set TAVILY_API_KEY.\n" +
		"  SearXNG: self-hosted, free, unlimited (https://searxng.org)\n" +
		"  Tavily:  https://tavily.com (free: 1000 req/month)"
	);
}

// ─── Content Extraction ───

async function extractContent(url: string, signal?: AbortSignal): Promise<ExtractResult> {
	// Compose the agent's abort signal with a hard 15s timeout so Esc cancels
	// and a hung page can't stall the turn. signal may be undefined in non-turn ctx.
	const timeoutSignal = AbortSignal.timeout(15000);
	const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

	const resp = await fetch(url, {
		headers: {
			"User-Agent": "Mozilla/5.0 (compatible; PiDeepResearch/1.0)",
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		},
		redirect: "follow",
		signal: combined,
	});

	if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);

	const html = await resp.text();

	// Simple content extraction — strip HTML tags, extract title and main content
	// A production version would use @mozilla/readability or similar
	const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
	const title = titleMatch?.[1]?.replace(/&[^;]+;/g, " ").trim() ?? "";

	// Remove script, style, nav, header, footer tags
	let content = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<nav[\s\S]*?<\/nav>/gi, "")
		.replace(/<header[\s\S]*?<\/header>/gi, "")
		.replace(/<footer[\s\S]*?<\/footer>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&[^;]+;/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	// Truncate to ~8000 words to avoid overwhelming the context
	const words = content.split(/\s+/);
	const wordCount = words.length;
	if (words.length > 8000) {
		content = words.slice(0, 8000).join(" ") + "\n\n[... truncated, total " + wordCount + " words]";
	}

	// Try to extract author from meta tags
	const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i);
	const author = authorMatch?.[1];

	// Try to extract publish date
	const dateMatch = html.match(/<meta[^>]*(?:property=["']article:published_time["']|name=["']date["'])[^>]*content=["']([^"']+)["']/i);
	const publishedDate = dateMatch?.[1];

	return { title, url, content, author, publishedDate, wordCount };
}

// ─── Batch Search (parallel) ───

async function batchSearch(queries: string[], opts: { maxResults: number; searchDepth: string; signal?: AbortSignal; searxngBaseUrl?: string; }): Promise<{ provider: string; results: Record<string, SearchResult[]> }> {
	const settled = await Promise.allSettled(
		queries.map((q) => doSearch(q, { maxResults: opts.maxResults, searchDepth: opts.searchDepth, signal: opts.signal, searxngBaseUrl: opts.searxngBaseUrl }))
	);

	let provider = "unknown";
	const results: Record<string, SearchResult[]> = {};
	for (let i = 0; i < queries.length; i++) {
		const s = settled[i];
		if (s.status === "fulfilled") {
			provider = s.value.provider;
			results[queries[i]] = s.value.results;
		} else {
			results[queries[i]] = [];
		}
	}
	return { provider, results };
}

// ─── Extension Entry Point ───

export default function (pi: ExtensionAPI) {
	// ── Tool: web_search ──
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: [
			"Search the web for information. Supports single query or batch queries (parallel).",
			"Returns ranked results with title, URL, snippet, and relevance score.",
			"Uses SearXNG (if configured) or Tavily (if TAVILY_API_KEY is set).",
		].join(" "),
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query" })),
			queries: Type.Optional(
				Type.Array(Type.String(), {
					description: "Multiple queries to search in parallel (max 5)",
					maxItems: 5,
				})
			),
			max_results: Type.Optional(
				Type.Number({ description: "Max results per query (default: 5, max: 10)", default: 5, maximum: 10 })
			),
			search_depth: Type.Optional(
				Type.String({
					description: '"basic" for speed, "advanced" for thoroughness (Tavily only)',
					default: "basic",
				})
			),
			include_domains: Type.Optional(
				Type.Array(Type.String(), { description: "Only include results from these domains" })
			),
			exclude_domains: Type.Optional(
				Type.Array(Type.String(), { description: "Exclude results from these domains" })
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const maxResults = Math.min(params.max_results ?? 5, 10);
			const searchDepth = params.search_depth ?? "basic";
			const searxngBaseUrl = getSearXngBaseUrl(ctx.cwd);

			// Batch mode
			if (params.queries && params.queries.length > 0) {
				const { provider, results } = await batchSearch(params.queries, { maxResults, searchDepth, signal, searxngBaseUrl });
				const totalResults = Object.values(results).reduce((s, r) => s + r.length, 0);
				let text = `Searched ${params.queries.length} queries via ${provider}, found ${totalResults} results:\n\n`;

				for (const [query, hits] of Object.entries(results)) {
					text += `### "${query}" (${hits.length} results)\n\n`;
					for (let i = 0; i < hits.length; i++) {
						const h = hits[i];
						text += `${i + 1}. **${h.title}**\n   ${h.url}\n   ${h.snippet}\n`;
						if (h.score) text += `   Relevance: ${(h.score * 100).toFixed(0)}%`;
						if (h.publishedDate) text += ` | Date: ${h.publishedDate}`;
						text += "\n\n";
					}
				}
				return { content: [{ type: "text", text }], details: {} };
			}

			// Single mode
			if (!params.query) {
				throw new Error("Provide either `query` (string) or `queries` (array).");
			}

			const { provider, results } = await doSearch(params.query, {
				maxResults,
				searchDepth,
				includeDomains: params.include_domains,
				excludeDomains: params.exclude_domains,
				signal,
				searxngBaseUrl,
			});

			let text = `Searched "${params.query}" via ${provider}, found ${results.length} results:\n\n`;
			for (let i = 0; i < results.length; i++) {
				const r = results[i];
				text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n`;
				if (r.score) text += `   Relevance: ${(r.score * 100).toFixed(0)}%`;
				if (r.publishedDate) text += ` | Date: ${r.publishedDate}`;
				text += "\n\n";
			}
			return { content: [{ type: "text", text }], details: {} };
		},
	});

	// ── Tool: web_extract ──
	pi.registerTool({
		name: "web_extract",
		label: "Web Extract",
		description: [
			"Extract the main text content from a web page URL.",
			"Strips HTML, scripts, navigation, and returns clean text.",
			"Use after web_search to read full content of promising results.",
		].join(" "),
		parameters: Type.Object({
			url: Type.String({ description: "URL of the web page to extract content from" }),
		}),

		async execute(_toolCallId, params, signal) {
			try {
				const result = await extractContent(params.url, signal);
				let text = `# ${result.title}\n\n`;
				text += `**URL:** ${result.url}\n`;
				if (result.author) text += `**Author:** ${result.author}\n`;
				if (result.publishedDate) text += `**Published:** ${result.publishedDate}\n`;
				text += `**Word count:** ${result.wordCount}\n\n---\n\n`;
				text += result.content;
				return { content: [{ type: "text", text }], details: {} };
			} catch (e: unknown) {
				// Agent-cancelled (Esc) is not a tool failure - surface as a normal result.
				if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
					return { content: [{ type: "text", text: "Cancelled" }], details: {} };
				}
				// Genuine failure (network, status, timeout) - throw so the LLM sees isError.
				const msg = e instanceof Error ? e.message : String(e);
				throw new Error(`Failed to extract content from ${params.url}: ${msg}`);
			}
		},
	});

	// ── Tool: research_checkpoint ──
	// Hard gate: LLM must call this after each search round.
	// Code decides whether to continue searching or allow synthesis.

	const DEPTH_THRESHOLDS: Record<string, {
		minSearchRounds: number;
		maxSearchRounds: number;
		minSources: number;
		confidenceThreshold: number;
		minAnsweredRatio: number;
	}> = {
		quick:      { minSearchRounds: 1, maxSearchRounds: 3,  minSources: 3,  confidenceThreshold: 60, minAnsweredRatio: 0.6 },
		standard:   { minSearchRounds: 2, maxSearchRounds: 6,  minSources: 5,  confidenceThreshold: 75, minAnsweredRatio: 0.7 },
		deep:       { minSearchRounds: 3, maxSearchRounds: 10, minSources: 10, confidenceThreshold: 85, minAnsweredRatio: 0.8 },
		exhaustive: { minSearchRounds: 5, maxSearchRounds: 20, minSources: 15, confidenceThreshold: 95, minAnsweredRatio: 0.9 },
	};

	pi.registerTool({
		name: "research_checkpoint",
		label: "Research Checkpoint",
		description: [
			"MANDATORY after each search round during deep research.",
			"Submit current research state for evaluation.",
			"The tool will analyze your progress and return a VERDICT: CONTINUE (must search more) or PROCEED (may synthesize report).",
			"You MUST obey the verdict — if it says CONTINUE, you must do another search round before calling this again.",
			"Do NOT skip this tool or write the report without a PROCEED verdict.",
		].join(" "),
		parameters: Type.Object({
			depth: Type.String({
				description: 'Research depth level: "quick", "standard", "deep", or "exhaustive"',
			}),
			round: Type.Number({
				description: "Current search round number (1-indexed, increment after each search batch)",
			}),
			sub_questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "The sub-question" }),
					answered: Type.Boolean({ description: "Whether this sub-question has been adequately answered" }),
					confidence: Type.Number({ description: "Confidence score 0-100 for this sub-question" }),
					source_count: Type.Number({ description: "Number of sources found for this sub-question" }),
					best_source_tier: Type.Number({ description: "Best source credibility tier (1=authoritative, 2=reliable, 3=community, 4=unverified)" }),
				}),
				{ description: "Status of each sub-question" }
			),
			total_sources: Type.Number({ description: "Total unique sources collected so far" }),
			contradictions: Type.Optional(
				Type.Array(Type.String(), { description: "List of contradictions found between sources" })
			),
			gaps: Type.Optional(
				Type.Array(Type.String(), { description: "Known information gaps that remain" })
			),
		}),

		async execute(_toolCallId, params) {
			const thresholds = DEPTH_THRESHOLDS[params.depth] ?? DEPTH_THRESHOLDS.standard;
			const totalQuestions = params.sub_questions.length;
			const answeredCount = params.sub_questions.filter(q => q.answered).length;
			const answeredRatio = totalQuestions > 0 ? answeredCount / totalQuestions : 0;
			const avgConfidence = totalQuestions > 0
				? params.sub_questions.reduce((sum, q) => sum + q.confidence, 0) / totalQuestions
				: 0;
			const minConfidence = totalQuestions > 0
				? Math.min(...params.sub_questions.map(q => q.confidence))
				: 0;
			const hasContradictions = (params.contradictions?.length ?? 0) > 0;
			const lowConfidenceQuestions = params.sub_questions.filter(q => q.confidence < 40);
			const medConfidenceQuestions = params.sub_questions.filter(q => q.confidence >= 40 && q.confidence < thresholds.confidenceThreshold);

			// ── Evaluate ──
			const issues: string[] = [];
			let verdict: "CONTINUE" | "PROCEED" = "PROCEED";

			// Rule 1: Haven't done minimum search rounds
			if (params.round < thresholds.minSearchRounds) {
				verdict = "CONTINUE";
				issues.push(`⛔ Min search rounds not met: ${params.round}/${thresholds.minSearchRounds} rounds`);
			}

			// Rule 2: Not enough sources
			if (params.total_sources < thresholds.minSources) {
				verdict = "CONTINUE";
				issues.push(`⛔ Not enough sources: ${params.total_sources}/${thresholds.minSources} sources`);
			}

			// Rule 3: Too many unanswered questions
			if (answeredRatio < thresholds.minAnsweredRatio) {
				verdict = "CONTINUE";
				issues.push(`⛔ Answered ratio too low: ${answeredCount}/${totalQuestions} (${(answeredRatio * 100).toFixed(0)}% < ${(thresholds.minAnsweredRatio * 100).toFixed(0)}%)`);
			}

			// Rule 4: Average confidence below threshold
			if (avgConfidence < thresholds.confidenceThreshold) {
				verdict = "CONTINUE";
				issues.push(`⛔ Average confidence too low: ${avgConfidence.toFixed(0)}% < ${thresholds.confidenceThreshold}%`);
			}

			// Rule 5: Any question with very low confidence
			if (lowConfidenceQuestions.length > 0 && params.round < thresholds.maxSearchRounds) {
				verdict = "CONTINUE";
				const names = lowConfidenceQuestions.map(q => `"${q.question}" (${q.confidence}%)`).join(", ");
				issues.push(`⛔ Low-confidence sub-questions (<40%): ${names}`);
			}

			// Rule 6: Unresolved contradictions
			if (hasContradictions && params.round < thresholds.maxSearchRounds) {
				verdict = "CONTINUE";
				issues.push(`⚠️ Unresolved contradictions (${params.contradictions!.length}) — search for authoritative sources to verify`);
			}

			// Safety valve: don't exceed max rounds
			if (params.round >= thresholds.maxSearchRounds) {
				verdict = "PROCEED";
				if (issues.length > 0) {
					issues.push(`⚠️ Max search rounds reached (${thresholds.maxSearchRounds}). Proceeding to report. Remaining issues will be noted in "Uncertainties & Gaps".`);
				}
			}

			// ── Build response ──
			const statusBar = `${"█".repeat(Math.round(avgConfidence / 5))}${"░".repeat(20 - Math.round(avgConfidence / 5))}`;

			let text = `## Research Checkpoint — Round ${params.round}\n\n`;
			text += `**Depth:** ${params.depth} | **Verdict: ${verdict === "CONTINUE" ? "🔴 CONTINUE SEARCHING" : "🟢 PROCEED TO REPORT"}**\n\n`;
			text += `### Progress\n`;
			text += `- Search rounds: ${params.round} / ${thresholds.minSearchRounds}-${thresholds.maxSearchRounds}\n`;
			text += `- Sources collected: ${params.total_sources} / ${thresholds.minSources} (minimum)\n`;
			text += `- Sub-questions answered: ${answeredCount}/${totalQuestions} (${(answeredRatio * 100).toFixed(0)}%)\n`;
			text += `- Avg confidence: ${statusBar} ${avgConfidence.toFixed(0)}% (threshold: ${thresholds.confidenceThreshold}%)\n`;
			text += `- Min confidence: ${minConfidence.toFixed(0)}%\n`;

			text += `\n### Sub-question Status\n`;
			for (const q of params.sub_questions) {
				const icon = q.confidence >= thresholds.confidenceThreshold ? "✅" :
				             q.confidence >= 40 ? "🟡" : "🔴";
				text += `${icon} [${q.confidence}%] ${q.question} — ${q.source_count} sources (Tier ${q.best_source_tier})\n`;
			}

			if (issues.length > 0) {
				text += `\n### Issues\n`;
				for (const issue of issues) {
					text += `${issue}\n`;
				}
			}

			if (params.contradictions && params.contradictions.length > 0) {
				text += `\n### Contradictions\n`;
				for (const c of params.contradictions) {
					text += `- ⚡ ${c}\n`;
				}
			}

			if (params.gaps && params.gaps.length > 0) {
				text += `\n### Remaining Gaps\n`;
				for (const g of params.gaps) {
					text += `- ❓ ${g}\n`;
				}
			}

			if (verdict === "CONTINUE") {
				text += `\n### 📋 Next Actions Required\n`;
				text += `You MUST perform another search round addressing the issues above, then call \`research_checkpoint\` again.\n`;

				// Specific guidance
				if (lowConfidenceQuestions.length > 0) {
					text += `\n**Priority — Low confidence questions to focus on:**\n`;
					for (const q of lowConfidenceQuestions) {
						text += `- "${q.question}" — try different search queries, different angles\n`;
					}
				}
				if (medConfidenceQuestions.length > 0) {
					text += `\n**Secondary — Medium confidence questions to strengthen:**\n`;
					for (const q of medConfidenceQuestions) {
						text += `- "${q.question}" (${q.confidence}%) — find corroborating sources\n`;
					}
				}
				if (hasContradictions) {
					text += `\n**Resolve contradictions** by searching for authoritative (Tier 1) sources.\n`;
				}
			} else {
				text += `\n### ✅ Ready to Synthesize\n`;
				text += `All criteria met. Proceed to Phase 4 — write the research report.\n`;
				if (params.gaps && params.gaps.length > 0) {
					text += `Include the ${params.gaps.length} remaining gap(s) in the "Uncertainties & Gaps" section of the report.\n`;
				}
				if (hasContradictions) {
					text += `Include the ${params.contradictions!.length} contradiction(s) in the report — present both sides.\n`;
				}
			}

			return { content: [{ type: "text", text }], details: {} };
		},
	});
}
