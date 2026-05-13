import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeTimeBoundaries,
  aggregateSessionMessages,
  computeInsights,
  type ParsedMessage,
  type SessionMessages,
  type TimeBoundaries,
} from "../data-collection.js";
import type {
  PeriodRawData,
  GlobalSessionSpan,
  RawMessage,
  UsageData,
  TimeFilteredStats,
} from "../types.js";

// =============================================================================
// Helpers
// =============================================================================

/** Create a ParsedMessage with sensible defaults for testing. */
function msg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    cost: 0.01,
    input: 1000,
    output: 500,
    cacheRead: 0,
    cacheWrite: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

/** Create a SessionMessages with sensible defaults. */
function session(
  sessionId: string,
  messages: ParsedMessage[]
): SessionMessages {
  return { sessionId, messages };
}

/** Extract model stats for a given model from UsageData for a given scope. */
function getModelStats(
  data: UsageData,
  scope: keyof UsageData,
  provider: string,
  model: string
) {
  const stats = data[scope] as TimeFilteredStats;
  const p = stats.providers.get(provider);
  return p?.models.get(model);
}

/** Extract provider stats for a given provider from UsageData. */
function getProviderStats(
  data: UsageData,
  scope: keyof UsageData,
  provider: string
) {
  const stats = data[scope] as TimeFilteredStats;
  return stats.providers.get(provider);
}

/** Get totals for a scope. */
function getTotals(data: UsageData, scope: keyof UsageData) {
  return (data[scope] as TimeFilteredStats).totals;
}

// =============================================================================
// computeTimeBoundaries
// =============================================================================

describe("computeTimeBoundaries", () => {
  it("returns all expected boundary keys", () => {
    const b = computeTimeBoundaries(0);
    assert.ok(typeof b.nowMs === "number");
    assert.ok(typeof b.todayMs === "number");
    assert.ok(typeof b.yesterdayMs === "number");
    assert.ok(typeof b.weekStartMs === "number");
    assert.ok(typeof b.lastWeekStartMs === "number");
    assert.ok(typeof b.monthStartMs === "number");
    assert.ok(typeof b.lastHourMs === "number");
  });

  it("today boundary is at midnight of the provided timestamp", () => {
    const nowMs = new Date("2026-05-13T14:30:00Z").getTime();
    const b = computeTimeBoundaries(nowMs);
    const expectedToday = new Date("2026-05-13T00:00:00Z").getTime();
    assert.equal(b.todayMs, expectedToday);
  });

  it("yesterday boundary is at midnight the day before provided timestamp", () => {
    const nowMs = new Date("2026-05-13T14:30:00Z").getTime();
    const b = computeTimeBoundaries(nowMs);
    const expectedYesterday = new Date("2026-05-12T00:00:00Z").getTime();
    assert.equal(b.yesterdayMs, expectedYesterday);
  });

  it("lastHour is exactly 1 hour before nowMs", () => {
    const nowMs = 100000000;
    const b = computeTimeBoundaries(nowMs);
    assert.equal(b.lastHourMs, nowMs - 3600000);
  });

  it("weekStart is Monday midnight of the current week", () => {
    const nowMs = new Date("2026-05-13T14:30:00Z").getTime();
    const b = computeTimeBoundaries(nowMs);
    const expectedMonday = new Date("2026-05-11T00:00:00Z").getTime();
    assert.equal(b.weekStartMs, expectedMonday);
  });

  it("lastWeekStart is 7 days before weekStart", () => {
    const nowMs = new Date("2026-05-13T14:30:00Z").getTime();
    const b = computeTimeBoundaries(nowMs);
    const expectedLastMonday = new Date("2026-05-04T00:00:00Z").getTime();
    assert.equal(b.lastWeekStartMs, expectedLastMonday);
  });

  it("monthStart is midnight of the 1st of the current month", () => {
    const nowMs = new Date("2026-05-13T14:30:00Z").getTime();
    const b = computeTimeBoundaries(nowMs);
    const expectedMonth = new Date("2026-05-01T00:00:00Z").getTime();
    assert.equal(b.monthStartMs, expectedMonth);
  });

  it("nowMs defaults to Date.now() when not provided", () => {
    const b = computeTimeBoundaries();
    const now = Date.now();
    // nowMs should be within a few seconds of actual now
    assert.ok(Math.abs(b.nowMs - now) < 5000);
  });
});

// =============================================================================
// aggregateSessionMessages — Time scope correctness
// =============================================================================

