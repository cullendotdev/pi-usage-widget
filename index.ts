/**
 * /usage - Usage statistics dashboard
 *
 * Shows an inline view with usage stats grouped by provider.
 * - Tab cycles: Today → This Week → Last Week → All Time
 * - Arrow keys navigate providers
 * - Enter expands/collapses to show models
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { CancellableLoader, Container, Spacer, matchesKey, visibleWidth, truncateToWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// =============================================================================
// Types
// =============================================================================

interface TokenStats {
	total: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

interface BaseStats {
	messages: number;
	cost: number;
	tokens: TokenStats;
}

interface ModelStats extends BaseStats {
	sessions: Set<string>;
}

interface ProviderStats extends BaseStats {
	sessions: Set<string>;
	models: Map<string, ModelStats>;
}

interface TotalStats extends BaseStats {
	sessions: number;
}

interface Insight {
	percent: number; // 0-100
	headline: string;
	advice: string;
}

interface PeriodInsights {
	insights: Insight[];
}

interface RawMessage {
	sessionId: string;
	timestamp: number;
	cost: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
}

interface PeriodRawData {
	messages: RawMessage[];
	sessionCosts: Map<string, number>;
}

interface GlobalSessionSpan {
	startMs: number;
	endMs: number;
}

interface TimeFilteredStats {
	providers: Map<string, ProviderStats>;
	totals: TotalStats;
	insights: PeriodInsights;
}

interface UsageData {
	lastHour: TimeFilteredStats;
	today: TimeFilteredStats;
	yesterday: TimeFilteredStats;
	thisWeek: TimeFilteredStats;
	lastWeek: TimeFilteredStats;
	thisMonth: TimeFilteredStats;
	allTime: TimeFilteredStats;
}

type TabName = "today" | "thisWeek" | "lastWeek" | "allTime";
type ViewMode = "table" | "insights";

type TimeScope = "lastHour" | "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "allTime";

// Display modes for the footer widget
type DisplayMode = "summary" | "compact" | "detailed-collapsed" | "detailed-expanded" | "hidden";

// =============================================================================
// Column Configuration
// =============================================================================

interface DataColumn {
	label: string;
	width: number;
	dimmed?: boolean;
	getValue: (stats: BaseStats & { sessions: Set<string> | number }) => string;
}

interface TableLayoutCandidate {
	columns: DataColumn[];
	minNameWidth: number;
	compact?: boolean;
}

interface TableLayout {
	columns: DataColumn[];
	nameWidth: number;
	tableWidth: number;
	compact: boolean;
}

const MAX_NAME_COL_WIDTH = 26;

const SESSIONS_COLUMN: DataColumn = {
	label: "Sessions",
	width: 9,
	getValue: (s) => formatNumber(typeof s.sessions === "number" ? s.sessions : s.sessions.size),
};

const MSGS_COLUMN: DataColumn = {
	label: "Msgs",
	width: 9,
	getValue: (s) => formatNumber(s.messages),
};

const COST_COLUMN: DataColumn = {
	label: "Cost",
	width: 9,
	getValue: (s) => formatCost(s.cost),
};

const TOKENS_COLUMN: DataColumn = {
	label: "Tokens",
	width: 9,
	getValue: (s) => formatTokens(s.tokens.total),
};

const INPUT_COLUMN: DataColumn = {
	label: "↑In",
	width: 8,
	dimmed: true,
	// Include cacheWrite so this reflects fresh input tokens sent this turn,
	// even for providers like Anthropic that split cached prompt creation out
	// from the regular input token count.
	getValue: (s) => formatTokens(s.tokens.input + s.tokens.cacheWrite),
};

const OUTPUT_COLUMN: DataColumn = {
	label: "↓Out",
	width: 8,
	dimmed: true,
	getValue: (s) => formatTokens(s.tokens.output),
};

const CACHE_COLUMN: DataColumn = {
	label: "Cache",
	width: 8,
	dimmed: true,
	getValue: (s) => formatTokens(s.tokens.cacheRead + s.tokens.cacheWrite),
};

const FULL_DATA_COLUMNS: DataColumn[] = [
	SESSIONS_COLUMN,
	MSGS_COLUMN,
	COST_COLUMN,
	TOKENS_COLUMN,
	INPUT_COLUMN,
	OUTPUT_COLUMN,
	CACHE_COLUMN,
];

const TABLE_LAYOUTS: TableLayoutCandidate[] = [
	{ columns: FULL_DATA_COLUMNS, minNameWidth: MAX_NAME_COL_WIDTH },
	{ columns: [SESSIONS_COLUMN, MSGS_COLUMN, COST_COLUMN, TOKENS_COLUMN], minNameWidth: 14, compact: true },
	{ columns: [SESSIONS_COLUMN, COST_COLUMN, TOKENS_COLUMN], minNameWidth: 12, compact: true },
	{ columns: [COST_COLUMN, TOKENS_COLUMN], minNameWidth: 10, compact: true },
	{ columns: [COST_COLUMN], minNameWidth: 8, compact: true },
];

// =============================================================================
// Data Collection
// =============================================================================

function getSessionsDir(): string {
	// Replicate Pi's logic: respect PI_CODING_AGENT_DIR env var
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(agentDir, "sessions");
}

async function collectSessionFilesRecursively(dir: string, files: string[], signal?: AbortSignal): Promise<void> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (signal?.aborted) return;
			const entryPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				await collectSessionFilesRecursively(entryPath, files, signal);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				files.push(entryPath);
			}
		}
	} catch {
		// Skip directories we can't read
	}
}

async function getAllSessionFiles(signal?: AbortSignal): Promise<string[]> {
	const files: string[] = [];
	await collectSessionFilesRecursively(getSessionsDir(), files, signal);
	files.sort();
	return files;
}

interface SessionMessage {
	provider: string;
	model: string;
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	timestamp: number;
}

interface ParsedSessionFile {
	sessionId: string;
	messages: SessionMessage[];
}

async function parseSessionFile(
	filePath: string,
	seenHashes: Set<string>,
	signal?: AbortSignal
): Promise<ParsedSessionFile | null> {
	try {
		const content = await readFile(filePath, "utf8");
		if (signal?.aborted) return null;
		const lines = content.trim().split("\n");
		const messages: SessionMessage[] = [];
		let sessionId = "";

		for (let i = 0; i < lines.length; i++) {
			if (signal?.aborted) return null;
			if (i % 500 === 0) {
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
			const line = lines[i]!;
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);

				if (entry.type === "session") {
					sessionId = entry.id;
				} else if (entry.type === "message" && entry.message?.role === "assistant") {
					const msg = entry.message;
					if (msg.usage && msg.provider && msg.model) {
						const input = msg.usage.input || 0;
						const output = msg.usage.output || 0;
						const cacheRead = msg.usage.cacheRead || 0;
						const cacheWrite = msg.usage.cacheWrite || 0;
						const fallbackTs = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
						const timestamp = msg.timestamp || (Number.isNaN(fallbackTs) ? 0 : fallbackTs);

						// Deduplicate copied history across branched session files.
						// Keep the existing ccusage-style hash so current totals remain comparable.
						const totalTokens = input + output + cacheRead + cacheWrite;
						const hash = `${timestamp}:${totalTokens}`;
						if (seenHashes.has(hash)) continue;
						seenHashes.add(hash);

						messages.push({
							provider: msg.provider,
							model: msg.model,
							cost: msg.usage.cost?.total || 0,
							input,
							output,
							cacheRead,
							cacheWrite,
							timestamp,
						});
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		return sessionId ? { sessionId, messages } : null;
	} catch {
		return null;
	}
}

// Helper to accumulate stats into a target
function accumulateStats(
	target: BaseStats,
	cost: number,
	tokens: { total: number; input: number; output: number; cacheRead: number; cacheWrite: number }
): void {
	target.messages++;
	target.cost += cost;
	target.tokens.total += tokens.total;
	target.tokens.input += tokens.input;
	target.tokens.output += tokens.output;
	target.tokens.cacheRead += tokens.cacheRead;
	target.tokens.cacheWrite += tokens.cacheWrite;
}

function emptyTokens(): TokenStats {
	return { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function emptyModelStats(): ModelStats {
	return { sessions: new Set(), messages: 0, cost: 0, tokens: emptyTokens() };
}

function emptyProviderStats(): ProviderStats {
	return { sessions: new Set(), messages: 0, cost: 0, tokens: emptyTokens(), models: new Map() };
}

function emptyTimeFilteredStats(): TimeFilteredStats {
	return {
		providers: new Map(),
		totals: { sessions: 0, messages: 0, cost: 0, tokens: emptyTokens() },
		insights: { insights: [] },
	};
}

function emptyPeriodRawData(): PeriodRawData {
	return { messages: [], sessionCosts: new Map() };
}

function emptyUsageData(): UsageData {
	return {
		lastHour: emptyTimeFilteredStats(),
		today: emptyTimeFilteredStats(),
		yesterday: emptyTimeFilteredStats(),
		thisWeek: emptyTimeFilteredStats(),
		lastWeek: emptyTimeFilteredStats(),
		thisMonth: emptyTimeFilteredStats(),
		allTime: emptyTimeFilteredStats(),
	};
}

function addMessagesToUsageData(
	data: UsageData,
	sessionId: string,
	messages: SessionMessage[],
	nowMs: number,
	todayMs: number,
	yesterdayMs: number,
	weekStartMs: number,
	lastWeekStartMs: number,
	monthStartMs: number,
	lastHourMs: number,
	rawByPeriod: Record<string, PeriodRawData>,
	globalSessionSpans: Map<string, GlobalSessionSpan>
): void {
	const sessionContributed: Record<string, boolean> = {
		lastHour: false,
		today: false,
		yesterday: false,
		thisWeek: false,
		lastWeek: false,
		thisMonth: false,
		allTime: false,
	};

	for (const msg of messages) {
		// Track real per-session lifetime across every message we see, regardless of
		// which period the message falls into. Used later for the "8h+ session" insight.
		if (msg.timestamp > 0) {
			const span = globalSessionSpans.get(sessionId);
			if (!span) {
				globalSessionSpans.set(sessionId, { startMs: msg.timestamp, endMs: msg.timestamp });
			} else {
				if (msg.timestamp < span.startMs) span.startMs = msg.timestamp;
				if (msg.timestamp > span.endMs) span.endMs = msg.timestamp;
			}
		}

		const tokens = {
			// Count fresh tokens processed this turn.
			// Include cacheWrite because those prompt tokens were newly written and billed.
			// Exclude cacheRead because repeated cache hits would otherwise dominate totals.
			total: msg.input + msg.output + msg.cacheWrite,
			input: msg.input,
			output: msg.output,
			cacheRead: msg.cacheRead,
			cacheWrite: msg.cacheWrite,
		};

		// Determine which scopes this message belongs to
		const scopes: string[] = [];
		if (msg.timestamp >= lastHourMs) scopes.push("lastHour");
		if (msg.timestamp >= todayMs) scopes.push("today");
		if (msg.timestamp >= yesterdayMs && msg.timestamp < todayMs) scopes.push("yesterday");
		if (msg.timestamp >= weekStartMs) scopes.push("thisWeek");
		if (msg.timestamp >= lastWeekStartMs && msg.timestamp < weekStartMs) scopes.push("lastWeek");
		if (msg.timestamp >= monthStartMs) scopes.push("thisMonth");
		scopes.push("allTime");

		for (const scope of scopes) {
			const stats = data[scope as keyof UsageData] as TimeFilteredStats;

			let providerStats = stats.providers.get(msg.provider);
			if (!providerStats) {
				providerStats = emptyProviderStats();
				stats.providers.set(msg.provider, providerStats);
			}

			let modelStats = providerStats.models.get(msg.model);
			if (!modelStats) {
				modelStats = emptyModelStats();
				providerStats.models.set(msg.model, modelStats);
			}

			modelStats.sessions.add(sessionId);
			accumulateStats(modelStats, msg.cost, tokens);

			providerStats.sessions.add(sessionId);
			accumulateStats(providerStats, msg.cost, tokens);

			accumulateStats(stats.totals, msg.cost, tokens);
			sessionContributed[scope] = true;

			const raw = rawByPeriod[scope];
			if (raw) {
				raw.messages.push({
				sessionId,
				timestamp: msg.timestamp,
				cost: msg.cost,
				input: msg.input,
				cacheRead: msg.cacheRead,
				cacheWrite: msg.cacheWrite,
			});
				raw.sessionCosts.set(sessionId, (raw.sessionCosts.get(sessionId) ?? 0) + msg.cost);
			}
		}
	}

	if (sessionContributed.lastHour) data.lastHour.totals.sessions++;
	if (sessionContributed.today) data.today.totals.sessions++;
	if (sessionContributed.yesterday) data.yesterday.totals.sessions++;
	if (sessionContributed.thisWeek) data.thisWeek.totals.sessions++;
	if (sessionContributed.lastWeek) data.lastWeek.totals.sessions++;
	if (sessionContributed.thisMonth) data.thisMonth.totals.sessions++;
	if (sessionContributed.allTime) data.allTime.totals.sessions++;
}

async function collectUsageData(signal?: AbortSignal): Promise<UsageData | null> {
	const nowMs = Date.now();

	// Boundary timestamps for all scopes
	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);
	const todayMs = startOfToday.getTime();

	const startOfYesterday = new Date(startOfToday);
	startOfYesterday.setDate(startOfYesterday.getDate() - 1);
	const yesterdayMs = startOfYesterday.getTime();

	// Start of current week (Monday 00:00)
	const startOfWeek = new Date();
	const dayOfWeek = startOfWeek.getDay(); // 0 = Sunday, 1 = Monday, ...
	const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
	startOfWeek.setDate(startOfWeek.getDate() - daysSinceMonday);
	startOfWeek.setHours(0, 0, 0, 0);
	const weekStartMs = startOfWeek.getTime();

	// Start of last week (previous Monday 00:00)
	const startOfLastWeek = new Date(startOfWeek);
	startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
	const lastWeekStartMs = startOfLastWeek.getTime();

	// Start of this month (1st at 00:00)
	const startOfMonth = new Date();
	startOfMonth.setDate(1);
	startOfMonth.setHours(0, 0, 0, 0);
	const monthStartMs = startOfMonth.getTime();

	// Last hour
	const lastHourMs = nowMs - 60 * 60 * 1000;

	const data = emptyUsageData();
	const rawByPeriod: Record<string, PeriodRawData> = {
		lastHour: emptyPeriodRawData(),
		today: emptyPeriodRawData(),
		yesterday: emptyPeriodRawData(),
		thisWeek: emptyPeriodRawData(),
		lastWeek: emptyPeriodRawData(),
		thisMonth: emptyPeriodRawData(),
		allTime: emptyPeriodRawData(),
	};
	const globalSessionSpans = new Map<string, GlobalSessionSpan>();

	const sessionFiles = await getAllSessionFiles(signal);
	if (signal?.aborted) return null;
	const seenHashes = new Set<string>();

	for (const filePath of sessionFiles) {
		if (signal?.aborted) return null;
		const parsed = await parseSessionFile(filePath, seenHashes, signal);
		if (signal?.aborted) return null;
		if (!parsed) continue;

		addMessagesToUsageData(
			data,
			parsed.sessionId,
			parsed.messages,
			nowMs,
			todayMs,
			yesterdayMs,
			weekStartMs,
			lastWeekStartMs,
			monthStartMs,
			lastHourMs,
			rawByPeriod,
			globalSessionSpans
		);

		await new Promise<void>((resolve) => setImmediate(resolve));
	}

	// Classify sessions that are globally long-running once, then reuse across periods.
	const longSessionIds = new Set<string>();
	for (const [id, span] of globalSessionSpans) {
		if (span.endMs - span.startMs >= LONG_SESSION_MS) longSessionIds.add(id);
	}

	for (const period of SCOPE_ORDER) {
		const raw = rawByPeriod[period];
		if (raw) {
			(data[period as keyof UsageData] as TimeFilteredStats).insights = computeInsights(raw, longSessionIds);
		}
	}

	return data;
}

// =============================================================================
// Insights
// =============================================================================

const PARALLEL_WINDOW_MS = 2 * 60_000; // exact ±N milliseconds around each message
const PARALLEL_SESSION_THRESHOLD = 4;
const LARGE_CONTEXT_THRESHOLD = 150_000;
const LARGE_CACHE_MISS_THRESHOLD = 100_000;
const LONG_SESSION_MS = 8 * 60 * 60 * 1000;
const TOP_SESSION_COUNT = 5;
const MIN_MESSAGES_FOR_PARALLEL_INSIGHT = 10;
const MIN_PERCENT_TO_SHOW = 1;

/**
 * Insights are weighted by recorded API cost. Periods with zero total cost produce
 * an empty `insights` list — the UI renders a distinct empty-state for that case.
 * Long-running-session classification is passed in from a global pass so that a
 * session's real lifetime is used rather than the slice visible inside this period.
 */
