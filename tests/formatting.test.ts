import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCost,
  formatTokens,
  formatNumber,
  formatCostFixed3,
  formatScopeLabel,
  formatThresholdTokens,
  formatInsightPercent,
} from "../formatting.js";

// =============================================================================
// formatCost
// =============================================================================

describe("formatCost", () => {
  it("returns '-' for zero", () => {
    assert.equal(formatCost(0), "-");
  });

  it("returns '-' for negative zero", () => {
    assert.equal(formatCost(-0), "-");
  });

  it("shows 4 decimal places for sub-cent values", () => {
    assert.equal(formatCost(0.0001), "$0.0001");
    assert.equal(formatCost(0.0099), "$0.0099");
  });

  it("shows 2 decimal places for values under $1", () => {
    assert.equal(formatCost(0.01), "$0.01");
    assert.equal(formatCost(0.99), "$0.99");
  });

  it("shows 2 decimal places for values under $10", () => {
    assert.equal(formatCost(1), "$1.00");
    assert.equal(formatCost(9.99), "$9.99");
  });

  it("shows 2 decimal places for values under $10 (no rounding to 1 decimal)", () => {
    // Values >= 1 and < 10 show 2 decimal places
    assert.equal(formatCost(5.67), "$5.67");
  });

  it("shows 1 decimal place for values under $100", () => {
    assert.equal(formatCost(10), "$10.0");
    assert.equal(formatCost(99.0), "$99.0");
    assert.equal(formatCost(99.99), "$100.0"); // rounds up at 1 decimal
  });

  it("shows rounded integer for values $100 and above", () => {
    assert.equal(formatCost(100), "$100");
    assert.equal(formatCost(100.4), "$100");
    assert.equal(formatCost(100.5), "$101");
  });

  it("handles very large values", () => {
    assert.equal(formatCost(999999), "$999999");
    assert.equal(formatCost(1000000), "$1000000");
  });

  it("handles values just above zero", () => {
    assert.equal(formatCost(0.00009), "$0.0001"); // rounds up
    assert.equal(formatCost(0.00001), "$0.0000");
  });
});

// =============================================================================
// formatTokens
// =============================================================================

describe("formatTokens", () => {
  it("returns '-' for zero", () => {
    assert.equal(formatTokens(0), "-");
  });

  it("returns the raw number for small counts", () => {
    assert.equal(formatTokens(1), "1");
    assert.equal(formatTokens(999), "999");
  });

  it("shows 1 decimal place for thousands under 10k", () => {
    assert.equal(formatTokens(1000), "1.0k");
    assert.equal(formatTokens(1500), "1.5k");
    assert.equal(formatTokens(9999), "10.0k");
  });

  it("shows rounded integer k for 10k to under 1M", () => {
    assert.equal(formatTokens(10000), "10k");
    assert.equal(formatTokens(15500), "16k");
    assert.equal(formatTokens(999999), "1000k");
  });

  it("shows 1 decimal place for millions under 10M", () => {
    assert.equal(formatTokens(1000000), "1.0M");
    assert.equal(formatTokens(1500000), "1.5M");
    assert.equal(formatTokens(9999999), "10.0M");
  });

  it("shows rounded integer M for 10M and above", () => {
    assert.equal(formatTokens(10000000), "10M");
    assert.equal(formatTokens(99999999), "100M");
  });
});

// =============================================================================
// formatNumber
// =============================================================================

describe("formatNumber", () => {
  it("returns '-' for zero", () => {
    assert.equal(formatNumber(0), "-");
  });

  it("returns locale-formatted numbers for positive values", () => {
    assert.equal(formatNumber(1), "1");
    assert.equal(formatNumber(1000), "1,000");
    assert.equal(formatNumber(1000000), "1,000,000");
  });
});

// =============================================================================
// formatCostFixed3
// =============================================================================

describe("formatCostFixed3", () => {
  it("returns '-' for zero", () => {
    assert.equal(formatCostFixed3(0), "-");
  });

  it("shows 3 decimal places for non-zero values", () => {
    assert.equal(formatCostFixed3(0.001), "$0.001");
    assert.equal(formatCostFixed3(1.5), "$1.500");
    assert.equal(formatCostFixed3(100), "$100.000");
  });
});

// =============================================================================
// formatScopeLabel
// =============================================================================

describe("formatScopeLabel", () => {
  it("returns readable labels for all scopes", () => {
    assert.equal(formatScopeLabel("lastHour"), "Last Hour");
    assert.equal(formatScopeLabel("today"), "Today");
    assert.equal(formatScopeLabel("yesterday"), "Yesterday");
    assert.equal(formatScopeLabel("thisWeek"), "This Week");
    assert.equal(formatScopeLabel("lastWeek"), "Last Week");
    assert.equal(formatScopeLabel("thisMonth"), "This Month");
    assert.equal(formatScopeLabel("allTime"), "All Time");
  });
});

// =============================================================================
// formatThresholdTokens
// =============================================================================

describe("formatThresholdTokens", () => {
  it("returns the raw number for small values", () => {
    assert.equal(formatThresholdTokens(100), "100");
    assert.equal(formatThresholdTokens(999), "999");
  });

  it("returns k for thousands", () => {
    assert.equal(formatThresholdTokens(1000), "1k");
    assert.equal(formatThresholdTokens(150000), "150k");
    assert.equal(formatThresholdTokens(999999), "999.999k");
  });

  it("returns M for millions", () => {
    assert.equal(formatThresholdTokens(1000000), "1M");
    assert.equal(formatThresholdTokens(5000000), "5M");
  });
});

// =============================================================================
// formatInsightPercent
// =============================================================================

describe("formatInsightPercent", () => {
  it("returns rounded percentage for values >= 10", () => {
    assert.equal(formatInsightPercent(10), "10%");
    assert.equal(formatInsightPercent(25.6), "26%");
  });

  it("returns 1 decimal place for values < 10", () => {
    assert.equal(formatInsightPercent(5.12), "5.1%");
    assert.equal(formatInsightPercent(1.0), "1%"); // 1.0 → "1%"
    assert.equal(formatInsightPercent(1.1), "1.1%");
  });

  it("handles zero", () => {
    assert.equal(formatInsightPercent(0), "0%");
  });
});