describe("aggregateSessionMessages — time scopes", () => {
  // Use a fixed now for deterministic testing.
  // 2026-05-13 14:30:00 UTC
  const nowMs = new Date("2026-05-13T14:30:00Z").getTime();

  function runAggregation(sessions: SessionMessages[]) {
    const boundaries = computeTimeBoundaries(nowMs);
    return aggregateSessionMessages(sessions, boundaries, nowMs);
  }

  it("message at 14:00 (within last hour) appears in lastHour and today", () => {
    // 14:00 on the same day as nowMs (14:30) = 30 min ago — within lastHour
    const ms = new Date("2026-05-13T14:00:00Z").getTime();
    const data = runAggregation([
      session("s1", [msg({ timestamp: ms, cost: 1 })]),
    ]);

    const lh = getTotals(data, "lastHour");
    assert.ok(lh.cost > 0, "lastHour should have cost");
    assert.ok(lh.messages > 0, "lastHour should have messages");

    const td = getTotals(data, "today");
    assert.ok(td.cost > 0, "today should have cost");
  });

  it("message before last hour but today does NOT appear in lastHour", () => {
    // 00:01 on the same day — it's today but NOT within the last hour (14:30 - 1h = 13:30)
    const ms = new Date("2026-05-13T00:01:00Z").getTime();
    const data = runAggregation([
      session("s1", [msg({ timestamp: ms, cost: 1 })]),
    ]);

    const lh = getTotals(data, "lastHour");
    assert.equal(lh.cost, 0, "lastHour should be empty");
    assert.equal(lh.messages, 0, "lastHour should have 0 messages");

    const td = getTotals(data, "today");
    assert.equal(td.cost, 1);
  });

  it("message from yesterday appears in yesterday but NOT today", () => {
    // yesterday = 2026-05-12
    const ms = new Date("2026-05-12T15:00:00Z").getTime();
    const data = runAggregation([
      session("s1", [msg({ timestamp: ms, cost: 1 })]),
    ]);

    const td = getTotals(data, "today");
    assert.equal(td.cost, 0, "today should be empty");

    const yd = getTotals(data, "yesterday");
    assert.equal(yd.cost, 1, "yesterday should have cost");
  });

  it("message from this week (Monday May 11) appears in thisWeek", () => {
    const ms = new Date("2026-05-11T10:00:00Z").getTime();
    const data = runAggregation([
      session("s1", [msg({ timestamp: ms, cost: 1 })]),
    ]);

    const tw = getTotals(data, "thisWeek");
    assert.equal(tw.cost, 1);
  });

  it("message from last week appears in lastWeek but NOT thisWeek", () => {
    // Last week: May 4-10
    const ms = new Date("2026-05-04T10:00:00Z").getTime();
    const data = runAggregation([
      session("s1", [msg({ timestamp: ms, cost: 1 })]),
    ]);

    const tw = getTotals(data, "thisWeek");
    assert.equal(tw.cost, 0, "thisWeek should be empty");

    const lw = getTotals(data, "lastWeek");
    assert.equal(lw.cost, 1, "lastWeek should have cost");
  });

  it("message from this month (May 1) appears in thisMonth", () => {
    const ms = new Date("2026-05-01T01:00:00Z").getTime();
    const data = runAggregation([
      session("s1", [msg({ timestamp: ms, cost: 1 })]),
    ]);

    const tm = getTotals(data, "thisMonth");
    assert.equal(tm.cost, 1);
  });

  it("allTime always includes every message", () => {
    const oldMs = new Date("2020-01-01T00:00:00Z").getTime();
    const data = runAggregation([
      session("s1", [msg({ timestamp: oldMs, cost: 1 })]),
    ]);

    const at = getTotals(data, "allTime");
    assert.equal(at.cost, 1, "allTime should include all messages");
  });

  it("message at exact boundary lands in the correct scope", () => {
    // At todayMs exactly, message should land in today (>= boundary)
    const b = computeTimeBoundaries(nowMs);
    const data = runAggregation([
      session("s1", [msg({ timestamp: b.todayMs, cost: 1 })]),
    ]);

    assert.equal(getTotals(data, "today").cost, 1, "should land in today");
    assert.equal(getTotals(data, "yesterday").cost, 0, "should not land in yesterday");
  });

  it("message 1ms before today lands in yesterday", () => {
    const b = computeTimeBoundaries(nowMs);
    const ms = b.todayMs - 1;
    const data = runAggregation([
      session("s1", [msg({ timestamp: ms, cost: 1 })]),
    ]);

    assert.equal(getTotals(data, "today").cost, 0);
    assert.equal(getTotals(data, "yesterday").cost, 1);
  });
});