function computeInsights(raw: PeriodRawData, longSessionIds: Set<string>): PeriodInsights {
	if (raw.messages.length === 0) {
		return { insights: [] };
	}

	const total = raw.messages.reduce((sum, m) => sum + m.cost, 0);
	if (total <= 0) {
		return { insights: [] };
	}

	const candidates: Insight[] = [];

	// 1. Parallel sessions — ≥ N unique sessions active within an exact ±W ms window.
	const parallelWeight = computeParallelCostWeight(raw.messages);
	if (parallelWeight !== null) {
		candidates.push({
			percent: (parallelWeight / total) * 100,
			headline: `of your cost was while ${PARALLEL_SESSION_THRESHOLD}+ sessions ran in parallel`,
			advice:
				"All sessions share one rate limit. If you don't need them all at once, queueing uses capacity more evenly.",
		});
	}

	// 2. Large context — input + cacheRead + cacheWrite > threshold.
	const largeContextWeight = raw.messages
		.filter((m) => m.input + m.cacheRead + m.cacheWrite > LARGE_CONTEXT_THRESHOLD)
		.reduce((sum, m) => sum + m.cost, 0);
	candidates.push({
		percent: (largeContextWeight / total) * 100,
		headline: `of your cost was at >${formatThresholdTokens(LARGE_CONTEXT_THRESHOLD)} context`,
		advice:
			"Longer sessions are more expensive even when cached. /compact mid-task, /clear when switching to new tasks.",
	});

	// 3. Large uncached prompt — fresh (non-cached) input > threshold, per the v0.2.0 formula.
	const uncachedWeight = raw.messages
		.filter((m) => m.input + m.cacheWrite > LARGE_CACHE_MISS_THRESHOLD)
		.reduce((sum, m) => sum + m.cost, 0);
	candidates.push({
		percent: (uncachedWeight / total) * 100,
		headline: `of your cost came from >${formatThresholdTokens(LARGE_CACHE_MISS_THRESHOLD)}-token uncached prompts`,
		advice:
			"Uncached input is expensive, and often happens when sending a message to a session that has gone idle. /compact before stepping away keeps the cold-start small.",
	});

	// 4. Long-running sessions — classification comes from the global pass so we use
	//    true session lifetime, not just the span visible inside this period slice.
	const longWeight = raw.messages
		.filter((m) => longSessionIds.has(m.sessionId))
		.reduce((sum, m) => sum + m.cost, 0);
	if (longWeight > 0) {
		candidates.push({
			percent: (longWeight / total) * 100,
			headline: `of your cost came from sessions active for ${LONG_SESSION_MS / 3_600_000}+ hours`,
			advice:
				"These are often background/loop sessions. Continuous usage can add up quickly so make sure it is intentional.",
		});
	}

	// 5. Top-N session concentration.
	if (raw.sessionCosts.size > TOP_SESSION_COUNT) {
		const sortedSessions = Array.from(raw.sessionCosts.values()).sort((a, b) => b - a);
		const topN = Math.min(TOP_SESSION_COUNT, sortedSessions.length);
		const topWeight = sortedSessions.slice(0, topN).reduce((sum, c) => sum + c, 0);
		candidates.push({
			percent: (topWeight / total) * 100,
			headline: `of your cost came from your top ${topN} session${topN === 1 ? "" : "s"}`,
			advice:
				"A small number of sessions drives most of your spend. The table view can help pinpoint which ones.",
		});
	}

	const insights = candidates.filter((i) => i.percent >= MIN_PERCENT_TO_SHOW).sort((a, b) => b.percent - a.percent);
	return { insights };
}

