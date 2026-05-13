/**
 * Color picker submenu — reusable component for selecting colors.
 *
 * Provides three selection modes:
 *   1. Theme fg roles (accent, muted, dim, text, border, etc.)
 *   2. 16-color ANSI palette (black, red, green, ..., bright variants)
 *   3. Custom hex input with #rrggbb validation
 *
 * Exports:
 *   - ColorPicker — Component for the color picker submenu
 *   - buildThemeOptions() — pure: returns ColorOption[] for theme roles
 *   - buildAnsiOptions() — pure: returns ColorOption[] for ANSI palette
 *   - validateHex() — pure: validates #rrggbb format
 *   - renderColorSwatch() — pure: renders ANSI-colored swatch block
 *   - findColorOption() — pure: locates a color value in option sets
 *   - ELEMENT_LABELS — human-readable labels for color elements
 *   - COLOR_PICKER_MODES, COLOR_PICKER_MODE_LABELS — mode constants
 *
 * Follows the pi-thinking-box component pattern.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { defaultThemeFgMap, hexToAnsi } from "./color-engine.js";

// =============================================================================
// Constants
// =============================================================================

export const COLOR_PICKER_MODES = ["theme", "ansi", "hex"] as const;
export type ColorPickerMode = (typeof COLOR_PICKER_MODES)[number];

export const COLOR_PICKER_MODE_LABELS: Record<ColorPickerMode, string> = {
  theme: "Theme Roles",
  ansi: "ANSI Palette",
  hex: "Custom Hex",
};

/** Human-readable labels for each colorable element. */
export const ELEMENT_LABELS: Record<string, string> = {
  title: "Title",
  scope: "Scope",
  providerHeader: "Provider Header",
  modelHeader: "Model Header",
  sessionsHeader: "Sessions Header",
  msgsHeader: "Msgs Header",
  costHeader: "Cost Header",
  tokensHeader: "Tokens Header",
  tokensInHeader: "Tokens In Header",
  tokensOutHeader: "Tokens Out Header",
  cacheHeader: "Cache Header",
  providerValue: "Provider Value",
  modelValue: "Model Value",
  sessionsValue: "Sessions Value",
  msgsValue: "Msgs Value",
  costValue: "Cost Value",
  tokensValue: "Tokens Value",
  tokensInValue: "Tokens In Value",
  tokensOutValue: "Tokens Out Value",
  cacheValue: "Cache Value",
  headerLine: "Header Line",
  footerLine: "Footer Line",
};

// =============================================================================
// Color option types
// =============================================================================

export interface ColorOption {
  /** Display label */
  label: string;
  /** Value stored in config (role name, ANSI name, or hex string) */
  value: string;
  /** Hex color for the swatch preview */
  hex: string;
}

export interface ColorOptionLocation {
  mode: ColorPickerMode;
  /** Index into the options array (for theme/ansi modes) */
  index: number;
  /** Hex value for custom hex mode */
  hexValue?: string;
}

// =============================================================================
// Pure helpers — exported for testing
// =============================================================================

/**
 * Build the list of theme fg role options with their hex swatch colors.
 * Order: accent, muted, dim, text, border, thinkingText, error, warning, success, info
 */
export function buildThemeOptions(): ColorOption[] {
  return [
    { label: "accent", value: "accent", hex: defaultThemeFgMap.accent },
    { label: "muted", value: "muted", hex: defaultThemeFgMap.muted },
    { label: "dim", value: "dim", hex: defaultThemeFgMap.dim },
    { label: "text", value: "text", hex: defaultThemeFgMap.text },
    { label: "border", value: "border", hex: defaultThemeFgMap.border },
    { label: "thinkingText", value: "thinkingText", hex: defaultThemeFgMap.thinkingText },
    { label: "error", value: "error", hex: defaultThemeFgMap.error },
    { label: "warning", value: "warning", hex: defaultThemeFgMap.warning },
    { label: "success", value: "success", hex: defaultThemeFgMap.success },
    { label: "info", value: "info", hex: defaultThemeFgMap.info },
  ];
}

/**
 * Build the list of 16-color ANSI palette options with approximate hex swatch colors.
 * Standard 8 colors first, then bright 8 variants.
 */
