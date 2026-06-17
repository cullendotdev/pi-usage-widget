/**
 * /usage — Usage statistics dashboard
 *
 * Shows an inline widget with usage stats grouped by provider.
 * Sessions persist configuration across restarts.
 * Ctrl+Alt+U cycles widget display modes, Alt+U cycles time scopes.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { CancellableLoader, Container, Spacer, truncateToWidth } from "@earendil-works/pi-tui";
import { getUsageData } from "./data-collection.js";
import { loadConfig, saveConfig } from "./config-persistence.js";
import { SettingsMenu } from "./settings-menu.js";
import { UsageComponent } from "./usage-modal.js";
import { UsageWidget } from "./usage-widget.js";
import { initTerminalPalette } from "./terminal-palette.js";
import type { UsageData } from "./types.js";

export default function (pi: ExtensionAPI) {
  // =========================================================================
  // /usage — Interactive usage dashboard modal
  // =========================================================================

  pi.registerCommand("usage", {
    description: "Show usage statistics dashboard",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;

      const data = await ctx.ui.custom<UsageData | null>(
        (tui, theme, _kb, done) => {
          const loader = new CancellableLoader(
            tui,
            (s: string) => theme.fg("accent", s),
            (s: string) => theme.fg("muted", s),
            "Loading Usage...",
          );
          let finished = false;
          const finish = (value: UsageData | null) => {
            if (finished) return;
            finished = true;
            loader.dispose();
            done(value);
          };

          loader.onAbort = () => finish(null);

          getUsageData(loader.signal)
            .then((d) => finish(d))
            .catch(() => finish(null));

          return loader;
        },
      );

      if (!data) return;

      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new Spacer(1));
        container.addChild(
          new DynamicBorder((s: string) => theme.fg("border", s)),
        );
        container.addChild(new Spacer(1));

        const usage = new UsageComponent(
          theme,
          data,
          () => tui.requestRender(),
          () => done(),
        );

        return {
          render: (w: number) => {
            const borderLines = container
              .render(w)
              .map((l) => truncateToWidth(l, w));
            const usageLines = usage.render(w);
            const bottomBorder = theme.fg("border", "\u2500".repeat(w));
            return [...borderLines, ...usageLines, "", bottomBorder].map((l) =>
              truncateToWidth(l, w),
            );
          },
          invalidate: () => container.invalidate(),
          handleInput: (input: string) => usage.handleInput(input),
          dispose: () => {},
        };
      });
    },
  });

  // =========================================================================
  // Footer Widget — session lifecycle, data refresh, keyboard shortcuts
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

  async function updateWidgetData(
    widget: UsageWidget,
    signal: AbortSignal,
  ): Promise<void> {
    const data = await getUsageData(signal);
    if (!signal.aborted) widget.setData(data);
  }

  function scheduleDebouncedRefresh(widget: UsageWidget): void {
    if (debounceTimer) clearTimeout(debounceTimer);
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
    if (periodicTimer) clearInterval(periodicTimer);
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

  function cleanupSession(): void {
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
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // Query terminal palette in the background (best-effort)
    initTerminalPalette().catch(() => {});

    cleanupSession();

    const config = loadConfig();
    const widget = new UsageWidget(ctx.ui.theme, config);
    currentWidget = widget;

    const controller = new AbortController();
    currentAbortController = controller;
    await updateWidgetData(widget, controller.signal).catch(() => {});
    currentAbortController = null;

    const placement = "aboveEditor";
    ctx.ui.setWidget(
      "usage-stats-widget",
      (tui) => {
        widget.setTui(tui);
        return {
          render: (w: number) => widget.render(w),
          invalidate: () => widget.invalidate(),
        };
      },
      { placement },
    );

    startPeriodicRefresh(widget);
    unsubMessageEnd = pi.on("message_end", () =>
      scheduleDebouncedRefresh(widget),
    );
  });

  pi.on("session_switch", (_event, ctx) => {
    if (!ctx.hasUI) return;
    cleanupSession();
  });

  pi.on("session_end", () => cleanupSession());

  // =========================================================================
  // Keyboard Shortcuts
  // =========================================================================

  pi.registerShortcut("ctrl+alt+u", {
    description: "Cycle usage widget display mode",
    handler: async () => currentWidget?.cycleMode(),
  });

  pi.registerShortcut("alt+u", {
    description: "Cycle usage widget time scope",
    handler: async () => currentWidget?.cycleScope(),
  });

  // =========================================================================
  // Commands
  // =========================================================================

  pi.registerCommand("cycle-usage-mode", {
    description: "Cycle usage widget display mode",
    shortcuts: ["ctrl+alt+u"],
    handler: async () => currentWidget?.cycleMode(),
  });

  pi.registerCommand("cycle-usage-scope", {
    description: "Cycle usage widget time scope",
    shortcuts: ["alt+u"],
    handler: async () => currentWidget?.cycleScope(),
  });

  pi.registerCommand("usage-settings", {
    description: "Open usage widget settings",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;

      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        const menu = new SettingsMenu(theme, tui, () => {
          done();
          // After settings menu closes, reload config and update widget
          if (currentWidget) {
            currentWidget.updateConfig(loadConfig());
          }
        });

        return {
          render: (w: number) => menu.render(w),
          invalidate: () => {},
          handleInput: (input: string) => menu.handleInput(input),
          dispose: () => menu.dispose(),
        };
      });
    },
  });
}