/**
 * Two-pointer sweep of messages sorted by timestamp. For each message, count the
 * number of distinct session IDs whose messages fall within an exact ± window.
 * Returns the total cost attributable to moments when ≥ threshold sessions were
 * active, or null if the period has too few sessions/messages to call it.
 *
 * Messages with missing/invalid timestamps (parsed as 0) are filtered out first —
 * otherwise they would collapse into a single synthetic instant and inflate the
 * parallel count on older or incomplete logs.
 */
function computeParallelCostWeight(messages: RawMessage[]): number | null {
	const timed = messages.filter((m) => m.timestamp > 0);
	if (timed.length < MIN_MESSAGES_FOR_PARALLEL_INSIGHT) return null;
	const distinctSessions = new Set(timed.map((m) => m.sessionId));
	if (distinctSessions.size < PARALLEL_SESSION_THRESHOLD) return null;

	const sorted = timed.slice().sort((a, b) => a.timestamp - b.timestamp);
	const sidCount = new Map<string, number>();
	let uniqueCount = 0;
	let left = 0;
	let right = 0;
	let parallelCost = 0;

	for (let i = 0; i < sorted.length; i++) {
		const current = sorted[i]!;
		const high = current.timestamp + PARALLEL_WINDOW_MS;
		const low = current.timestamp - PARALLEL_WINDOW_MS;

		while (right < sorted.length && sorted[right]!.timestamp <= high) {
			const sid = sorted[right]!.sessionId;
			const next = (sidCount.get(sid) ?? 0) + 1;
			sidCount.set(sid, next);
			if (next === 1) uniqueCount++;
			right++;
		}
		while (left < right && sorted[left]!.timestamp < low) {
			const sid = sorted[left]!.sessionId;
			const next = (sidCount.get(sid) ?? 0) - 1;
			if (next === 0) {
				sidCount.delete(sid);
				uniqueCount--;
			} else {
				sidCount.set(sid, next);
			}
			left++;
		}

		if (uniqueCount >= PARALLEL_SESSION_THRESHOLD) parallelCost += current.cost;
	}

	return parallelCost;
}

