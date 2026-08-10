/**
 * Deep Research Extension - research_checkpoint tool + tool wiring
 *
 * Search and page extraction are delegated to pi's built-in `web_search` /
 * `web_read` tools (or configurable alternatives). This extension only owns
 * the research_checkpoint gate plus the wiring that activates the configured
 * tools and tells the LLM which tool names to use.
 *
 * Configuration (settings.json `deepresearch`):
 *   searchTool  - tool name for web search  (default: "web_search")
 *   extractTool - tool name for page extract (default: "web_read")
 * Project-local settings override global. When a configured name differs from
 * the default, a system-prompt note is injected each turn so the LLM uses the
 * configured tool name instead of the one hard-coded in SKILL.md.
 */

import { SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { evaluateCheckpoint } from "./checkpoint.js";

// ─── Configuration ───

interface DeepResearchSettings {
	searchTool?: string;
	extractTool?: string;
}

const DEFAULT_SEARCH_TOOL = "web_search";
const DEFAULT_EXTRACT_TOOL = "web_read";

/**
 * Resolve deepresearch settings (project overrides global). Reads per-call via
 * SettingsManager. pi's Settings type is closed (no custom keys), so the
 * deepresearch key is read via a cast.
 */
function getDeepResearchSettings(cwd: string): DeepResearchSettings {
	try {
		const sm = SettingsManager.create(cwd);
		const global = sm.getGlobalSettings() as unknown as { deepresearch?: DeepResearchSettings };
		const project = sm.getProjectSettings() as unknown as { deepresearch?: DeepResearchSettings };
		return {
			searchTool: project.deepresearch?.searchTool ?? global.deepresearch?.searchTool,
			extractTool: project.deepresearch?.extractTool ?? global.deepresearch?.extractTool,
		};
	} catch {
		return {};
	}
}

// ─── Extension Entry Point ───

export default function (pi: ExtensionAPI) {
	// ── Tool: research_checkpoint ──
	// Hard gate: LLM must call this after each search round.
	// Code decides whether to continue searching or allow synthesis.

	pi.registerTool({
		name: "research_checkpoint",
		label: "Research Checkpoint",
		description: [
			"MANDATORY after each search round during deep research.",
			"Submit current research state for evaluation.",
			"The tool will analyze your progress and return a VERDICT: CONTINUE (must search more) or PROCEED (may synthesize report).",
			"You MUST obey the verdict - if it says CONTINUE, you must do another search round before calling this again.",
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
			const result = evaluateCheckpoint(params);
			const {
				verdict,
				issues,
				threshold,
				answeredCount,
				totalQuestions,
				answeredRatio,
				avgConfidence,
				minConfidence,
				lowConfidenceQuestions,
				medConfidenceQuestions,
				hasContradictions,
			} = result;
			const round = Math.max(1, Math.floor(params.round));

			// ── Build response ──
			const statusBar = `${"█".repeat(Math.round(avgConfidence / 5))}${"░".repeat(20 - Math.round(avgConfidence / 5))}`;

			let text = `## Research Checkpoint - Round ${round}\n\n`;
			text += `**Depth:** ${params.depth} | **Verdict: ${verdict === "CONTINUE" ? "🔴 CONTINUE SEARCHING" : "🟢 PROCEED TO REPORT"}**\n\n`;
			text += `### Progress\n`;
			text += `- Search rounds: ${round} / ${threshold.minSearchRounds}-${threshold.maxSearchRounds}\n`;
			text += `- Sources collected: ${params.total_sources} / ${threshold.minSources} (minimum)\n`;
			text += `- Sub-questions answered: ${answeredCount}/${totalQuestions} (${(answeredRatio * 100).toFixed(0)}%)\n`;
			text += `- Avg confidence: ${statusBar} ${avgConfidence.toFixed(0)}% (threshold: ${threshold.confidenceThreshold}%)\n`;
			text += `- Min confidence: ${minConfidence.toFixed(0)}%\n`;

			text += `\n### Sub-question Status\n`;
			for (const q of params.sub_questions) {
				const icon = q.confidence >= threshold.confidenceThreshold ? "✅" :
				             q.confidence >= 40 ? "🟡" : "🔴";
				text += `${icon} [${q.confidence}%] ${q.question} - ${q.source_count} sources (Tier ${q.best_source_tier})\n`;
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
					text += `\n**Priority - Low confidence questions to focus on:**\n`;
					for (const q of lowConfidenceQuestions) {
						text += `- "${q.question}" - try different search queries, different angles\n`;
					}
				}
				if (medConfidenceQuestions.length > 0) {
					text += `\n**Secondary - Medium confidence questions to strengthen:**\n`;
					for (const q of medConfidenceQuestions) {
						text += `- "${q.question}" (${q.confidence}%) - find corroborating sources\n`;
					}
				}
				if (hasContradictions) {
					text += `\n**Resolve contradictions** by searching for authoritative (Tier 1) sources.\n`;
				}
			} else {
				text += `\n### ✅ Ready to Synthesize\n`;
				text += `All criteria met. Proceed to Phase 4 - write the research report.\n`;
				if (params.gaps && params.gaps.length > 0) {
					text += `Include the ${params.gaps.length} remaining gap(s) in the "Uncertainties & Gaps" section of the report.\n`;
				}
				if (hasContradictions) {
					text += `Include the ${params.contradictions!.length} contradiction(s) in the report - present both sides.\n`;
				}
			}

			return { content: [{ type: "text", text }], details: {} };
		},
	});

	// ── Activate configured tools + validate on session start ──
	// Ensures the configured search/extract tools are visible to the LLM and
	// warns the user (non-blocking) if a configured name is not registered.
	pi.on("session_start", async (_event, ctx) => {
		const cfg = getDeepResearchSettings(ctx.cwd);
		const searchTool = cfg.searchTool ?? DEFAULT_SEARCH_TOOL;
		const extractTool = cfg.extractTool ?? DEFAULT_EXTRACT_TOOL;
		const allToolNames = new Set(pi.getAllTools().map((t) => t.name));
		const active = new Set(pi.getActiveTools());

		const missing: string[] = [];
		for (const name of [searchTool, extractTool]) {
			if (!allToolNames.has(name)) {
				missing.push(name);
			} else {
				active.add(name);
			}
		}

		if (missing.length > 0) {
			ctx.ui.notify(
				`deepresearch: configured tool(s) not registered: ${missing.join(", ")}. Research may fall back to built-in tools.`,
				"warning"
			);
		}

		// Ensure research_checkpoint stays active; only add (never remove) tools.
		active.add("research_checkpoint");
		pi.setActiveTools([...active]);
	});

	// ── Conditional system-prompt injection ──
	// Only when a configured tool name differs from the SKILL.md default, inject
	// a note so the LLM substitutes the tool name. Keeps the common path clean.
	pi.on("before_agent_start", async (event, ctx) => {
		const cfg = getDeepResearchSettings(ctx.cwd);
		const searchTool = cfg.searchTool ?? DEFAULT_SEARCH_TOOL;
		const extractTool = cfg.extractTool ?? DEFAULT_EXTRACT_TOOL;

		const notes: string[] = [];
		if (searchTool !== DEFAULT_SEARCH_TOOL) {
			notes.push(`Use the tool \`${searchTool}\` instead of \`${DEFAULT_SEARCH_TOOL}\` for all web searches in this research.`);
		}
		if (extractTool !== DEFAULT_EXTRACT_TOOL) {
			notes.push(`Use the tool \`${extractTool}\` instead of \`${DEFAULT_EXTRACT_TOOL}\` for all page content extraction in this research.`);
		}
		if (notes.length === 0) return;

		const note = `\n\n[Deep Research tool override]\n${notes.join("\n")}`;
		return { systemPrompt: event.systemPrompt + note };
	});
}
