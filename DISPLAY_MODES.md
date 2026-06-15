# Display Mode Widget

This document describes new display mode widget for the usage extension.

---

## Five Display Modes (cycled via `Ctrl+Alt+U`)

### 1. Summary Mode

- Single line: `Usage: $0.1230 (Today)`
- Shows **only the total combined cost** and active "timerange"
- When no data: dimmed placeholder `Usage: --- (Today)`

### 2. Compact Mode

- Shows the provider name + combined costs for that provider models used in the timerange
- Multi line:

```
    Usage (Today):
      Deepseek: $0.1230
      Google: $1.2005
```

### 3. Detailed Mode (Collapsed)

- Shows a comprehensive usage breakdown of sessions, Msgs, Cost, Tokens (in and out) for all Providers
```
Usage (Today)              Sessions     Msgs     Cost   Tokens     ↑In    ↓Out   Cache
──────────────────────────────────────────────────────────────────────────────────────
▸ google                          5       25  $10.254   888.1k  800.1k     88k     19k
▸ deepseek                        1        5  $0.0014     8.3k    7.3k     999     19k
──────────────────────────────────────────────────────────────────────────────────────
```

### 4. Detailed Mode (Expanded)

- Shows a comprehensive usage breakdown of sessions, Msgs, Cost, Tokens (in and out) with
the providers expanded for details per model:

```
Usage (Today)              Sessions     Msgs     Cost   Tokens     ↑In    ↓Out   Cache
──────────────────────────────────────────────────────────────────────────────────────
▾ deepseek                       38      839    $1.16     2.2M      2M    157k     19k
    deepseek-v4-pro              25      718    $1.11     1.9M    1.8M    145k     12k
    deepseek-v4-flash            13      121    $0.06     298k    265k     12k      7k
▾ google                          8       37    $0.32     449k    349k    100k     19k
    gemini-3.1-pro-preview        3        7    $0.21      85k     75k     10k      4k
    gemini-3.1-flash-li...        4       28    $0.10     347k    262k     85k     14k
    gemini-flash-latest           1        1  $0.0089      31k     26k      5k      0k
──────────────────────────────────────────────────────────────────────────────────────
```

### 5. Hidden
- Widget is hidden, consumes zero space

### Cycle Order

Summary → Compact → Detailed (Collapsed) -> Detailed (Expanded) → Hidden → Summary

---

## Scope Toggle (`Ctrl+Shift+U`)

Toggles between:

- Scope (date time ranges): Last Hour, Today, Yesterday, This Week, Last Week, This Month, All Time

---

## Visual Design

- **Widget placement**: above the editor
- **Colorized stat labels** using theme colors:
  - `theme.fg("accent")` for headers
  - `theme.fg("muted")` for labels
  - `theme.fg("dim")` for placeholder/zero values
- **Cost formatting**: always 3 decimal places (`$0.123`), using `toFixed(3)`
- **Token formatting**: reuse pi footer conventions
  - 0–999: raw number
  - 1k–9.9k: `X.Xk`
  - 10k–999k: `Xk`
  - 1M–9.9M: `X.XM`
  - 10M+: `XM`
- **Default pi footer remains unchanged** (pwd, git branch, context %, model info)

---

## State Management

- Each new session starts: **Summary mode**, **Today scope**
- No persistence across sessions
- Tracker reinitialized on `session_start`
- Widget re-renders in real-time on message end. Also periodic re-render in case subagents are working
---

## What to Integrate

When forking the existing extension that already handles usage tracking:

1. Add the **three display modes** + hidden state with `Ctrl+Alt+U` cycling
2. Add the **scope toggle** with `Ctrl+Shift+U`
3. Ensure the **visual styling** matches (colorized labels, token/cost formatting)
4. Ensure the **default pi footer is untouched**