function formatThresholdTokens(n: number): string {
	if (n >= 1_000_000) return `${n / 1_000_000}M`;
	if (n >= 1_000) return `${n / 1_000}k`;
	return String(n);
}

function formatInsightPercent(p: number): string {
	if (p >= 10) return `${Math.round(p)}%`;
	return `${Math.round(p * 10) / 10}%`;
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatCost(cost: number): string {
	if (cost === 0) return "-";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	if (cost < 1) return `$${cost.toFixed(2)}`;
	if (cost < 10) return `$${cost.toFixed(2)}`;
	if (cost < 100) return `$${cost.toFixed(1)}`;
	return `$${Math.round(cost)}`;
}

function formatTokens(count: number): string {
	if (count === 0) return "-";
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatNumber(n: number): string {
	if (n === 0) return "-";
	return n.toLocaleString();
}

function formatCostFixed3(cost: number): string {
	if (cost === 0) return "-";
	return `$${cost.toFixed(3)}`;
}

function formatScopeLabel(scope: TimeScope): string {
	switch (scope) {
		case "lastHour":
			return "Last Hour";
		case "today":
			return "Today";
		case "yesterday":
			return "Yesterday";
		case "thisWeek":
			return "This Week";
		case "lastWeek":
			return "Last Week";
		case "thisMonth":
			return "This Month";
		case "allTime":
			return "All Time";
	}
}

function padLeft(s: string, len: number): string {
	const vis = visibleWidth(s);
	if (vis >= len) return s;
	return " ".repeat(len - vis) + s;
}

function padRight(s: string, len: number): string {
	const vis = visibleWidth(s);
	if (vis >= len) return s;
	return s + " ".repeat(len - vis);
}

function sumColumnWidths(columns: DataColumn[]): number {
	return columns.reduce((sum, col) => sum + col.width, 0);
}

function fitCell(s: string, len: number, align: "left" | "right" = "left"): string {
	if (len <= 0) return "";
	const truncated = truncateToWidth(s, len);
	return align === "right" ? padLeft(truncated, len) : padRight(truncated, len);
}

function clampLines(lines: string[], width: number): string[] {
	return lines.map((line) => truncateToWidth(line, Math.max(width, 0)));
}

function pickFittingText(width: number, variants: string[]): string {
	for (const variant of variants) {
		if (visibleWidth(variant) <= width) return variant;
	}
	return variants[variants.length - 1] || "";
}

function getTableLayout(width: number): TableLayout {
	const safeWidth = Math.max(width, 0);

	for (const candidate of TABLE_LAYOUTS) {
		const columnsWidth = sumColumnWidths(candidate.columns);
		const nameWidth = Math.min(MAX_NAME_COL_WIDTH, Math.max(safeWidth - columnsWidth, 0));
		if (nameWidth >= candidate.minNameWidth) {
			return {
				columns: candidate.columns,
				nameWidth,
				tableWidth: nameWidth + columnsWidth,
				compact: candidate.compact ?? false,
			};
		}
	}

	const fallback = TABLE_LAYOUTS[TABLE_LAYOUTS.length - 1]!;
	const fallbackColumnsWidth = sumColumnWidths(fallback.columns);
	const fallbackNameWidth = Math.min(MAX_NAME_COL_WIDTH, Math.max(safeWidth - fallbackColumnsWidth, 0));
	return {
		columns: fallback.columns,
		nameWidth: fallbackNameWidth,
		tableWidth: fallbackNameWidth + fallbackColumnsWidth,
		compact: fallback.compact ?? false,
	};
}

// Widget-specific cost column (3 decimal places)
const WIDGET_COST_COLUMN: DataColumn = {
	label: "Cost",
	width: 9,
	getValue: (s) => formatCostFixed3(s.cost),
};

const WIDGET_FULL_DATA_COLUMNS: DataColumn[] = [
	SESSIONS_COLUMN,
	MSGS_COLUMN,
	WIDGET_COST_COLUMN,
	TOKENS_COLUMN,
	INPUT_COLUMN,
	OUTPUT_COLUMN,
	CACHE_COLUMN,
];

const WIDGET_TABLE_LAYOUTS: TableLayoutCandidate[] = [
	{ columns: WIDGET_FULL_DATA_COLUMNS, minNameWidth: MAX_NAME_COL_WIDTH },
	{ columns: [SESSIONS_COLUMN, MSGS_COLUMN, WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 14, compact: true },
	{ columns: [SESSIONS_COLUMN, WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 12, compact: true },
	{ columns: [WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 10, compact: true },
	{ columns: [WIDGET_COST_COLUMN], minNameWidth: 8, compact: true },
];

function getWidgetTableLayout(width: number): TableLayout {
	const safeWidth = Math.max(width, 0);

	for (const candidate of WIDGET_TABLE_LAYOUTS) {
		const columnsWidth = sumColumnWidths(candidate.columns);
		const nameWidth = Math.min(MAX_NAME_COL_WIDTH, Math.max(safeWidth - columnsWidth, 0));
		if (nameWidth >= candidate.minNameWidth) {
			return {
				columns: candidate.columns,
				nameWidth,
				tableWidth: nameWidth + columnsWidth,
				compact: candidate.compact ?? false,
			};
		}
	}

	const fallback = WIDGET_TABLE_LAYOUTS[WIDGET_TABLE_LAYOUTS.length - 1]!;
	const fallbackColumnsWidth = sumColumnWidths(fallback.columns);
	const fallbackNameWidth = Math.min(MAX_NAME_COL_WIDTH, Math.max(safeWidth - fallbackColumnsWidth, 0));
	return {
		columns: fallback.columns,
		nameWidth: fallbackNameWidth,
		tableWidth: fallbackNameWidth + fallbackColumnsWidth,
		compact: fallback.compact ?? false,
	};
}

// =============================================================================
// Component
// =============================================================================

const TAB_LABELS: Record<TimeScope, string> = {
	lastHour: "Last Hour",
	today: "Today",
	yesterday: "Yesterday",
	thisWeek: "This Week",
	lastWeek: "Last Week",
	thisMonth: "This Month",
	allTime: "All Time",
};

const DISPLAY_MODE_ORDER: DisplayMode[] = [
	"summary",
	"compact",
	"detailed-collapsed",
	"detailed-expanded",
	"hidden",
];

const SCOPE_ORDER: TimeScope[] = [
	"lastHour",
	"today",
	"yesterday",
	"thisWeek",
	"lastWeek",
	"thisMonth",
	"allTime",
];

const TAB_ORDER: TimeScope[] = [
	"lastHour",
	"today",
	"yesterday",
	"thisWeek",
	"lastWeek",
	"thisMonth",
	"allTime",
];

class UsageComponent {
	private activeTab: TabName = "allTime";
	private viewMode: ViewMode = "table";
	private data: UsageData;
	private selectedIndex = 0;
	private expanded = new Set<string>();
	private providerOrder: string[] = [];
	private theme: Theme;
	private requestRender: () => void;
	private done: () => void;

	constructor(theme: Theme, data: UsageData, requestRender: () => void, done: () => void) {
		this.theme = theme;
		this.requestRender = requestRender;
		this.done = done;
		this.data = data;
		this.updateProviderOrder();
	}

	private updateProviderOrder(): void {
		const stats = this.data[this.activeTab];
		this.providerOrder = Array.from(stats.providers.entries())
			.sort((a, b) => b[1].cost - a[1].cost)
			.map(([name]) => name);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.providerOrder.length - 1));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.done();
			return;
		}

		if (matchesKey(data, "v")) {
			this.viewMode = this.viewMode === "table" ? "insights" : "table";
			this.requestRender();
			return;
		}

		if (matchesKey(data, "tab") || matchesKey(data, "right")) {
			const idx = TAB_ORDER.indexOf(this.activeTab);
			this.activeTab = TAB_ORDER[(idx + 1) % TAB_ORDER.length]!;
			this.updateProviderOrder();
			this.requestRender();
		} else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
			const idx = TAB_ORDER.indexOf(this.activeTab);
			this.activeTab = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]!;
			this.updateProviderOrder();
			this.requestRender();
		} else if (this.viewMode === "table" && matchesKey(data, "up")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.requestRender();
			}
		} else if (this.viewMode === "table" && matchesKey(data, "down")) {
			if (this.selectedIndex < this.providerOrder.length - 1) {
				this.selectedIndex++;
				this.requestRender();
			}
		} else if (this.viewMode === "table" && (matchesKey(data, "enter") || matchesKey(data, "space"))) {
			const provider = this.providerOrder[this.selectedIndex];
			if (provider) {
				if (this.expanded.has(provider)) {
					this.expanded.delete(provider);
				} else {
					this.expanded.add(provider);
				}
				this.requestRender();
			}
		}
	}

	// -------------------------------------------------------------------------
	// Render Methods
	// -------------------------------------------------------------------------

	render(width: number): string[] {
		if (this.viewMode === "insights") {
			return clampLines(
				[
					...this.renderTitle(),
					...this.renderTabs(width, getTableLayout(width)),
					...this.renderInsights(width),
					...this.renderHelp(width),
				],
				width
			);
		}

		const layout = getTableLayout(width);
		return clampLines(
			[
				...this.renderTitle(),
				...this.renderTabs(width, layout),
				...this.renderHeader(layout),
				...this.renderRows(layout),
				...this.renderTotals(layout),
				...this.renderFormulaNote(width),
				...this.renderHelp(width),
			],
			width
		);
	}

	private renderTitle(): string[] {
		const th = this.theme;
		const label = this.viewMode === "insights" ? "Usage Insights" : "Usage Statistics";
		return [th.fg("accent", th.bold(label)), ""];
	}

	private renderInsights(width: number): string[] {
		const th = this.theme;
		const stats = this.data[this.activeTab];
		const { insights } = stats.insights;
		const hasMessages = stats.totals.messages > 0;
		const hasCost = stats.totals.cost > 0;
		const lines: string[] = [];

		lines.push("What's contributing to your cost?");
		lines.push(th.fg("dim", "Approximate, based on local sessions on this machine."));
		lines.push("");
		const note = `${TAB_LABELS[this.activeTab]} · weighted by cost (USD) · these overlap and can sum to >100%`;
		lines.push(th.fg("dim", note));
		lines.push("");

		if (!hasMessages) {
			lines.push(th.fg("dim", "  No usage recorded for this period."));
			lines.push("");
			return lines;
		}
		if (!hasCost) {
			lines.push(th.fg("dim", "  No cost data recorded for this period."));
			lines.push("");
			return lines;
		}
		if (insights.length === 0) {
			lines.push(th.fg("dim", "  No insights above 1% for this period."));
			lines.push("");
			return lines;
		}

		const indent = "     ";
		const adviceWidth = Math.max(width - indent.length, 30);

		for (const insight of insights) {
			const pct = th.fg("accent", th.bold(formatInsightPercent(insight.percent)));
			lines.push(`${pct} ${insight.headline}`);
			for (const wrapped of wrapTextWithAnsi(insight.advice, adviceWidth)) {
				lines.push(`${indent}${th.fg("dim", wrapped)}`);
			}
			lines.push("");
		}

		return lines;
	}

	private renderTabs(width: number, layout: TableLayout): string[] {
		const th = this.theme;
		const fullTabs = TAB_ORDER.map((tab) => {
			const label = TAB_LABELS[tab];
			return tab === this.activeTab ? th.fg("accent", `[${label}]`) : th.fg("dim", ` ${label} `);
		}).join("  ");

		const activeTabOnly = th.fg("accent", `[${TAB_LABELS[this.activeTab]}]`);
		const tabLine = pickFittingText(width, [
			fullTabs,
			`${activeTabOnly}  ${th.fg("dim", "[Tab/←→]")}`,
			activeTabOnly,
		]);

		// Compact-note only applies to the table view — it's meaningless for insights.
		const infoLines =
			this.viewMode === "table" && layout.compact
				? wrapTextWithAnsi(th.fg("dim", "Compact view. Widen the terminal for more columns."), Math.max(width, 1))
				: [];

		return [tabLine, ...infoLines, ""];
	}

	private renderHeader(layout: TableLayout): string[] {
		const th = this.theme;

		let headerLine = fitCell("Provider / Model", layout.nameWidth);
		for (const col of layout.columns) {
			const label = fitCell(col.label, col.width, "right");
			headerLine += col.dimmed ? th.fg("dim", label) : label;
		}

		return [th.fg("muted", headerLine), th.fg("border", "─".repeat(layout.tableWidth))];
	}

	private renderDataRow(
		name: string,
		stats: BaseStats & { sessions: Set<string> | number },
		layout: TableLayout,
		options: { indent?: number; selected?: boolean; dimAll?: boolean; prefix?: string } = {}
	): string {
		const th = this.theme;
		const { indent = 0, selected = false, dimAll = false, prefix } = options;

		const rawPrefix = prefix ?? " ".repeat(indent);
		const safePrefix = layout.nameWidth > 0 ? truncateToWidth(rawPrefix, layout.nameWidth, "") : "";
		const prefixWidth = visibleWidth(safePrefix);
		const innerNameWidth = Math.max(layout.nameWidth - prefixWidth, 0);
		const truncName = innerNameWidth > 0 ? truncateToWidth(name, innerNameWidth) : "";
		const styledName = selected ? th.fg("accent", truncName) : dimAll ? th.fg("dim", truncName) : truncName;

		let row = safePrefix + (innerNameWidth > 0 ? padRight(styledName, innerNameWidth) : "");

		for (const col of layout.columns) {
			const value = fitCell(col.getValue(stats), col.width, "right");
			const shouldDim = col.dimmed || dimAll;
			row += shouldDim ? th.fg("dim", value) : value;
		}

		return row;
	}

	private renderRows(layout: TableLayout): string[] {
		const th = this.theme;
		const stats = this.data[this.activeTab];
		const lines: string[] = [];

		if (this.providerOrder.length === 0) {
			lines.push(th.fg("dim", "  No usage data for this period"));
			return lines;
		}

		for (let i = 0; i < this.providerOrder.length; i++) {
			const providerName = this.providerOrder[i]!;
			const providerStats = stats.providers.get(providerName)!;
			const isSelected = i === this.selectedIndex;
			const isExpanded = this.expanded.has(providerName);
			const arrow = isExpanded ? "▾" : "▸";
			const prefix = isSelected ? th.fg("accent", `${arrow} `) : th.fg("dim", `${arrow} `);

			lines.push(
				this.renderDataRow(providerName, providerStats, layout, {
					selected: isSelected,
					prefix,
				})
			);

			if (isExpanded) {
				const models = Array.from(providerStats.models.entries()).sort((a, b) => b[1].cost - a[1].cost);

				for (const [modelName, modelStats] of models) {
					lines.push(this.renderDataRow(modelName, modelStats, layout, { indent: 4, dimAll: true }));
				}
			}
		}

		return lines;
	}

	private renderTotals(layout: TableLayout): string[] {
		const th = this.theme;
		const stats = this.data[this.activeTab];

		let totalRow = fitCell(th.bold("Total"), layout.nameWidth);
		for (const col of layout.columns) {
			const value = fitCell(col.getValue(stats.totals), col.width, "right");
			totalRow += col.dimmed ? th.fg("dim", value) : value;
		}

		return [th.fg("border", "─".repeat(layout.tableWidth)), totalRow, ""];
	}

	private renderFormulaNote(width: number): string[] {
		const line = pickFittingText(width, [
			"Tokens = Input + Output + CacheWrite  ·  ↑In = Input + CacheWrite  (as of 0.2.0)",
			"Tokens = In + Out + CacheWrite  ·  ↑In = In + CacheWrite  (v0.2.0+)",
			"Tokens & ↑In include CacheWrite (v0.2.0+)",
			"Incl. CacheWrite (v0.2.0+)",
		]);
		return [this.theme.fg("dim", line), ""];
	}

	private renderHelp(width: number): string[] {
		const variants =
			this.viewMode === "insights"
				? [
						"[Tab/←→] period  [v] table view  [q] close",
						"[Tab] period  [v] table  [q] close",
						"[v] table  [q] close",
						"[q] close",
				  ]
				: [
						"[Tab/←→] period  [↑↓] select  [Enter] expand  [v] insights  [q] close",
						"[Tab] period  [↑↓] select  [Enter] expand  [v] insights  [q] close",
						"[↑↓] select  [Enter] expand  [v] insights  [q] close",
						"[↑↓] select  [v] insights  [q] close",
						"[↑↓] select  [q] close",
						"[q] close",
				  ];
		const line = pickFittingText(width, variants);
		return [this.theme.fg("dim", line)];
	}

	invalidate(): void {}
	dispose(): void {}
}

