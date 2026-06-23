/**
 * Color engine — default color scheme, override resolution, and ANSI conversion.
 *
 * Exports:
 *   - colorElements         — array of all valid element keys
 *   - colorPresets          — default ColorScheme (element → hex fallback)
 *   - DEFAULT_THEME_ROLE_MAP — maps widget elements to live Pi theme fg roles
 *   - getThemeHex()         — extract hex from live Pi Theme fg role
 *   - hexToAnsi()           — convert hex (#rrggbb) to ANSI truecolor escape
 *   - ansiNameToAnsi()      — convert 16-color ANSI name to escape
 *   - resolveColor()        — resolve element → ANSI code from config layers
 *   - queryOsc4Palette()    — query terminal's 16-color palette via OSC 4 (impure)
 *
 * Core functions (hexToAnsi, ansiNameToAnsi, resolveColor) are pure.
 */

import type { UsageWidgetConfig, DisplayMode, ColorOverrides, ThemedPreset } from "./types.js";

// =============================================================================
// Element enumeration
// =============================================================================

/**
 * Ordered array of every colorable element in the widget.
 * Maintains parity with ColorOverrides keys in types.ts.
 */
export const colorElements = [
  "title",
  "scope",
  // Column headers
  "providerHeader",
  "modelHeader",
  "sessionsHeader",
  "msgsHeader",
  "costHeader",
  "tokensHeader",
  "tokensInHeader",
  "tokensOutHeader",
  "cacheHeader",
  // Column values
  "providerValue",
  "modelValue",
  "sessionsValue",
  "msgsValue",
  "costValue",
  "tokensValue",
  "tokensInValue",
  "tokensOutValue",
  "cacheValue",
  // Separator lines
  "headerLine",
  "footerLine",
  // Structural
  "separator",
  "totalLabel",
] as const;

/** Union type of all element keys (derived from the const array). */
export type ColorElement = (typeof colorElements)[number];

/**
 * Maps each widget color element to a Pi theme fg role.
 * Colors are resolved from the live Pi theme via these role names,
 * with the hardcoded hex values serving as a fallback.
 */
export const DEFAULT_THEME_ROLE_MAP: Record<ColorElement, string> = {
  title: "accent",
  scope: "muted",
  providerHeader: "muted",
  modelHeader: "muted",
  sessionsHeader: "muted",
  msgsHeader: "muted",
  costHeader: "warning",
  tokensHeader: "muted",
  tokensInHeader: "dim",
  tokensOutHeader: "dim",
  cacheHeader: "dim",
  providerValue: "text",
  modelValue: "text",
  sessionsValue: "text",
  msgsValue: "text",
  costValue: "warning",
  tokensValue: "text",
  tokensInValue: "dim",
  tokensOutValue: "dim",
  cacheValue: "dim",
  headerLine: "border",
  footerLine: "border",
  separator: "dim",
  totalLabel: "text",
};

/** Complete color scheme — every element mapped to a hex color. */
export type ColorScheme = Record<ColorElement, string>;

// =============================================================================
// Default Theme fg role → hex mapping
// =============================================================================

/**
 * Maps Pi Theme fg role names to their canonical hex colors.
 * Used when an override references a role name instead of a raw hex code.
 *
 * The color engine does not import Theme directly — callers pass this map
 * (or a live map extracted from a Theme instance) via resolveColor() options.
 */
export const defaultThemeFgMap: Record<string, string> = {
  accent: "#58a6ff",
  muted: "#8b949e",
  dim: "#6a737d",
  text: "#c9d1d9",
  border: "#30363d",
  thinkingText: "#8b949e",
  error: "#f85149",
  warning: "#d29922",
  success: "#56d364",
  info: "#58a6ff",
};

// =============================================================================
// ANSI conversion helpers
// =============================================================================

const ANSI_4BIT_NAMES: Record<string, string> = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
};

const HEX_RE = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

// =============================================================================
// ANSI escape → hex extraction
// =============================================================================

/**
 * Convert a 256-color index to an approximate hex string.
 * Matches the logic in Pi's theme.js ansi256ToHex.
 */
