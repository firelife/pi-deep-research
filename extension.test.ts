/**
 * Unit tests for evaluateCheckpoint (the pure evaluator extracted from the
 * research_checkpoint tool). Run with: node --test --import tsx extension.test.ts
 *
 * These tests lock down the 6-rule threshold behavior and the safety valve,
 * so accidental drift in DEPTH_THRESHOLDS or the rule logic is caught.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	evaluateCheckpoint,
	DEPTH_THRESHOLDS,
	type CheckpointParams,
	type SubQuestion,
} from "./checkpoint.js";

// ─── Helpers ───

let id = 0;
function q(overrides: Partial<SubQuestion> = {}): SubQuestion {
	return {
		question: `Q${++id}`,
		answered: true,
		confidence: 90,
		source_count: 3,
		best_source_tier: 1,
		...overrides,
	};
}

function params(overrides: Partial<CheckpointParams> = {}): CheckpointParams {
	return {
		depth: "standard",
		round: 3,
		sub_questions: [q(), q(), q()],
		total_sources: 8,
		contradictions: undefined,
		gaps: undefined,
		...overrides,
	};
}

// Reset the Q counter between tests for stable question names.
function reset() {
	id = 0;
}

// ─── DEPTH_THRESHOLDS sanity ───

test("DEPTH_THRESHOLDS has all four depths with monotonic thresholds", () => {
	const depths = ["quick", "standard", "deep", "exhaustive"] as const;
	for (const d of depths) {
		assert.ok(d in DEPTH_THRESHOLDS, `${d} present`);
		const t = DEPTH_THRESHOLDS[d];
		assert.ok(t.minSearchRounds <= t.maxSearchRounds, `${d}: min<=max rounds`);
		assert.ok(t.confidenceThreshold >= 0 && t.confidenceThreshold <= 100, `${d}: threshold in range`);
	}
	// Deeper levels demand more
	assert.ok(DEPTH_THRESHOLDS.exhaustive.minSources > DEPTH_THRESHOLDS.quick.minSources);
	assert.ok(DEPTH_THRESHOLDS.exhaustive.confidenceThreshold > DEPTH_THRESHOLDS.quick.confidenceThreshold);
});

// ─── Happy path: all criteria met -> PROCEED ───

test("standard depth, all criteria met -> PROCEED with no issues", () => {
	reset();
	const r = evaluateCheckpoint(params());
	assert.equal(r.verdict, "PROCEED");
	assert.equal(r.issues.length, 0);
});

// ─── Rule 1: min search rounds ───

test("Rule 1: round below minSearchRounds -> CONTINUE", () => {
	reset();
	// standard: minSearchRounds=2. round=1 should fail rule 1.
	const r = evaluateCheckpoint(params({ round: 1 }));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("Min search rounds not met")));
});

test("Rule 1: round exactly at minSearchRounds passes rule 1", () => {
	reset();
	const r = evaluateCheckpoint(params({ round: 2 }));
	// round=2 satisfies minSearchRounds=2; other params are happy-path.
	assert.equal(r.verdict, "PROCEED");
	assert.ok(!r.issues.some(i => i.includes("Min search rounds not met")));
});

// ─── Rule 2: min sources ───

test("Rule 2: total_sources below minSources -> CONTINUE", () => {
	reset();
	const r = evaluateCheckpoint(params({ total_sources: 2 })); // standard min=5
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("Not enough sources")));
});

// ─── Rule 3: answered ratio ───

test("Rule 3: answered ratio below minAnsweredRatio -> CONTINUE", () => {
	reset();
	// 3 questions, only 1 answered = 33% < 70% standard threshold
	const r = evaluateCheckpoint(params({
		sub_questions: [q(), q({ answered: false }), q({ answered: false })],
	}));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("Answered ratio too low")));
});

// ─── Rule 4: average confidence ───

test("Rule 4: avg confidence below threshold -> CONTINUE", () => {
	reset();
	// standard threshold=75; avg of 60,60,60 = 60
	const r = evaluateCheckpoint(params({
		sub_questions: [q({ confidence: 60 }), q({ confidence: 60 }), q({ confidence: 60 })],
	}));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("Average confidence too low")));
});

// ─── Rule 5: low-confidence sub-questions (<40) ───

test("Rule 5: any sub-question confidence <40 -> CONTINUE", () => {
	reset();
	const r = evaluateCheckpoint(params({
		sub_questions: [q(), q({ confidence: 30 }), q()],
	}));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("Low-confidence sub-questions")));
});

test("Rule 5: confidence exactly 40 does NOT trigger low-confidence rule", () => {
	reset();
	// avg must stay >= standard threshold (75): (95+95+40)/3 = 76.67.
	const r = evaluateCheckpoint(params({
		sub_questions: [q({ confidence: 95 }), q({ confidence: 40 }), q({ confidence: 95 })],
	}));
	assert.equal(r.verdict, "PROCEED");
	assert.ok(!r.issues.some(i => i.includes("Low-confidence sub-questions")));
});

// ─── Rule 6: unresolved contradictions ───

test("Rule 6: contradictions before maxRounds -> CONTINUE", () => {
	reset();
	const r = evaluateCheckpoint(params({
		round: 2,
		contradictions: ["Source A says X, Source B says Y"],
	}));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("Unresolved contradictions")));
});

test("Rule 6: contradictions at/after maxRounds do NOT block (safety valve)", () => {
	reset();
	// standard maxRounds=6; at round 6 the safety valve forces PROCEED.
	const r = evaluateCheckpoint(params({
		round: 6,
		contradictions: ["unresolved"],
	}));
	assert.equal(r.verdict, "PROCEED");
});

// ─── Safety valve ───

test("Safety valve: reaching maxSearchRounds forces PROCEED even with unresolved issues", () => {
	reset();
	// Exhaustive maxRounds=20. Give it a failing config but at round 20.
	const r = evaluateCheckpoint(params({
		depth: "exhaustive",
		round: 20,
		total_sources: 5, // far below 15
		sub_questions: [q({ confidence: 20, answered: false })], // low confidence + unanswered
	}));
	assert.equal(r.verdict, "PROCEED");
	assert.ok(r.issues.some(i => i.includes("Max search rounds reached")));
});

test("Safety valve: one short of maxRounds still CONTINUE", () => {
	reset();
	const r = evaluateCheckpoint(params({
		depth: "exhaustive",
		round: 19,
		total_sources: 5,
		sub_questions: [q({ confidence: 20, answered: false })],
	}));
	assert.equal(r.verdict, "CONTINUE");
});

// ─── Unknown depth fallback ───

test("Unknown depth falls back to standard AND adds an issue", () => {
	reset();
	// Happy-path params for standard, but depth is bogus.
	const r = evaluateCheckpoint(params({ depth: "ultra" }));
	assert.equal(r.depth, "standard");
	assert.equal(r.verdict, "PROCEED"); // standard happy path still proceeds
	assert.ok(r.issues.some(i => i.includes('Unknown depth "ultra"')));
});

test("Unknown depth with failing standard thresholds -> CONTINUE", () => {
	reset();
	const r = evaluateCheckpoint(params({ depth: "bogus", round: 1, total_sources: 1 }));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("Unknown depth")));
});

// ─── Input normalization ───

test("round < 1 is clamped to 1", () => {
	reset();
	// round=0 or negative would otherwise make round < minSearchRounds(true),
	// but the result.round used in output should be 1. We detect via the issue
	// text which uses the clamped value.
	const r = evaluateCheckpoint(params({ round: 0 }));
	// standard minSearchRounds=2, so clamped round=1 still triggers rule 1.
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("1/2 rounds")));
});

test("confidence out of range is clamped to [0, 100]", () => {
	reset();
	// confidence 150 should be clamped to 100; -20 clamped to 0.
	// avg of (100, 100, 0) = 66.7 < 75 standard threshold -> Rule 4 fires.
	const r = evaluateCheckpoint(params({
		sub_questions: [
			q({ confidence: 150 }),
			q({ confidence: 150 }),
			q({ confidence: -20 }),
		],
	}));
	// minConfidence clamped to 0 -> Rule 5 also fires.
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("Low-confidence sub-questions")));
	// avgConfidence should reflect clamped values: (100+100+0)/3 = 66.67
	assert.ok(r.avgConfidence < 75);
	assert.equal(r.minConfidence, 0);
});

test("total_sources negative is clamped to 0", () => {
	reset();
	const r = evaluateCheckpoint(params({ total_sources: -5 }));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("0/5 sources")));
});

// ─── Empty sub_questions edge case ───

test("empty sub_questions does not crash; treated as 0 answered", () => {
	reset();
	const r = evaluateCheckpoint(params({
		sub_questions: [],
		total_sources: 8,
	}));
	// 0 questions: answeredRatio=0 (0/0 guarded), avgConfidence=0, minConfidence=0.
	// Rule 3 (answeredRatio 0 < 0.7) and Rule 4 (avg 0 < 75) and Rule 5 (no low-conf q's, skipped) apply.
	assert.equal(r.verdict, "CONTINUE");
	assert.equal(r.totalQuestions, 0);
	assert.equal(r.answeredCount, 0);
	assert.equal(r.avgConfidence, 0);
});

// ─── Optional fields absent ───

test("contradictions and gaps absent (undefined) is fine", () => {
	reset();
	const r = evaluateCheckpoint(params({ contradictions: undefined, gaps: undefined }));
	assert.equal(r.verdict, "PROCEED");
	assert.equal(r.hasContradictions, false);
});

test("empty contradictions array is treated as no contradictions", () => {
	reset();
	const r = evaluateCheckpoint(params({ contradictions: [] }));
	assert.equal(r.hasContradictions, false);
	assert.equal(r.verdict, "PROCEED");
});

// ─── Depth-specific boundary checks ───

test("quick depth boundary: round=1 (min) with all criteria met -> PROCEED", () => {
	reset();
	const r = evaluateCheckpoint(params({
		depth: "quick",
		round: 1,
		total_sources: 3, // quick min=3
		sub_questions: [q({ confidence: 60 })], // quick threshold=60
	}));
	assert.equal(r.verdict, "PROCEED");
});

test("deep depth: needs minSearchRounds=3", () => {
	reset();
	const r = evaluateCheckpoint(params({
		depth: "deep",
		round: 2, // below min 3
		total_sources: 10,
		sub_questions: [q({ confidence: 85 })],
	}));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("2/3 rounds")));
});

test("exhaustive depth: needs minSources=15", () => {
	reset();
	const r = evaluateCheckpoint(params({
		depth: "exhaustive",
		round: 5,
		total_sources: 14, // below 15
		sub_questions: [q({ confidence: 95 })],
	}));
	assert.equal(r.verdict, "CONTINUE");
	assert.ok(r.issues.some(i => i.includes("14/15 sources")));
});
