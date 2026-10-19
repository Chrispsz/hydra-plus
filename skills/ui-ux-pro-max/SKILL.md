# UI/UX Pro Max — Launcher Rulebook

> Adapted from the [ui-ux-pro-max skill pack](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
> (MIT): its 119 UX guidelines plus the pro-rules pre-delivery checklist, distilled to
> the rules that matter on this launcher. Companion references:
> [`../design-system`](../design-system/SKILL.md) (tokens/specs),
> [`../ui-styling`](../ui-styling/SKILL.md) (a11y detail).

## When to use

Any change that affects how the launcher looks, feels, moves, or is interacted with —
new surfaces (sidebar, library grid, download queue, modals, settings, game-details
hero, forms), component work, or a UX review pass. Skip for pure backend logic.

## Priority triage

Work top-down; a lower row never blocks a higher one.

| #   | Category                   | Impact   | Must have (launcher reading)                                                     |
| --- | -------------------------- | -------- | -------------------------------------------------------------------------------- |
| 1   | Accessibility              | CRITICAL | 4.5:1 text contrast on dark, visible focus, aria-labels, full keyboard operation |
| 2   | Interaction                | CRITICAL | ≥24 px targets, <150 ms pressed feedback, loading state on async actions         |
| 3   | Performance                | HIGH     | virtualized lists, reserved cover dimensions (no CLS), lazy heavy routes         |
| 4   | Style/Layout               | HIGH     | semantic tokens only, z-index scale, 8 px rhythm, bottom-panel offset            |
| 5   | Typography/Color/Animation | MED      | tabular numbers, motion durations, exit-faster-than-enter, reduced-motion        |
| 6   | Forms                      | MED      | visible labels, blur validation, errors near the field, undo for destructive     |
| 7   | Charts/Data                | LOW      | none today; if a chart ever lands, color is never the only signal                |

## The 25 launcher rules

Each rule: ID · one-line rule · where it bites in this launcher.

| ID                              | Rule (one line)                                                                                 | In this launcher                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `focus-states`                  | Every interactive element shows a visible focus ring (2 px, `:focus-visible`).                  | Sidebar items, game cards, modal controls, settings toggles — scope per component until globals cover it.              |
| `reduced-motion`                | One global kill-switch honors `prefers-reduced-motion`.                                         | Ship the media query with every new animation (reference: import-wizard spinner); kill decorative motion first.        |
| `number-tabular`                | Tabular figures for any ticking number.                                                         | Download %, speed, size, ETA in bottom panel and queue rows: `font-variant-numeric: tabular-nums`.                     |
| `empty-states`                  | Empty is a screen with a message **and** a CTA.                                                 | No games → "Add a game" / browse catalogue; no downloads → open downloads page; 0 scan results → manual add.           |
| `error-recovery`                | Offer the retry path next to the failure.                                                       | Scan failure shows error + Retry inline; failed downloads offer retry in place, not a toast far away.                  |
| `progressive-loading`           | Skeletons reserving **exact** dimensions for async content.                                     | Game covers/heroes: fixed aspect-ratio boxes + shimmer; never a blank gap that jumps when art loads.                   |
| `content-jumping`               | Reserve space for async content before it arrives.                                              | Hero banner, download panel rows, sidebar counts — sizes are known up front; hold the box.                             |
| `virtualize-lists`              | Lists ≥50 rows are virtualized.                                                                 | Sidebar and library grid already use `@tanstack/react-virtual` — keep it; apply to any new long list.                  |
| `state-preservation`            | Back navigation restores scroll + filters.                                                      | Game-details → back must return to the same library position and filter state (virtualizer offset + params).           |
| `fixed-element-offset`          | Fixed surfaces get offset padding in the content behind them.                                   | Bottom download panel hides the last rows unless the page reserves bottom padding.                                     |
| `no-emoji-icons`                | Never emoji as UI icons.                                                                        | Use `@primer/octicons-react` (primary family); phosphor/lucide only where octicons lacks a glyph.                      |
| `icon-hit-areas`                | Icon targets ≥24 px, padded, not shrunken.                                                      | Row action icons (remove path, menu chevrons, close X) need padding/hit-area, not bare 12 px glyphs.                   |
| `icon-context`                  | Decorative → `aria-hidden`; meaningful → text alternative; control → name + state.              | Icon beside a visible label = decorative; standalone status icon = labeled; icon button = `aria-label` + state.        |
| `modal-escape`                  | Every modal has Esc + a visible close; no dead ends.                                            | Topmost modal closes on Esc, focus returns to trigger; destructive confirms never close on outside click.              |
| `modal-motion`                  | Modals animate from their trigger; exits are quicker than enters.                               | Enter `scale-fade-in` 200 ms is right; the 400 ms JS-timed close is a deviation to fix (target ≤140 ms).               |
| `inline-validation`             | Validate on blur, never on keystroke.                                                           | Import wizard title, custom paths, settings forms: show errors after the user leaves the field.                        |
| `error-clarity`                 | Errors state the cause **and** the fix.                                                         | "Scan failed: could not read installed apps. Retry, or add the game manually." beats "Error".                          |
| `undo-support`                  | Destructive actions are undoable or confirmed.                                                  | Remove save path / remove game → toast with Undo when feasible, else an explicit confirm dialog.                       |
| `destructive-emphasis`          | Danger color + spatial separation from safe actions.                                            | Danger zone lives as the **last** section, separated, `$danger-color` — keep that pattern in every options modal.      |
| `nav-label-icon`                | Navigation items carry icon **and** text label.                                                 | Sidebar already does this; icon-only nav anywhere is a regression.                                                     |
| `consistent-live-badge-updates` | ONE polite live region announces status changes as complete contextual phrases.                 | Download status (paused/finished/failed) → a single `aria-live="polite"` region; never one per stat, never per % tick. |
| `dark-mode-pairing`             | Decide contrast per theme against real backgrounds.                                             | We are dark-only: verify every pair on `#121212`/`#0d0d0d` directly; a light theme, if ever, is a token swap.          |
| `exit-faster-than-enter`        | Exits are 60–70 % of enter duration.                                                            | Modal close, panel collapse, toast dismiss — leaving should feel snappier than arriving.                               |
| `motion-meaning`                | Every animation expresses a cause→effect relationship.                                          | Panel opens because downloads was clicked; anything that is "just nice" gets deleted.                                  |
| `cancellable-state-transitions` | Rapid toggles safely replace in-flight micro-interactions; logic never waits on `animationend`. | Pause/resume spam, double-close modal: final state is set explicitly; the rAF-timed modal close is the anti-pattern.   |

## Canonical Pre-Delivery Checklist

Run before calling any UI work done — after the code compiles, before the commit.

**Process**

- [ ] Gates green on the final tree (`code-quality/SKILL.md` list).
- [ ] Tested with `prefers-reduced-motion: reduce` enabled.
- [ ] Dark contrast checked directly: body text ≥4.5:1, large text/UI ≥3:1 on `#121212`/`#0d0d0d`.
- [ ] Small-window test: resize the launcher window narrow; sidebar → icons, grid reflows, nothing clips or horizontal-scrolls.

**Visual quality**

- [ ] No emoji as icons; one icon family per hierarchy level (octicons first).
- [ ] Pressed/hover/disabled states change zero layout bounds (no shift, no jitter).
- [ ] Tokens everywhere: no raw hex/px/z-index literals inside component SCSS modules.

**Interaction**

- [ ] All targets ≥24 px; icon-only controls padded and labeled.
- [ ] Async actions show spinner + `aria-busy` + disabled, keeping stable dimensions.
- [ ] Focus ring visible on every interactive element; Tab order matches visual order.
- [ ] Labels are descriptive (screen-reader check); drag-only actions have a keyboard/button alternative (queue has move up/down buttons — keep).

**Forms & feedback**

- [ ] Labels always visible (never placeholder-as-label); required fields marked.
- [ ] Errors below the field, cause + fix, linked via `aria-describedby`; summary focused after a failed submit.
- [ ] One polite live region for download status changes; toasts never steal focus.

## Data pointers

The source pack's data catalogs — `styles.csv` (79 styles), `colors.csv` (192 palettes
with reasoning profiles), `typography.csv` (74 pairings), `motion.csv` (presets),
`ux-guidelines.csv` (all 119 rules) — live in the MIT repo above if a data-driven
choice is ever needed (e.g. comparing palette candidates). For this fork the practical
lever is simpler: **a palette swap is one semantic block in `globals.scss`** (see
`design-system/SKILL.md`); do not fork the token structure per feature.