export function buildAnsiOptions(): ColorOption[] {
  return [
    { label: "black", value: "black", hex: "#1a1a2e" },
    { label: "red", value: "red", hex: "#cc0000" },
    { label: "green", value: "green", hex: "#4e9a06" },
    { label: "yellow", value: "yellow", hex: "#c4a000" },
    { label: "blue", value: "blue", hex: "#3465a4" },
    { label: "magenta", value: "magenta", hex: "#75507b" },
    { label: "cyan", value: "cyan", hex: "#06989a" },
    { label: "white", value: "white", hex: "#d3d7cf" },
    { label: "brightBlack", value: "brightBlack", hex: "#555753" },
    { label: "brightRed", value: "brightRed", hex: "#ef2929" },
    { label: "brightGreen", value: "brightGreen", hex: "#8ae234" },
    { label: "brightYellow", value: "brightYellow", hex: "#fce94f" },
    { label: "brightBlue", value: "brightBlue", hex: "#729fcf" },
    { label: "brightMagenta", value: "brightMagenta", hex: "#ad7fa8" },
    { label: "brightCyan", value: "brightCyan", hex: "#34e2e2" },
    { label: "brightWhite", value: "brightWhite", hex: "#eeeeec" },
  ];
}

/**
 * Validate that a string is a well-formed 6-digit hex color.
 */
export function validateHex(input: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(input);
}

/**
 * Render a 2-character color swatch block with ANSI background color.
 * Returns "??" for invalid hex.
 */