function ansi256ToHex(index: number): string {
  // Basic colors (0-15)
  const basicColors = [
    "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  ];
  if (index < 16) return basicColors[index] ?? "#000000";

  // Color cube (16-231): 6x6x6 = 216 colors
  if (index < 232) {
    const cubeIndex = index - 16;
    const r = Math.floor(cubeIndex / 36);
    const g = Math.floor((cubeIndex % 36) / 6);
    const b = cubeIndex % 6;
    const toHex = (n: number) => (n === 0 ? 0 : 55 + n * 40).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Grayscale (232-255): 24 shades
  const gray = 8 + (index - 232) * 10;
  const grayHex = gray.toString(16).padStart(2, "0");
  return `#${grayHex}${grayHex}${grayHex}`;
}

/** Match \x1b[38;2;R;G;Bm */
const TRUECOLOR_FG_RE = /^\x1b\[38;2;(\d+);(\d+);(\d+)m$/;
/** Match \x1b[38;5;Nm */
const C256_FG_RE = /^\x1b\[38;5;(\d+)m$/;

/**
 * Extract a hex color from a live Pi Theme's foreground role ANSI escape.
 *
 * @param theme  The live Pi Theme instance
 * @param role   Theme fg role name (e.g. "accent", "muted")
 * @returns      Hex string like "#58a6ff", or fallback from defaultThemeFgMap
 *               if the role resolves to terminal default or is unknown.
 */
export function getThemeHex(theme: { getFgAnsi(role: string): string }, role: string): string {
  try {
    const ansi = theme.getFgAnsi(role);

    // Truecolor: \x1b[38;2;R;G;Bm
    const trueMatch = TRUECOLOR_FG_RE.exec(ansi);
    if (trueMatch) {
      const r = parseInt(trueMatch[1]!, 10);
      const g = parseInt(trueMatch[2]!, 10);
      const b = parseInt(trueMatch[3]!, 10);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }

    // 256-color: \x1b[38;5;Nm
    const c256Match = C256_FG_RE.exec(ansi);
    if (c256Match) {
      const index = parseInt(c256Match[1]!, 10);
      return ansi256ToHex(index);
    }

    // Default or unknown — fall back to hardcoded map
    return defaultThemeFgMap[role] ?? defaultThemeFgMap["dim"] ?? "#6a737d";
  } catch {
    return defaultThemeFgMap[role] ?? defaultThemeFgMap["dim"] ?? "#6a737d";
  }
}

/**
 * Convert a hex color string (#rrggbb) to an ANSI truecolor foreground escape.
 * Returns empty string for invalid input (caller handles fallback).
 */
export function hexToAnsi(hex: string): string {
  const m = HEX_RE.exec(hex);
  if (!m) return "";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Convert a 16-color ANSI palette name to its escape sequence.
 * Returns empty string for unknown names.
 */
export function ansiNameToAnsi(name: string): string {
  return ANSI_4BIT_NAMES[name] ?? "";
}

// =============================================================================
// ANSI color name → index (for OSC 4 fallback)
// =============================================================================

/**
 * Maps ANSI palette names to their terminal color indices (0-15).
 * Used as a fallback when OSC 4 querying is unavailable.
 */
export const ANSI_NAME_TO_INDEX: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightBlack: 8,
  brightRed: 9,
  brightGreen: 10,
  brightYellow: 11,
  brightBlue: 12,
  brightMagenta: 13,
  brightCyan: 14,
  brightWhite: 15,
};

/**
 * Approximate hex colors for ANSI palette indices (used as a second fallback).
 */
export const ANSI_INDEX_HEX_FALLBACK: Record<number, string> = {
  0: "#000000", 1: "#cc0000",  2: "#4e9a06", 3: "#c4a000",
  4: "#3465a4", 5: "#75507b", 6: "#06989a", 7: "#d3d7cf",
  8: "#555753",  9: "#ef2929", 10: "#8ae234", 11: "#fce94f",
  12: "#729fcf", 13: "#ad7fa8", 14: "#34e2e2", 15: "#eeeeec",
};

// =============================================================================
// OSC 4 terminal palette querying
// =============================================================================

/**
 * Cached OSC 4 palette (lazily populated on first call).
 * null = not yet queried, Map = queried (even if empty on failure).
 */
let _osc4Cache: Map<number, string> | null = null;

/**
 * Parse an OSC 4 response line: \x1b]4;N;rgb:RR/GG/BB(\x07|\x1b\\)
 * Returns [index, hex] or null if the line doesn't match.
 */
function parseOsc4Response(raw: string): [number, string] | null {
  // Strip surrounding ESC ]4; prefix and trailing BEL/ST
  const m = /^\x1b\]4;(\d+);rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})/.exec(raw);
  if (!m) return null;

  const index = parseInt(m[1]!, 10);
  // Parse 1-4 digit hex components (scale down to 2-digit if needed)
  const toHex = (s: string): string => {
    const n = parseInt(s, 16);
    // If > 8-bit, scale down
    const scaled = s.length <= 2 ? n : Math.round((n / 65535) * 255);
    return scaled.toString(16).padStart(2, "0");
  };

  return [index, `#${toHex(m[2]!)}${toHex(m[3]!)}${toHex(m[4]!)}`];
}

/**
 * Query the terminal's 16-color palette using OSC 4 escape sequences.
 *
 * Sends queries for colors 0-15, reads responses, and returns a map of
 * ANSI color index → hex color string. If the terminal doesn't support
 * OSC 4 querying (or stdin is not a TTY), the map will be empty.
 *
 * Returns a shared cached result after the first call.
 *
 * **Important:** This function manipulates stdin raw mode. It should be
 * called before Pi's TUI has taken control of the terminal.
 */
export async function queryOsc4Palette(): Promise<Map<number, string>> {
  if (_osc4Cache !== null) return _osc4Cache;

  _osc4Cache = new Map();

  try {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return _osc4Cache; // empty — can't query
    }

    const savedRaw = process.stdin.isRaw;
    if (!savedRaw) process.stdin.setRawMode(true);

    // Create a one-shot readline interface to capture responses
    const rl = readline.createInterface({
      input: process.stdin,
      // Don't echo our queries back through the readline
      terminal: false,
    });

    const responses = new Map<number, string>();
    let resolvePromise: () => void;
    const done = new Promise<void>((r) => { resolvePromise = r; });
    const timeout = setTimeout(() => resolvePromise(), 500);

    rl.on("line", (line: string) => {
      const parsed = parseOsc4Response(line);
      if (parsed) {
        responses.set(parsed[0], parsed[1]);
      }
    });

    // Wait briefly for readline to be ready
    await new Promise((r) => setTimeout(r, 20));

    // Send OSC 4 queries for colors 0-15
    for (let i = 0; i < 16; i++) {
      process.stdout.write(`\x1b]4;${i};?\x07`);
    }

    await done;
    clearTimeout(timeout);

    rl.close();
    if (!savedRaw) process.stdin.setRawMode(false);

    _osc4Cache = responses;
    return _osc4Cache;
  } catch {
    // If anything went wrong, restore stdin if possible and return empty
    try {
      if (!process.stdin.isRaw) {
        // Already restored
      } else {
        process.stdin.setRawMode(false);
      }
    } catch {
      // Best effort
    }
    return _osc4Cache;
  }
}