// =============================================================================
// aggregateSessionMessages — Deduplication
// =============================================================================

describe("aggregateSessionMessages — deduplication", () => {
  const nowMs = 1767868200000;

  function runAggregation(sessions: SessionMessages[]) {
    const boundaries = computeTimeBoundaries(nowMs);
    return aggregateSessionMessages(sessions, boundaries, nowMs);
  }

  it("duplicate messages from different files are deduplicated", () => {
    const ts = 1767866400000;
    // Two sessions with the same message (branched)
    const data = runAggregation([
      session("session-a", [msg({ timestamp: ts, input: 100, output: 50, cost: 0.01 })]),
      session("session-b", [msg({ timestamp: ts, input: 100, output: 50, cost: 0.01 })]),
    ]);

    const totals = getTotals(data, "allTime");
    // Should NOT double-count
    assert.equal(totals.messages, 1, "should be deduplicated to 1 message");
    assert.equal(totals.cost, 0.01, "should have single cost");
    assert.equal(totals.tokens.total, 150, "should have single token count"); // input+output+cacheWrite
  });

  it("duplicate is based on timestamp:tokens hash (including cacheRead/cacheWrite)", () => {
    const ts = 1767866400000;
    const data = runAggregation([
      session("s1", [msg({ timestamp: ts, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.01 })]),
      session("s2", [
        msg({ timestamp: ts, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.02 }),
      ]),
    ]);

    // Same token counts + timestamp = same hash, deduplicated
    const totals = getTotals(data, "allTime");
    assert.equal(totals.messages, 1, "same tokens should deduplicate");
    // First one wins
    assert.equal(totals.cost, 0.01);
  });

  it("messages with same timestamp but different token counts are NOT deduplicated", () => {
    const ts = 1767866400000;
    const data = runAggregation([
      session("s1", [msg({ timestamp: ts, input: 100, output: 50, cost: 0.01 })]),
      session("s2", [msg({ timestamp: ts, input: 200, output: 100, cost: 0.02 })]),
    ]);

    const totals = getTotals(data, "allTime");
    assert.equal(totals.messages, 2, "different tokens at same timestamp = different messages");
    assert.equal(totals.cost, 0.03);
  });

  it("messages with different timestamps but same token counts are NOT deduplicated", () => {
    const ts1 = 1767866400000;
    const ts2 = 1767866500000;
    const data = runAggregation([
      session("s1", [msg({ timestamp: ts1, input: 100, output: 50, cost: 0.01 })]),
      session("s2", [msg({ timestamp: ts2, input: 100, output: 50, cost: 0.01 })]),
    ]);

    const totals = getTotals(data, "allTime");
    assert.equal(totals.messages, 2, "different timestamps should not deduplicate");
    assert.equal(totals.cost, 0.02);
  });

  it("deduplication works within a single session file as well (duplicate lines)", () => {
    const ts = 1767866400000;
    const data = runAggregation([
      session("session-a", [
        msg({ timestamp: ts, input: 100, output: 50, cost: 0.01 }),
        msg({ timestamp: ts, input: 100, output: 50, cost: 0.01 }),
      ]),
    ]);

    const totals = getTotals(data, "allTime");
    assert.equal(totals.messages, 1, "duplicate in same session should be deduplicated");
  });
});

// =============================================================================
// aggregateSessionMessages — Per-model stats (cost-descending sort)
// =============================================================================