export function renderColorSwatch(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return "??";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[48;2;${r};${g};${b}m  \x1b[0m`;
}

/**
 * Find a color value's location in the option sets.
 * Returns null if the color is unknown or null (inherit).
 */
export function findColorOption(color: string | null): ColorOptionLocation | null {
  if (color === null || color === "") return null;

  // 1. Check theme roles
  const themeOptions = buildThemeOptions();
  const themeIdx = themeOptions.findIndex((o) => o.value === color);
  if (themeIdx >= 0) {
    return { mode: "theme", index: themeIdx };
  }

  // 2. Check ANSI palette
  const ansiOptions = buildAnsiOptions();
  const ansiIdx = ansiOptions.findIndex((o) => o.value === color);
  if (ansiIdx >= 0) {
    return { mode: "ansi", index: ansiIdx };
  }

  // 3. Check if it's a valid hex
  if (validateHex(color)) {
    return { mode: "hex", index: 0, hexValue: color };
  }

  return null;
}

// =============================================================================
// ColorPicker Component
// =============================================================================

/**
 * Interactive color picker submenu.
 *
 * Presents three selection modes (Theme Roles, ANSI Palette, Custom Hex)
 * with live color swatch previews. Confirm with Enter, cancel with Escape.
 *
 * Usage:
 *   const picker = new ColorPicker(theme, currentColor, onSelect, onCancel);
 *   // then delegate render() and handleInput() to picker
 */
export class ColorPicker {
  private theme: Theme;
  private onSelect: (color: string | null) => void;
  private onCancel: () => void;

  /** Which color source mode is active */
  private activeMode: ColorPickerMode;
  /** Selected index within the current mode's option list */
  private selectedIndex = 0;
  /** Hex input buffer (active in hex mode when editing) */
  private hexBuffer = "";
  /** Whether we're in hex editing mode (vs viewing the hex preview) */
  private editingHex = false;
  /** Error message for invalid hex input */
  private hexError: string | null = null;

  /** Cached option lists */
  private themeOptions: ColorOption[];
  private ansiOptions: ColorOption[];

  /** Window start index for scrolling */
  private scrollOffset = 0;

  constructor(
    theme: Theme,
    currentColor: string | null,
    onSelect: (color: string | null) => void,
    onCancel: () => void,
  ) {
    this.theme = theme;
    this.onSelect = onSelect;
    this.onCancel = onCancel;

    this.themeOptions = buildThemeOptions();
    this.ansiOptions = buildAnsiOptions();

    // Locate current color to pre-select the correct mode/option
    const loc = findColorOption(currentColor);
    if (loc) {
      this.activeMode = loc.mode;
      this.selectedIndex = loc.index;
      if (loc.mode === "hex" && loc.hexValue) {
        this.hexBuffer = loc.hexValue;
        this.editingHex = false; // show preview, not edit
      }
    } else {
      // Default to theme mode at accent
      this.activeMode = "theme";
      this.selectedIndex = 0;
      this.hexBuffer = "#";
      this.editingHex = true;
    }
  }

  // ===========================================================================
  // Rendering
  // ===========================================================================

  render(width: number): string[] {
    const safeWidth = Math.max(width, 30);
    const lines: string[] = [];

    // Top border + title
    lines.push(this.theme.fg("border", "─".repeat(safeWidth)));
    const title = " Color Picker ";
    const titlePad = Math.floor((safeWidth - title.length) / 2);
    lines.push(this.theme.fg("border", "─".repeat(titlePad) + title + "─".repeat(safeWidth - titlePad - title.length)));
    lines.push("");

    // Mode selector bar
    lines.push(...this.renderModeBar(safeWidth));
    lines.push("");

    // Mode-specific content
    if (this.activeMode === "theme") {
      lines.push(...this.renderOptionList(this.themeOptions, safeWidth));
    } else if (this.activeMode === "ansi") {
      lines.push(...this.renderOptionList(this.ansiOptions, safeWidth));
    } else {
      lines.push(...this.renderHexInput(safeWidth));
    }

    // Footer
    lines.push("");
    lines.push(this.theme.fg("dim", "─".repeat(safeWidth)));
    const hints = "Enter confirm  Esc cancel  ← → switch mode";
    if (safeWidth >= hints.length + 2) {
      const pad = Math.floor((safeWidth - hints.length) / 2);
      lines.push(this.theme.fg("dim", " ".repeat(pad) + hints));
    }
    lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

    return lines;
  }

  /** Render the mode selector bar with active mode highlighted. */
  private renderModeBar(width: number): string[] {
    const line = COLOR_PICKER_MODES.map((mode, i) => {
      const label = COLOR_PICKER_MODE_LABELS[mode];
      const padded = ` ${label} `;
      if (mode === this.activeMode) {
        return this.theme.bg("selectedBg", this.theme.fg("text", padded));
      } else {
        return this.theme.fg("muted", padded);
      }
    }).join("");

    // Center the mode bar
    const pad = Math.max(0, Math.floor((width - 2 - line.length) / 2));
    return [" " + " ".repeat(pad) + line];
  }

  /** Render a scrollable list of color options with swatches. */
  private renderOptionList(options: ColorOption[], width: number): string[] {
    const maxVisible = Math.max(6, Math.min(options.length, 14));
    const innerWidth = width - 4;

    // Adjust scroll offset to keep selectedIndex visible
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + maxVisible) {
      this.scrollOffset = this.selectedIndex - maxVisible + 1;
    }

    const lines: string[] = [];
    const endIdx = Math.min(this.scrollOffset + maxVisible, options.length);

    // Show scroll indicator if needed
    if (this.scrollOffset > 0) {
      lines.push("  " + this.theme.fg("dim", "  ↑ more"));
    }

    for (let i = this.scrollOffset; i < endIdx; i++) {
      const opt = options[i];
      const isSelected = i === this.selectedIndex;
      const cursor = isSelected ? this.theme.fg("accent", "▸") : " ";
      const swatch = renderColorSwatch(opt.hex);

      // Build: cursor swatch label (hex)
      const labelPart = opt.label.padEnd(14);
      const hexPart = isSelected
        ? this.theme.fg("accent", opt.hex)
        : this.theme.fg("dim", opt.hex);

      lines.push(`  ${cursor} ${swatch} ${labelPart} ${hexPart}`.slice(0, innerWidth + 2));
    }

    // Show scroll indicator if needed
    if (endIdx < options.length) {
      lines.push("  " + this.theme.fg("dim", "  ↓ more"));
    }

    return lines;
  }

  /** Render the custom hex input section. */
  private renderHexInput(width: number): string[] {
    const lines: string[] = [];

    if (this.editingHex) {
      // Show input field
      const display = this.hexBuffer || "#";
      lines.push("  " + this.theme.fg("text", "Enter hex color:"));

      const inputLine = "  " + this.theme.fg("accent", display + "█");
      lines.push(inputLine);

      // Live preview of current hex
      if (validateHex(this.hexBuffer)) {
        const swatch = renderColorSwatch(this.hexBuffer);
        lines.push("  Preview: " + swatch + " " + this.hexBuffer);
      } else if (this.hexBuffer.length > 1) {
        lines.push("  " + this.theme.fg("error", "Invalid format — use #rrggbb"));
      }

      if (this.hexError) {
        lines.push("  " + this.theme.fg("error", this.hexError));
      }
    } else {
      // Show hex preview (non-editing)
      const swatch = renderColorSwatch(this.hexBuffer);
      lines.push("  " + swatch + " " + this.theme.fg("text", this.hexBuffer));
      lines.push("");
      lines.push("  " + this.theme.fg("dim", "Press Enter to edit hex value"));
    }

    return lines;
  }

  // ===========================================================================
  // Input handling
  // ===========================================================================

  handleInput(input: string): void {
    // Escape — cancel
    if (input === "\x1b") {
      this.onCancel();
      return;
    }

    // Tab / Left-Right arrows — switch mode
    if (input === "\x1b[C" || input === "\x1bOC" || input === "\t") {
      // Right
      const idx = COLOR_PICKER_MODES.indexOf(this.activeMode);
      this.activeMode = COLOR_PICKER_MODES[(idx + 1) % COLOR_PICKER_MODES.length];
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.editingHex = this.activeMode === "hex";
      return;
    }
    if (input === "\x1b[D" || input === "\x1bOD") {
      // Left
      const idx = COLOR_PICKER_MODES.indexOf(this.activeMode);
      this.activeMode = COLOR_PICKER_MODES[(idx - 1 + COLOR_PICKER_MODES.length) % COLOR_PICKER_MODES.length];
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.editingHex = this.activeMode === "hex";
      return;
    }

    // Enter — confirm selection
    if (input === "\r" || input === "\n") {
      this.confirmSelection();
      return;
    }

    // Mode-specific input
    if (this.activeMode === "hex" && this.editingHex) {
      this.handleHexInput(input);
    } else if (this.activeMode !== "hex") {
      this.handleListNavigation(input);
    }
  }

  /** Handle up/down navigation in the option list. */
  private handleListNavigation(input: string): void {
    const options =
      this.activeMode === "theme" ? this.themeOptions : this.ansiOptions;

    if (input === "\x1b[A" || input === "\x1bOA") {
      // Up
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
      }
      return;
    }
    if (input === "\x1b[B" || input === "\x1bOB") {
      // Down
      if (this.selectedIndex < options.length - 1) {
        this.selectedIndex++;
      }
      return;
    }

    // Home / End keys for jumping
    if (input === "\x1b[H" || input === "\x1bOH") {
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      return;
    }
    if (input === "\x1b[F" || input === "\x1bOF") {
      this.selectedIndex = options.length - 1;
      return;
    }

    // Any printable char in hex mode triggers editing
    if (this.activeMode === "hex" && input.length === 1 && /[\x20-\x7e]/.test(input)) {
      this.editingHex = true;
      this.hexBuffer = "#" + input;
      this.hexError = null;
    }
  }

  /** Handle text input for the hex mode. */
  private handleHexInput(input: string): void {
    // Backspace
    if (input === "\x7f" || input === "\b") {
      if (this.hexBuffer.length > 1) {
        this.hexBuffer = this.hexBuffer.slice(0, -1);
        this.hexError = null;
      }
      return;
    }

    // Home / End — not meaningful in hex input, ignore
    if (input.startsWith("\x1b")) {
      return; // ignore other escape sequences in hex input
    }

    // Printable chars — append (hex chars only)
    if (input.length === 1 && /^[0-9a-fA-F#]$/.test(input)) {
      // If starting fresh, include the hash
      if (this.hexBuffer === "" && input !== "#") {
        this.hexBuffer = "#" + input;
      } else if (this.hexBuffer.length < 7) {
        this.hexBuffer += input;
      }
      this.hexError = null;
      return;
    }
  }

  /** Confirm the currently selected/entered color. */
  private confirmSelection(): void {
    let value: string;

    if (this.activeMode === "theme") {
      value = this.themeOptions[this.selectedIndex]?.value ?? "accent";
    } else if (this.activeMode === "ansi") {
      value = this.ansiOptions[this.selectedIndex]?.value ?? "white";
    } else {
      // Hex mode
      if (validateHex(this.hexBuffer)) {
        value = this.hexBuffer;
      } else {
        this.hexError = "Invalid hex — must be #rrggbb (6 hex digits)";
        return;
      }
    }

    this.onSelect(value);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  dispose(): void {
    // Nothing to clean up
  }
}