/**
 * Clear the cached OSC 4 palette, forcing a re-query on the next call.
 * Useful for testing or if the terminal palette changes at runtime.
 */
export function clearOsc4Cache(): void {
  _osc4Cache = null;
}

// =============================================================================
// Default color scheme
// =============================================================================

/**
 * Default ColorScheme — maps every element to a hex color.
 * Used as fallback when the live Pi theme is unavailable.
 */
export const colorPresets: Record<ThemedPreset, ColorScheme> = {
  // ==========================================================================
  // Default — clean blue/gray (Pi-like)
  // ==========================================================================
  default: {
    title: "#58a6ff",
    scope: "#8b949e",
    // Headers
    providerHeader: "#8b949e",
    modelHeader: "#8b949e",
    sessionsHeader: "#8b949e",
    msgsHeader: "#8b949e",
    costHeader: "#e3b341",
    tokensHeader: "#8b949e",
    tokensInHeader: "#6a737d",
    tokensOutHeader: "#6a737d",
    cacheHeader: "#6a737d",
    // Values
    providerValue: "#c9d1d9",
    modelValue: "#c9d1d9",
    sessionsValue: "#c9d1d9",
    msgsValue: "#c9d1d9",
    costValue: "#e3b341",
    tokensValue: "#c9d1d9",
    tokensInValue: "#6a737d",
    tokensOutValue: "#6a737d",
    cacheValue: "#6a737d",
    // Lines
    headerLine: "#30363d",
    footerLine: "#30363d",
    // Structural
    separator: "#6a737d",
    totalLabel: "#c9d1d9",
  },
};

// =============================================================================
// Resolution options
// =============================================================================