// =============================================================================
// Widget
// =============================================================================

class UsageWidget {
	private displayMode: DisplayMode = "summary";
	private scope: TimeScope = "today";
	private usageData: UsageData | null = null;
	private theme: Theme;
	private tui: TUI | null = null;

	constructor(theme: Theme) {
		this.theme = theme;
	}

	setTui(tui: TUI): void {
		this.tui = tui;
	}

	setData(data: UsageData | null): void {
		this.usageData = data;
		this.tui?.requestRender();
	}

	setMode(mode: DisplayMode): void {
		this.displayMode = mode;
		this.tui?.requestRender();
	}

	setScope(scope: TimeScope): void {
		this.scope = scope;
		this.tui?.requestRender();
	}

	invalidate(): void {
		this.tui?.requestRender();
	}

	dispose(): void {}

	// Cycle display mode forward (wraps)
	cycleMode(): void {
		const idx = DISPLAY_MODE_ORDER.indexOf(this.displayMode);
		const next = DISPLAY_MODE_ORDER[(idx + 1) % DISPLAY_MODE_ORDER.length];
		this.setMode(next);
	}

	// Cycle scope forward (wraps)
	cycleScope(): void {
		const idx = SCOPE_ORDER.indexOf(this.scope);
		const next = SCOPE_ORDER[(idx + 1) % SCOPE_ORDER.length];
		this.setScope(next);
	}

