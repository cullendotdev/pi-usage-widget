/**
 * Terminal ANSI palette query via OSC 4.
 *
 * Queries the terminal for its 16-color palette on startup. Caches results
 * in a module-level variable. Falls back to hardcoded approximations when
 * the query fails or the terminal doesn't support OSC 4.
 *
 * Exports:
 *   - initTerminalPalette() — async query + cache (call once at startup)
 *   - getCachedAnsiPalette() — returns cached palette hex values
 */

import { writeSync } from "node:fs";

// =============================================================================
// Hardcoded fallback palette (reasonable defaults)
// =============================================================================

export const FALLBACK_ANSI_PALETTE: Record<string, string> = {
  black: "#1a1a2e",
  red: "#cc0000",
  green: "#4e9a06",
  yellow: "#c4a000",
  blue: "#3465a4",
  magenta: "#75507b",
  cyan: "#06989a",
  white: "#d3d7cf",
  brightBlack: "#555753",
  brightRed: "#ef2929",
  brightGreen: "#8ae234",
  brightYellow: "#fce94f",
  brightBlue: "#729fcf",
  brightMagenta: "#ad7fa8",
  brightCyan: "#34e2e2",
  brightWhite: "#eeeeec",
};

// =============================================================================
// Normal 8-color names → bright 8-color names mapping
// =============================================================================

const NORMAL_TO_BRIGHT: Record<string, string> = {
  black: "brightBlack",
  red: "brightRed",
  green: "brightGreen",
  yellow: "brightYellow",
  blue: "brightBlue",
  magenta: "brightMagenta",
  cyan: "brightCyan",
  white: "brightWhite",
};

/** All 16 color names in palette order. */
const ANSI_COLOR_NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

// =============================================================================
// Module-level cache
// =============================================================================

let cachedPalette: Record<string, string> | null = null;

// =============================================================================
// OSC 4 response parsing
// =============================================================================

/**
 * Parse an OSC 4 response like: rgb:AAAA/BBBB/CCCC
 * Each channel is a 16-bit value (0-65535), we convert to 8-bit (0-255).
 */
function parseOsc4Rgb(raw: string): string | null {
  // Match rgb:RRRR/GGGG/BBBB (case insensitive, optional leading zeros)
  const m = /rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})/.exec(raw);
  if (!m) return null;

  const r16 = parseInt(m[1]!, 16);
  const g16 = parseInt(m[2]!, 16);
  const b16 = parseInt(m[3]!, 16);

  // Scale 16-bit to 8-bit
  const r = Math.round((r16 / 65535) * 255);
  const g = Math.round((g16 / 65535) * 255);
  const b = Math.round((b16 / 65535) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// =============================================================================
// Terminal query
// =============================================================================

/**
 * Query the terminal for its 16-color palette via OSC 4.
 *
 * Writes OSC 4 queries to /dev/tty and collects responses.
 * Falls back to FALLBACK_ANSI_PALETTE if the query fails or times out.
 *
 * @param timeoutMs  Per-color query timeout (default: 200ms)
 */
export async function initTerminalPalette(timeoutMs = 200): Promise<void> {
  // If already cached, skip
  if (cachedPalette) return;
  if (!process.stdout.isTTY) {
    cachedPalette = { ...FALLBACK_ANSI_PALETTE };
    return;
  }

  // Open /dev/tty for raw writes (best-effort)
  let ttyFd: number | null = null;
  try {
    const { openSync } = await import("node:fs");
    ttyFd = openSync("/dev/tty", "r+");
  } catch {
    // Can't open /dev/tty — fall back to hardcoded
    cachedPalette = { ...FALLBACK_ANSI_PALETTE };
    return;
  }

  // We use a sequential query approach — send all 16 queries first,
  // then listen for responses with a timeout.
  // More reliable approach: query one at a time.

  const palette: Record<string, string> = { ...FALLBACK_ANSI_PALETTE };
  const queried = new Set<string>();

  try {
    for (let i = 0; i < 16; i++) {
      const name = ANSI_COLOR_NAMES[i]!;
      if (queried.has(name)) continue;
      queried.add(name);

      // Query OSC 4;N;?
      const query = `\x1b]4;${i};?\x1b\\`;
      try {
        writeSync(ttyFd, query);
      } catch {
        break; // Can't write — stop querying
      }
    }

    // Give the terminal a moment to respond
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));

    // Try to read responses from /dev/tty
    // Note: this is best-effort. Terminal responses arrive on stdin as
    // OSC sequences. We can't easily parse them without reading stdin,
    // which would conflict with Pi's input handling.
    // If we have access, we attempt a non-blocking read.
    try {
      const { readSync } = await import("node:fs");
      // Switch tty to non-blocking
      const { fcntlSync, constants: { F_GETFL, F_SETFL, O_NONBLOCK } } = await import("node:fs");
      const flags = fcntlSync(ttyFd, F_GETFL, 0);
      fcntlSync(ttyFd, F_SETFL, flags | O_NONBLOCK);

      // Read whatever is available
      const buf = Buffer.alloc(4096);
      let totalRead = 0;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const n = readSync(ttyFd, buf, totalRead, buf.length - totalRead, null);
          if (n > 0) totalRead += n;
        } catch {
          break; // No more data
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      // Parse OSC 4 responses from the buffer
      const raw = buf.toString("utf-8", 0, totalRead);
      const responseRegex = /\x1b\]4;(\d+);([^\x07\x1b]+)/g;
      let match: RegExpExecArray | null;
      while ((match = responseRegex.exec(raw)) !== null) {
        const idx = parseInt(match[1]!, 10);
        if (idx >= 0 && idx < 16) {
          const name = ANSI_COLOR_NAMES[idx]!;
          const hex = parseOsc4Rgb(match[2]!);
          if (hex) palette[name] = hex;
        }
      }

      // Restore blocking mode
      fcntlSync(ttyFd, F_SETFL, flags);
    } catch {
      // Can't read — we'll just use fallback. This is expected for many terminals.
    }
  } catch {
    // Overall failure — fall back
  } finally {
    try {
      const { closeSync } = await import("node:fs");
      closeSync(ttyFd);
    } catch {
      // ignore
    }
  }

  cachedPalette = palette;
}

/**
 * Get the cached ANSI 16-color palette (as hex values).
 * Returns FALLBACK_ANSI_PALETTE if not yet initialized.
 */
export function getCachedAnsiPalette(): Record<string, string> {
  return cachedPalette ?? { ...FALLBACK_ANSI_PALETTE };
}