export interface ResolveColorOptions {
  /** Active display mode (for per-mode override lookup). Defaults to config.defaultMode. */
  mode?: DisplayMode;
  /** Mapping from Theme fg role names to hex colors. Defaults to defaultThemeFgMap. */
  themeFgMap?: Record<string, string>;
  /**
   * Live theme's foreground ANSI resolver. When provided, role names
   * (e.g. "accent") are resolved via the live Pi theme instead of the
   * static themeFgMap, so applied colors match the user's active theme.
   */
  getFgAnsi?: (role: string) => string;
}

// =============================================================================
// Internal: color value → ANSI resolution
// =============================================================================

/**
 * Given a color override value (which may be a role name, ANSI palette name,
 * or hex code), resolve it to an ANSI escape string using the provided
 * theme fg map and optional live theme callback. Returns "" for invalid/unparseable values.
 */
function overrideToAnsi(
  raw: string,
  fgMap: Record<string, string>,
  getFgAnsi?: (role: string) => string,
): string {
  // 1. Try hex code
  const ansi = hexToAnsi(raw);
  if (ansi) return ansi;

  // 2. Try live theme fg role (preferred — matches user's active Pi theme)
  if (getFgAnsi) {
    try {
      const liveAnsi = getFgAnsi(raw);
      // getFgAnsi returns "\x1b[39m" for unknown roles (terminal default),
      // which means the role wasn't recognized. Only use if it's a real color.
      if (liveAnsi && liveAnsi !== "\x1b[39m") return liveAnsi;
    } catch {
      // Fall through to static map
    }
  }

  // 3. Try static theme fg role map (fallback)
  const hexFromRole = fgMap[raw];
  if (hexFromRole) return hexToAnsi(hexFromRole);

  // 4. Try 16-color ANSI name
  const ansiFromName = ansiNameToAnsi(raw);
  if (ansiFromName) return ansiFromName;

  // 5. Unknown — fallback
  return "";
}

/**
 * Resolve a single override layer: returns the first non-null value.
 * null means "delegate to the next layer down."
 */
function pickOverride(
  overrides: ColorOverrides | undefined,
  element: ColorElement,
): string | null {
  if (!overrides) return null;
  // All ColorOverrides keys match ColorElement exactly
  return (overrides as Record<string, string | null>)[element] ?? null;
}

// =============================================================================
// Public API: resolveColor
// =============================================================================

/**
 * Resolve the final ANSI foreground color escape for an element given the
 * full config and optional resolution options.
 *
 * Resolution order (highest priority first):
 *   1. Per-mode override (non-null)
 *   2. Default color scheme (live Pi theme roles)
 *   3. Hardcoded fallback hex values
 *   4. Last-resort "dim" from the theme fg map
 *
 * @param element  The colorable element to resolve
 * @param config   The full resolved UsageWidgetConfig
 * @param options  Optional mode and theme fg map overrides
 * @returns        ANSI foreground escape sequence (e.g. "\x1b[38;2;84;160;255m")
 */
export function resolveColor(
  element: ColorElement,
  config: UsageWidgetConfig,
  options?: ResolveColorOptions,
): string {
  const mode = options?.mode ?? config.defaultMode;
  const fgMap = options?.themeFgMap ?? defaultThemeFgMap;
  const getFgAnsi = options?.getFgAnsi;

  // 1. Per-mode override
  const perModeOverride = pickOverride(config.perModeColorOverrides[mode], element);
  if (perModeOverride !== null) {
    const result = overrideToAnsi(perModeOverride, fgMap, getFgAnsi);
    if (result) return result;
    // Invalid override — fall through to next layer
  }

  // 2. Default color scheme — maps to live Pi theme roles
  if (getFgAnsi) {
    const role = DEFAULT_THEME_ROLE_MAP[element];
    if (role) {
      try {
        const liveAnsi = getFgAnsi(role);
        if (liveAnsi && liveAnsi !== "\x1b[39m") return liveAnsi;
      } catch {
        // Fall through to hardcoded fallback
      }
    }
  }
  // Fallback: use hardcoded default hex values
  const presetHex = colorPresets.default[element];
  if (presetHex) {
    const result = hexToAnsi(presetHex);
    if (result) return result;
  }

  // 3. Last-resort fallback — use "dim" from the fg map
  const fallbackHex = fgMap["dim"] ?? "#6a737d";
  return hexToAnsi(fallbackHex) || "\x1b[37m";
}
