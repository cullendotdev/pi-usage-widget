/**
 * Config persistence — loads and saves UsageWidgetConfig to/from disk.
 *
 * Exports:
 *   - getDefaultConfig()  — hardcoded defaults
 *   - mergeConfig()       — deep merge partial config over default
 *   - loadConfig()        — load from disk → merge → return resolved config
 *   - saveConfig()        — write config to disk
 *
 * Config path: ~/.pi/agent/pi-usage-widget-settings.json
 * Test override: PI_USAGE_CONFIG_PATH env var
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type {
  UsageWidgetConfig,
  DisplayMode,
  ModeColumnConfig,
  ColorOverrides,
} from "./types.js";

// =============================================================================
// Config path
// =============================================================================

function getConfigPath(): string {
  if (process.env.PI_USAGE_CONFIG_PATH) {
    return process.env.PI_USAGE_CONFIG_PATH;
  }
  const agentDir =
    process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "pi-usage-widget-settings.json");
}

// =============================================================================
// Default configuration
// =============================================================================

function defaultModeColumnConfig(): ModeColumnConfig {
  return {
    provider: true,
    model: true,
    sessions: true,
    msgs: true,
    cost: true,
    tokens: true,
    tokensIn: true,
    tokensOut: true,
    cache: true,
    showTotals: true,
    showHeaders: true,
    showHeaderLine: true,
    showFooterLine: true,
  };
}

function nullColorOverrides(): ColorOverrides {
  return {
    title: null,
    scope: null,
    providerHeader: null,
    modelHeader: null,
    sessionsHeader: null,
    msgsHeader: null,
    costHeader: null,
    tokensHeader: null,
    tokensInHeader: null,
    tokensOutHeader: null,
    cacheHeader: null,
    providerValue: null,
    modelValue: null,
    sessionsValue: null,
    msgsValue: null,
    costValue: null,
    tokensValue: null,
    tokensInValue: null,
    tokensOutValue: null,
    cacheValue: null,
    headerLine: null,
    footerLine: null,
  };
}

const ALL_MODES: DisplayMode[] = [
  "summary",
  "compact",
  "Per Model",
  "expanded",
  "hidden",
];

export function getDefaultConfig(): UsageWidgetConfig {
  const modes = {} as Record<DisplayMode, ModeColumnConfig>;
  for (const mode of ALL_MODES) {
    const cfg = defaultModeColumnConfig();
    // Summary mode has no totals row (it is already a totals-like display)
    if (mode === "summary") {
      cfg.showTotals = false;
    }
    modes[mode] = cfg;
  }

  const perModeColorOverrides = {} as Record<DisplayMode, ColorOverrides>;
  for (const mode of ALL_MODES) {
    perModeColorOverrides[mode] = nullColorOverrides();
  }

  const perModeThemedPreset = {} as Record<DisplayMode, null>;
  for (const mode of ALL_MODES) {
    perModeThemedPreset[mode] = null;
  }

  const enabledModes = {} as Record<DisplayMode, boolean>;
  for (const mode of ALL_MODES) {
    enabledModes[mode] = true;
  }

  return {
    defaultMode: "summary",
    defaultScope: "today",
    themedPreset: "default",
    perModeThemedPreset: perModeThemedPreset as Record<DisplayMode, any>,
    globalColorOverrides: nullColorOverrides(),
    perModeColorOverrides,
    placement: {
      mode: "footer",
      paddingX: 0,
      paddingY: 0,
    },
    modes,
    enabledModes,
    headerLine: {
      show: true,
      color: null,
      character: "─",
    },
    footerLine: {
      show: true,
      color: null,
      character: "─",
    },
  };
}

// =============================================================================
// Deep merge
// =============================================================================

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === "object" && !Array.isArray(item);
}

/**
 * Deep merge `partial` into `base`. Only keys present in `partial` override
 * base values. null/undefined values in `partial` mean "use default" and
 * are not merged. Nested objects are merged recursively.
 */
export function mergeConfig(
  base: UsageWidgetConfig,
  partial: Partial<UsageWidgetConfig>,
): UsageWidgetConfig {
  const result = { ...base };

  for (const key of Object.keys(partial) as (keyof UsageWidgetConfig)[]) {
    const partialVal = partial[key];
    if (partialVal === undefined || partialVal === null) continue;

    if (isObject(partialVal) && isObject(result[key])) {
      // Deep merge nested objects
      result[key] = deepMergeObjects(
        result[key] as Record<string, unknown>,
        partialVal as Record<string, unknown>,
      ) as never;
    } else {
      result[key] = partialVal as never;
    }
  }

  return result;
}

function deepMergeObjects(
  base: Record<string, unknown>,
  partial: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };

  for (const key of Object.keys(partial)) {
    const partialVal = partial[key];
    if (partialVal === undefined || partialVal === null) continue;

    if (isObject(partialVal) && isObject(result[key])) {
      result[key] = deepMergeObjects(
        result[key] as Record<string, unknown>,
        partialVal as Record<string, unknown>,
      );
    } else {
      result[key] = partialVal;
    }
  }

  return result;
}

// =============================================================================
// Load / Save
// =============================================================================

/**
 * Load config from disk, falling back to hardcoded defaults.
 * Partial user configs are safely merged with defaults.
 * Invalid JSON is handled gracefully — defaults are returned.
 */
export function loadConfig(): UsageWidgetConfig {
  const defaults = getDefaultConfig();
  const configPath = getConfigPath();

  try {
    // readFileSync-like wrapped in try-catch? No — readFile is async but
    // loadConfig is sync in the API. We use require-style sync.
    // Since this is an ES module and we don't want to use fs/promises for sync,
    // we use the sync fs API.
    const { readFileSync, existsSync } = require("node:fs");
    if (!existsSync(configPath)) {
      return defaults;
    }
    const raw = readFileSync(configPath, "utf-8");
    if (!raw.trim()) {
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) {
      return defaults;
    }
    return mergeConfig(defaults, parsed as Partial<UsageWidgetConfig>);
  } catch {
    return defaults;
  }
}

/**
 * Save config to disk. Creates parent directories if needed.
 */
export function saveConfig(config: UsageWidgetConfig): void {
  const configPath = getConfigPath();

  try {
    const { mkdirSync, writeFileSync } = require("node:fs");
    const dir = dirname(configPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch {
    // Silently fail — the settings UI will retry on next change
  }
}