	// Main render function returns lines to display in the widget area
	render(width: number): string[] {
		const th = this.theme;

		// Hidden mode
		if (this.displayMode === "hidden") {
			return [];
		}

		// If no data yet, show loading/empty placeholder
		if (!this.usageData) {
			return [th.fg("dim", "Usage: Loading...")];
		}

		const dataForScope = this.usageData[this.scope] as TimeFilteredStats;

		// Summary mode
		if (this.displayMode === "summary") {
			if (dataForScope.totals.messages === 0) {
				const label = formatScopeLabel(this.scope);
				return [th.fg("dim", `Usage: --- (${label})`)];
			}
			const costStr = formatCostFixed3(dataForScope.totals.cost);
			const label = formatScopeLabel(this.scope);
			return [
				th.fg("muted", "Usage: ") +
				th.fg("text", costStr) +
				th.fg("muted", ` (${label})`),
      ];
		}

		// Compact mode
		if (this.displayMode === "compact") {
			if (dataForScope.totals.messages === 0) {
				return [th.fg("dim", `Usage: --- (${formatScopeLabel(this.scope)})`)];
			}
			const lines: string[] = [];
			lines.push(th.fg("muted", `Usage: (${formatScopeLabel(this.scope)})`));
			// Sort providers by cost descending
			const providers = Array.from(dataForScope.providers.entries())
				.sort((a, b) => b[1].cost - a[0].cost);
			for (const [provider, stats] of providers) {
				const costStr = formatCostFixed3(stats.cost);
				lines.push(
					th.fg("muted", "  ") +
					th.fg("muted", provider) +
					th.fg("text", ": ") +
					th.fg("text", costStr));
			}
			return lines;
		}

		// Detailed modes (collapsed or expanded) use table rendering
		const layout = getWidgetTableLayout(width);
		const lines: string[] = [];

		// Title line with scope
		lines.push(th.fg("muted", `Usage: (${formatScopeLabel(this.scope)})`));

		// Header
		lines.push(...this.renderTableHeader(width, layout));

		// Rows
		const providerOrder = Array.from(dataForScope.providers.entries())
			.sort((a, b) => b[1].cost - a[0].cost)
			.map(([name]) => name);

		if (providerOrder.length === 0) {
			lines.push(th.fg("dim", "  No usage data for this period"));
		} else {
			for (let i = 0; i < providerOrder.length; i++) {
				const providerName = providerOrder[i]!;
				const providerStats = dataForScope.providers.get(providerName)!;
				const isExpanded = this.displayMode === "detailed-expanded";
				const arrow = isExpanded ? "▾" : "▸";
				const prefix = th.fg("dim", `${arrow} `);
				lines.push(
					this.renderDataRow(providerName, providerStats, layout, {
						prefix,
					})
				);

				if (isExpanded) {
					const models = Array.from(providerStats.models.entries())
						.sort((a, b) => b[1].cost - a[0].cost);
					for (const [modelName, modelStats] of models) {
						lines.push(
							this.renderDataRow(modelName, modelStats, layout, {
							indent: 4,
							dimAll: true,
						})
					);
					}
				}
			}
		}

		// Totals
		lines.push(...this.renderTotals(layout));

		// Formula note
		lines.push(...this.renderFormulaNote(width));

		return lines;
	}

