/**
 * Pure evaluator for the research_checkpoint tool.
 *
 * Extracted from extension.ts so it can be unit-tested without loading the
 * pi SDK (which is ESM-only and not importable from node:test's CJS path).
 * extension.ts imports evaluateCheckpoint / DEPTH_THRESHOLDS from here.
 *
 * The execute handler in extension.ts is a thin wrapper that calls
 * evaluateCheckpoint and formats the result as the tool's text output.
 */

// ─── Types ───

export type Depth = "quick" | "standard" | "deep" | "exhaustive";

export interface DepthThreshold {
	minSearchRounds: number;
	maxSearchRounds: number;
	minSources: number;
	confidenceThreshold: number;
	minAnsweredRatio: number;
}

export interface SubQuestion {
	question: string;
	answered: boolean;
	confidence: number;
	source_count: number;
	best_source_tier: number;
}

export interface CheckpointParams {
	depth: string;
	round: number;
	sub_questions: SubQuestion[];
	total_sources: number;
	contradictions?: string[];
	gaps?: string[];
}

export interface CheckpointResult {
	verdict: "CONTINUE" | "PROCEED";
	issues: string[];
	depth: string;
	threshold: DepthThreshold;
	answeredCount: number;
	totalQuestions: number;
	answeredRatio: number;
	avgConfidence: number;
	minConfidence: number;
	lowConfidenceQuestions: SubQuestion[];
	medConfidenceQuestions: SubQuestion[];
	hasContradictions: boolean;
}

// ─── Thresholds (single source of truth) ───

export const DEPTH_THRESHOLDS: Record<Depth, DepthThreshold> = {
	quick:      { minSearchRounds: 1, maxSearchRounds: 3,  minSources: 3,  confidenceThreshold: 60, minAnsweredRatio: 0.6 },
	standard:   { minSearchRounds: 2, maxSearchRounds: 6,  minSources: 5,  confidenceThreshold: 75, minAnsweredRatio: 0.7 },
	deep:       { minSearchRounds: 3, maxSearchRounds: 10, minSources: 10, confidenceThreshold: 85, minAnsweredRatio: 0.8 },
	exhaustive: { minSearchRounds: 5, maxSearchRounds: 20, minSources: 15, confidenceThreshold: 95, minAnsweredRatio: 0.9 },
};

// ─── Evaluator ───

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Evaluate research progress against depth-specific hard thresholds.
 *
 * Input normalization:
 * - Unknown depth -> falls back to standard (legacy behavior) and adds an issue
 *   so the LLM knows to correct it.
 * - round < 1 is clamped to 1 (1-indexed per the tool description).
 * - confidence is clamped to [0, 100] per sub-question.
 */
export function evaluateCheckpoint(params: CheckpointParams): CheckpointResult {
	const knownDepth = (params.depth in DEPTH_THRESHOLDS) as boolean;
	const depthKey: Depth = knownDepth ? (params.depth as Depth) : "standard";
	const threshold = DEPTH_THRESHOLDS[depthKey];

	// Normalize inputs (don't mutate the caller's object)
	const round = Math.max(1, Math.floor(params.round));
	const subQuestions = params.sub_questions.map(q => ({
		...q,
		confidence: clamp(q.confidence, 0, 100),
	}));
	const totalSources = Math.max(0, Math.floor(params.total_sources));

	const totalQuestions = subQuestions.length;
	const answeredCount = subQuestions.filter(q => q.answered).length;
	const answeredRatio = totalQuestions > 0 ? answeredCount / totalQuestions : 0;
	const avgConfidence = totalQuestions > 0
		? subQuestions.reduce((sum, q) => sum + q.confidence, 0) / totalQuestions
		: 0;
	const minConfidence = totalQuestions > 0
		? Math.min(...subQuestions.map(q => q.confidence))
		: 0;
	const hasContradictions = (params.contradictions?.length ?? 0) > 0;
	const lowConfidenceQuestions = subQuestions.filter(q => q.confidence < 40);
	const medConfidenceQuestions = subQuestions.filter(q => q.confidence >= 40 && q.confidence < threshold.confidenceThreshold);

	// ── Evaluate ──
	const issues: string[] = [];
	let verdict: "CONTINUE" | "PROCEED" = "PROCEED";

	if (!knownDepth) {
		issues.push(`⛔ Unknown depth "${params.depth}" - expected quick|standard|deep|exhaustive. Falling back to standard.`);
	}

	// Rule 1: Haven't done minimum search rounds
	if (round < threshold.minSearchRounds) {
		verdict = "CONTINUE";
		issues.push(`⛔ Min search rounds not met: ${round}/${threshold.minSearchRounds} rounds`);
	}

	// Rule 2: Not enough sources
	if (totalSources < threshold.minSources) {
		verdict = "CONTINUE";
		issues.push(`⛔ Not enough sources: ${totalSources}/${threshold.minSources} sources`);
	}

	// Rule 3: Too many unanswered questions
	if (answeredRatio < threshold.minAnsweredRatio) {
		verdict = "CONTINUE";
		issues.push(`⛔ Answered ratio too low: ${answeredCount}/${totalQuestions} (${(answeredRatio * 100).toFixed(0)}% < ${(threshold.minAnsweredRatio * 100).toFixed(0)}%)`);
	}

	// Rule 4: Average confidence below threshold
	if (avgConfidence < threshold.confidenceThreshold) {
		verdict = "CONTINUE";
		issues.push(`⛔ Average confidence too low: ${avgConfidence.toFixed(0)}% < ${threshold.confidenceThreshold}%`);
	}

	// Rule 5: Any question with very low confidence
	if (lowConfidenceQuestions.length > 0 && round < threshold.maxSearchRounds) {
		verdict = "CONTINUE";
		const names = lowConfidenceQuestions.map(q => `"${q.question}" (${q.confidence}%)`).join(", ");
		issues.push(`⛔ Low-confidence sub-questions (<40%): ${names}`);
	}

	// Rule 6: Unresolved contradictions
	if (hasContradictions && round < threshold.maxSearchRounds) {
		verdict = "CONTINUE";
		issues.push(`⚠️ Unresolved contradictions (${params.contradictions!.length}) - search for authoritative sources to verify`);
	}

	// Safety valve: don't exceed max rounds
	if (round >= threshold.maxSearchRounds) {
		verdict = "PROCEED";
		if (issues.length > 0) {
			issues.push(`⚠️ Max search rounds reached (${threshold.maxSearchRounds}). Proceeding to report. Remaining issues will be noted in "Uncertainties & Gaps".`);
		}
	}

	return {
		verdict,
		issues,
		depth: depthKey,
		threshold,
		answeredCount,
		totalQuestions,
		answeredRatio,
		avgConfidence,
		minConfidence,
		lowConfidenceQuestions,
		medConfidenceQuestions,
		hasContradictions,
	};
}