describe("aggregateSessionMessages — per-model stats", () => {
  const nowMs = 1767868200000;

  function runAggregation(sessions: SessionMessages[]) {
    const boundaries = computeTimeBoundaries(nowMs);
    return aggregateSessionMessages(sessions, boundaries, nowMs);
  }

  it("models are accumulated across all providers", () => {
    const data = runAggregation([
      session("s1", [
        msg({ provider: "anthropic", model: "claude-haiku", cost: 0.01, input: 100, output: 50 }),
        msg({ provider: "openai", model: "gpt-4o", cost: 0.05, input: 200, output: 100 }),
        msg({ provider: "anthropic", model: "claude-haiku", cost: 0.02, input: 300, output: 150 }),
      ]),
    ]);

    // Find claude-haiku under anthropic
    const haikuStats = getModelStats(data, "allTime", "anthropic", "claude-haiku");
    assert.ok(haikuStats, "model should exist");
    assert.equal(haikuStats!.messages, 2);
    assert.equal(haikuStats!.cost, 0.03);
    assert.equal(haikuStats!.tokens.input, 400);
    assert.equal(haikuStats!.tokens.output, 200);

    // Find gpt-4o under openai
    const gptStats = getModelStats(data, "allTime", "openai", "gpt-4o");
    assert.ok(gptStats);
    assert.equal(gptStats!.messages, 1);
    assert.equal(gptStats!.cost, 0.05);
  });

  it("cost-descending sort: models from different providers interleaved correctly", () => {
    const data = runAggregation([
      session("s1", [
        msg({ provider: "anthropic", model: "claude-opus", cost: 0.12, input: 1000, output: 100 }),
        msg({ provider: "openai", model: "gpt-4o", cost: 0.10, input: 1000, output: 200 }),
        msg({ provider: "anthropic", model: "claude-haiku", cost: 0.01, input: 1000, output: 300 }),
        msg({ provider: "openai", model: "gpt-4o-mini", cost: 0.03, input: 1000, output: 400 }),
      ]),
    ]);

    // Collect all models sorted by cost descending
    const allTime = data.allTime;
    const models: { name: string; cost: number }[] = [];
    for (const [providerName, p] of allTime.providers) {
      for (const [modelName, m] of p.models) {
        models.push({ name: `${providerName}/${modelName}`, cost: m.cost });
      }
    }
    models.sort((a, b) => b.cost - a.cost);

    // Expected order: opus (0.12), gpt-4o (0.10), gpt-4o-mini (0.03), haiku (0.01)
    assert.equal(models.length, 4);
    assert.equal(models[0]!.name, "anthropic/claude-opus");
    assert.equal(models[1]!.name, "openai/gpt-4o");
    assert.equal(models[2]!.name, "openai/gpt-4o-mini");
    assert.equal(models[3]!.name, "anthropic/claude-haiku");
  });

  it("provider stats roll up all its models", () => {
    const data = runAggregation([
      session("s1", [
        msg({ provider: "anthropic", model: "claude-opus", cost: 0.10, input: 1000, output: 100 }),
        msg({ provider: "anthropic", model: "claude-haiku", cost: 0.01, input: 100, output: 10 }),
      ]),
    ]);

    const p = getProviderStats(data, "allTime", "anthropic");
    assert.ok(p);
    assert.equal(p!.messages, 2);
    assert.equal(p!.cost, 0.11);
    assert.equal(p!.tokens.input, 1100);
    assert.equal(p!.tokens.output, 110);
    assert.equal(p!.tokens.total, 1210); // input+output+cacheWrite
    assert.equal(p!.models.size, 2);
  });

  it("empty input returns zeroed UsageData with no providers", () => {
    const data = runAggregation([]);
    const at = getTotals(data, "allTime");
    assert.equal(at.sessions, 0);
    assert.equal(at.messages, 0);
    assert.equal(at.cost, 0);
    assert.equal(data.allTime.providers.size, 0);
  });
});

// =============================================================================
// aggregateSessionMessages — Session counting
// =============================================================================

describe("aggregateSessionMessages — session counting", () => {
  const nowMs = 1767868200000;

  function runAggregation(sessions: SessionMessages[]) {
    const boundaries = computeTimeBoundaries(nowMs);
    return aggregateSessionMessages(sessions, boundaries, nowMs);
  }

  it("counts unique sessions per scope, not messages", () => {
    const data = runAggregation([
      session("session-a", [
        msg({ timestamp: 1767866400000, cost: 0.01 }),
        msg({ timestamp: 1767866401000, cost: 0.02 }),
        msg({ timestamp: 1767866402000, cost: 0.03 }),
      ]),
    ]);

    const totals = getTotals(data, "allTime");
    assert.equal(totals.sessions, 1, "3 messages from 1 session = 1 session");
    assert.equal(totals.messages, 3);
    assert.equal(totals.cost, 0.06);
  });

  it("counts multiple sessions correctly", () => {
    const data = runAggregation([
      session("session-a", [msg({ timestamp: 1767866400000, cost: 0.01, input: 100, output: 50 })]),
      session("session-b", [msg({ timestamp: 1767866400000, cost: 0.02, input: 200, output: 100 })]),
      session("session-c", [msg({ timestamp: 1767866400000, cost: 0.03, input: 300, output: 150 })]),
    ]);

    const totals = getTotals(data, "allTime");
    assert.equal(totals.sessions, 3);
    assert.equal(totals.messages, 3);
  });

  it("sessions are tracked per provider", () => {
    const data = runAggregation([
      session("session-a", [
        msg({ provider: "anthropic", model: "claude-haiku", timestamp: 1767866400000, cost: 0.01 }),
        msg({ provider: "openai", model: "gpt-4o", timestamp: 1767866500000, cost: 0.02 }),
      ]),
    ]);

    const anth = getProviderStats(data, "allTime", "anthropic");
    assert.ok(anth);
    assert.equal(anth!.sessions.size, 1);

    const oai = getProviderStats(data, "allTime", "openai");
    assert.ok(oai);
    assert.equal(oai!.sessions.size, 1);
  });

  it("sessions are tracked per model", () => {
    const data = runAggregation([
      session("session-a", [
        msg({ provider: "anthropic", model: "claude-haiku", timestamp: 1767866400000, cost: 0.01 }),
      ]),
      session("session-b", [
        msg({ provider: "anthropic", model: "claude-haiku", timestamp: 1767866500000, cost: 0.02 }),
      ]),
    ]);

    const modelStats = getModelStats(data, "allTime", "anthropic", "claude-haiku");
    assert.ok(modelStats);
    assert.equal(modelStats!.sessions.size, 2);
  });
});