	private renderTableHeader(width: number, layout: TableLayout): string[] {
		const th = this.theme;
		let headerLine = fitCell("Provider / Model", layout.nameWidth);
		for (const col of layout.columns) {
			const label = fitCell(col.label, col.width, "right");
			headerLine += col.dimmed ? th.fg("dim", label) : label;
		}
		return [th.fg("muted", headerLine), th.fg("border", "─".repeat(layout.tableWidth))];
	}

	private renderDataRow(
		name: string,
		stats: BaseStats & { sessions: Set<string> | number },
		layout: TableLayout,
		options: { indent?: number; dimAll?: boolean; prefix?: string } = {}
	): string {
		const th = this.theme;
		const { indent = 0, dimAll = false, prefix } = options;

		const rawPrefix = prefix ?? " ".repeat(indent);
		const safePrefix = layout.nameWidth > 0 ? truncateToWidth(rawPrefix, layout.nameWidth, "") : "";
		const prefixWidth = visibleWidth(safePrefix);
		const innerNameWidth = Math.max(layout.nameWidth - prefixWidth, 0);
		const truncName = innerNameWidth > 0 ? truncateToWidth(name, innerNameWidth) : "";
		const styledName = dimAll ? th.fg("dim", truncName) : truncName;

		let row = safePrefix + (innerNameWidth > 0 ? padRight(styledName, innerNameWidth) : "");

		for (const col of layout.columns) {
			const value = fitCell(col.getValue(stats), col.width, "right");
			const shouldDim = col.dimmed || dimAll;
			row += shouldDim ? th.fg("dim", value) : value;
		}

		return row;
	}

	private renderTotals(layout: TableLayout): string[] {
		const th = this.theme;
		const stats = this.usageData![this.scope] as TimeFilteredStats;
		let totalRow = fitCell(th.bold("Total"), layout.nameWidth);
		for (const col of layout.columns) {
			const value = fitCell(col.getValue(stats.totals), col.width, "right");
			totalRow += col.dimmed ? th.fg("dim", value) : value;
		}
		return [th.fg("border", "─".repeat(layout.tableWidth)), totalRow, ""];
	}

	private renderFormulaNote(width: number): string[] {
		const line = pickFittingText(width, [
			"Tokens = Input + Output + CacheWrite  ·  ↑In = Input + CacheWrite  (as of 0.2.0)",
			"Tokens = In + Out + CacheWrite  ·  ↑In = In + CacheWrite  (v0.2.0+)",
			"Tokens & ↑In include CacheWrite (v0.2.0+)",
			"Incl. CacheWrite (v0.2.0+)",
		]);
		return [this.theme.fg("dim", line), ""];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
	// Keep the existing /usage modal command
	pi.registerCommand("usage", {
		description: "Show usage statistics dashboard",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				return;
			}

			const data = await ctx.ui.custom<UsageData | null>((tui, theme, _kb, done) => {
				const loader = new CancellableLoader(
					tui,
					(s: string) => theme.fg("accent", s),
					(s: string) => theme.fg("muted", s),
					"Loading Usage..."
				);
				let finished = false;
				const finish = (value: UsageData | null) => {
					if (finished) return;
					finished = true;
					loader.dispose();
					done(value);
				};

				loader.onAbort = () => finish(null);

				collectUsageData(loader.signal)
					.then(finish)
					.catch(() => finish(null));

				return loader;
			});

			if (!data) {
				return;
			}

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const container = new Container();

				// Top border
				container.addChild(new Spacer(1));
				container.addChild(new DynamicBorder((s: string) => theme.fg("border", s)));
				container.addChild(new Spacer(1));

				const usage = new UsageComponent(theme, data, () => tui.requestRender(), () => done());

				return {
					render: (w: number) => {
						const borderLines = clampLines(container.render(w), w);
						const usageLines = usage.render(w);
						const bottomBorder = theme.fg("border", "─".repeat(w));
						return clampLines([...borderLines, ...usageLines, "", bottomBorder], w);
					},
					invalidate: () => container.invalidate(),
					handleInput: (input: string) => usage.handleInput(input),
					dispose: () => {},
				};
			});
		},
	});

	// =========================================================================
	// Footer Widget Setup
	// =========================================================================

	let currentWidget: UsageWidget | null = null;
	let debounceTimer: NodeJS.Timeout | null = null;
	let periodicTimer: NodeJS.Timeout | null = null;
	let currentAbortController: AbortController | null = null;
	let unsubMessageEnd: (() => void) | null = null;

	function cancelPendingUpdate(): void {
		if (currentAbortController) {
			currentAbortController.abort();
			currentAbortController = null;
		}
	}

	async function updateWidgetData(widget: UsageWidget, signal: AbortSignal): Promise<void> {
		const data = await collectUsageData(signal);
		if (!signal.aborted) {
			widget.setData(data);
		}
	}

	function scheduleDebouncedRefresh(widget: UsageWidget): void {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		cancelPendingUpdate();
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			if (currentWidget) {
				const controller = new AbortController();
				currentAbortController = controller;
				updateWidgetData(currentWidget, controller.signal).catch(() => {});
			}
		}, 1000);
	}

	function startPeriodicRefresh(widget: UsageWidget): void {
		if (periodicTimer) {
			clearInterval(periodicTimer);
		}
		periodicTimer = setInterval(() => {
			if (currentWidget) {
				cancelPendingUpdate();
				const controller = new AbortController();
				currentAbortController = controller;
				updateWidgetData(currentWidget, controller.signal).catch(() => {});
			}
		}, 30_000);
	}

	function stopPeriodicRefresh(): void {
		if (periodicTimer) {
			clearInterval(periodicTimer);
			periodicTimer = null;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		// Clean up any previous session state (should be clean but be safe)
		cancelPendingUpdate();
		stopPeriodicRefresh();
		if (currentWidget) {
			currentWidget.dispose();
			currentWidget = null;
		}

		// Create a fresh widget for this session
		const widget = new UsageWidget(ctx.ui.theme);
		currentWidget = widget;

		// Initial data load
		const controller = new AbortController();
		currentAbortController = controller;
		await updateWidgetData(widget, controller.signal).catch(() => {});
		currentAbortController = null;

		// Register the widget with Pi UI using factory form to access tui.requestRender()
		ctx.ui.setWidget("usage-stats-widget", (tui, _theme) => {
			widget.setTui(tui);
			return {
				render: (w: number) => widget.render(w),
				invalidate: () => widget.invalidate(),
			};
		}, { placement: "aboveEditor" });

		// Start periodic refresh
		startPeriodicRefresh(widget);

		// Subscribe to message_end for real-time updates
		unsubMessageEnd = pi.on("message_end", () => {
			scheduleDebouncedRefresh(widget);
		});
	});

	pi.on("session_switch", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		// Clean up previous session resources
		if (unsubMessageEnd) {
			unsubMessageEnd();
			unsubMessageEnd = null;
		}
		cancelPendingUpdate();
		stopPeriodicRefresh();
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		if (currentWidget) {
			currentWidget.dispose();
			currentWidget = null;
		}
		// New session will trigger session_start; nothing else needed
	});

	pi.on("session_end", () => {
		if (unsubMessageEnd) {
			unsubMessageEnd();
			unsubMessageEnd = null;
		}
		cancelPendingUpdate();
		stopPeriodicRefresh();
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		if (currentWidget) {
			currentWidget.dispose();
			currentWidget = null;
		}
	});

	// Register keyboard shortcuts
	pi.registerShortcut("ctrl+u", {
		description: "Cycle usage widget display mode",
		handler: async () => {
			if (currentWidget) {
				currentWidget.cycleMode();
			}
		},
	});

	pi.registerShortcut("alt+u", {
		description: "Cycle usage widget time scope",
		handler: async () => {
			if (currentWidget) {
				currentWidget.cycleScope();
			}
		},
	});

	// Also register /commands for discoverability
	pi.registerCommand("cycle-usage-mode", {
		description: "Cycle usage widget display mode",
		shortcuts: ["ctrl+u"],
		handler: async () => {
			if (currentWidget) {
				currentWidget.cycleMode();
			}
		},
	});

	pi.registerCommand("cycle-usage-scope", {
		description: "Cycle usage widget time scope",
		shortcuts: ["alt+u"],
		handler: async () => {
			if (currentWidget) {
				currentWidget.cycleScope();
			}
		},
	});
}