// =============================================================================
// aggregateSessionMessages — Token counting
// =============================================================================

describe("aggregateSessionMessages — token counting", () => {
  const nowMs = 1767868200000;

  function runAggregation(sessions: SessionMessages[]) {
    const boundaries = computeTimeBoundaries(nowMs);
    return aggregateSessionMessages(sessions, boundaries, nowMs);
  }

  it("token.total = input + output + cacheWrite (not cacheRead)", () => {
    const data = runAggregation([
      session("s1", [
        msg({
          input: 1000,
          output: 500,
          cacheRead: 800,
          cacheWrite: 200,
          timestamp: 1767866400000,
        }),
      ]),
    ]);

    const totals = getTotals(data, "allTime");
    assert.equal(totals.tokens.total, 1700, "total = input + output + cacheWrite");
    assert.equal(totals.tokens.input, 1000);
    assert.equal(totals.tokens.output, 500);
    assert.equal(totals.tokens.cacheRead, 800);
    assert.equal(totals.tokens.cacheWrite, 200);
  });
});

// =============================================================================
// computeInsights
// =============================================================================

describe("computeInsights", () => {
  function makeRawMessage(
    overrides: Partial<RawMessage> & { sessionId: string; timestamp: number; cost: number }
  ): RawMessage {
    return {
      input: 1000,
      cacheRead: 0,
      cacheWrite: 0,
      ...overrides,
    };
  }

  function makePeriodRaw(messages: RawMessage[]): PeriodRawData {
    const sessionCosts = new Map<string, number>();
    for (const m of messages) {
      sessionCosts.set(m.sessionId, (sessionCosts.get(m.sessionId) ?? 0) + m.cost);
    }
    return { messages, sessionCosts };
  }

  it("returns empty insights for empty messages", () => {
    const raw = makePeriodRaw([]);
    const result = computeInsights(raw, new Set());
    assert.equal(result.insights.length, 0);
  });

  it("returns empty insights for zero total cost", () => {
    const raw = makePeriodRaw([
      makeRawMessage({ sessionId: "s1", timestamp: 1000, cost: 0 }),
    ]);
    const result = computeInsights(raw, new Set());
    assert.equal(result.insights.length, 0);
  });

  it("large context insight fires when input + cacheRead + cacheWrite exceeds threshold", () => {
    const raw = makePeriodRaw([
      makeRawMessage({
        sessionId: "s1",
        timestamp: 1000,
        cost: 10,
        input: 150_001, // just over LARGE_CONTEXT_THRESHOLD (150000)
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const result = computeInsights(raw, new Set());
    // Should have the large context insight
    const largeCtx = result.insights.find(
      (i) => i.headline.includes("context")
    );
    assert.ok(largeCtx, "should have large context insight");
    assert.ok(largeCtx!.percent > 0);
    assert.equal(largeCtx!.percent, 100, "100% of cost was large context");
  });

  it("large context insight does NOT fire when below threshold", () => {
    const raw = makePeriodRaw([
      makeRawMessage({
        sessionId: "s1",
        timestamp: 1000,
        cost: 10,
        input: 149_999,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const result = computeInsights(raw, new Set());
    const largeCtx = result.insights.find(
      (i) => i.headline.includes("context")
    );
    assert.ok(!largeCtx, "should NOT have large context insight when below threshold");
  });

  it("parallel sessions insight fires when enough sessions active in window", () => {
    // Create 4 sessions with enough messages (>MIN_MESSAGES_FOR_PARALLEL_INSIGHT=10) within a small time window
    // Use 4 sessions (>= PARALLEL_SESSION_THRESHOLD) with 4 messages each = 16 total
    const baseTime = 1000000;
    const messages: RawMessage[] = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        messages.push(
          makeRawMessage({
            sessionId: `session-${i}`,
            timestamp: baseTime + (i * 4 + j) * 1000, // within the PARALLEL_WINDOW_MS (2 min)
            cost: 1,
            input: 1000 + j, // different token counts per message
          })
        );
      }
    }

    const raw = makePeriodRaw(messages);
    const result = computeInsights(raw, new Set());
    const parallel = result.insights.find((i) => i.headline.includes("parallel"));
    assert.ok(parallel, "should have parallel sessions insight");
    assert.ok(parallel!.percent > 0);
  });

  it("parallel sessions insight does NOT fire with too few sessions", () => {
    // Only 3 sessions = below PARALLEL_SESSION_THRESHOLD (4)
    const baseTime = 1000000;
    const messages: RawMessage[] = [];
    for (let i = 0; i < 3; i++) {
      messages.push(
        makeRawMessage({
          sessionId: `session-${i}`,
          timestamp: baseTime + i * 1000,
          cost: 1,
          input: 1000,
        })
      );
    }

    const raw = makePeriodRaw(messages);
    const result = computeInsights(raw, new Set());
    const parallel = result.insights.find((i) => i.headline.includes("parallel"));
    assert.ok(!parallel, "should NOT fire with only 3 sessions");
  });

  it("long session insight fires for sessions spanning 8+ hours", () => {
    const raw = makePeriodRaw([
      makeRawMessage({
        sessionId: "long-runner",
        timestamp: 1000,
        cost: 10,
        input: 1000,
      }),
    ]);

    const longSessionIds = new Set<string>(["long-runner"]);
    const result = computeInsights(raw, longSessionIds);
    const longSess = result.insights.find((i) => i.headline.includes("8+ hours"));
    assert.ok(longSess, "should have long session insight");
    assert.equal(longSess!.percent, 100);
  });

  it("top N session concentration insight fires when many sessions", () => {
    const messages: RawMessage[] = [];
    // Create 10 sessions with varying costs
    for (let i = 0; i < 10; i++) {
      messages.push(
        makeRawMessage({
          sessionId: `session-${i}`,
          timestamp: 1000 + i * 1000,
          cost: i + 1, // session-0 = $1, session-9 = $10
          input: 1000,
        })
      );
    }

    const raw = makePeriodRaw(messages);
    const result = computeInsights(raw, new Set());
    const topN = result.insights.find((i) => i.headline.includes("top"));
    assert.ok(topN, "should have top-N concentration insight");
  });

  it("insights are sorted by percent descending", () => {
    const messages: RawMessage[] = [];
    // Create many sessions for parallel + top-N, plus one large-context message
    const baseTime = 1000000;
    for (let i = 0; i < 6; i++) {
      messages.push(
        makeRawMessage({
          sessionId: `session-${i}`,
          timestamp: baseTime + i * 1000,
          cost: i === 0 ? 50 : 1, // session-0 dominates
          input: i === 0 ? 200_000 : 100, // only session-0 is large context
        })
      );
    }

    const raw = makePeriodRaw(messages);
    const result = computeInsights(raw, new Set());
    assert.ok(result.insights.length > 0);
    // Check sorted descending
    for (let i = 1; i < result.insights.length; i++) {
      assert.ok(
        result.insights[i - 1]!.percent >= result.insights[i]!.percent,
        `insights should be sorted descending: ${result.insights[i - 1]!.percent} vs ${result.insights[i]!.percent}`
      );
    }
  });

  it("insights below MIN_PERCENT_TO_SHOW are filtered out", () => {
    // A single message with 50 tokens — parallel won't fire (not enough sessions),
    // large context won't fire (below threshold), long session won't fire
    const raw = makePeriodRaw([
      makeRawMessage({
        sessionId: "s1",
        timestamp: 1000,
        cost: 1,
        input: 100,
      }),
    ]);

    const result = computeInsights(raw, new Set());
    // Only items with percent >= MIN_PERCENT_TO_SHOW (1%) should appear
    for (const ins of result.insights) {
      assert.ok(ins.percent >= 1, `insight "${ins.headline}" should be >= 1%`);
    }
  });
});
