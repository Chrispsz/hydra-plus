# Design System — SCSS Token Architecture, States, Component Specs

> Adapted from the `design-system` skill of
> [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT)
> for Hydra Plus: SCSS modules, dark-only theme, Electron desktop launcher surfaces.
> Source of truth for values: `src/renderer/src/scss/globals.scss`.

## When to use

Read before touching any `.scss` module, creating a component, choosing a color,
spacing, z-index, duration, or reviewing a diff that changes how something looks.

## Token architecture — three layers, SCSS form

`globals.scss` organizes tokens in three commented layers. Components import it once
(`@use "../../scss/globals.scss";`) and consume tokens as `globals.$<token>`.

| Layer         | Purpose                         | Changes                      | Example                                    |
| ------------- | ------------------------------- | ---------------------------- | ------------------------------------------ |
| 1. Primitives | Raw values, no meaning          | Rarely (rebrand only)        | `$brand-teal`, `$spacing-unit: 8px`        |
| 2. Semantic   | Purpose aliases over primitives | Per theme / palette decision | `$color-background`, `$color-text-body`    |
| 3. Component  | Component-scoped aliases        | Per component need           | `$button-bg: $color-accent` (via semantic) |

Rule chain: **a component SCSS module never declares a raw value** — it may only
reference semantic or component tokens. A raw hex that appears in a component
is debt: promote it to the semantic layer (`$color-<role>-hover`) and consume
the alias — as done for the button hover tints (`$color-muted-hover` /
`$color-danger-hover` in `globals.scss`).
The payoff: a palette swap = editing **one semantic block** in `globals.scss`, not
grep-and-replace across every module.

### Current palette (primitives preserved by the token re-structure)

| Token (semantic role)    | Value                       | Used for                                                          |
| ------------------------ | --------------------------- | ----------------------------------------------------------------- |
| `$background-color`      | `#121212`                   | app background, modal surface                                     |
| `$dark-background-color` | `#0d0d0d`                   | alternate/recessed surfaces, dark button variant                  |
| `$body-color`            | `#d0d1d7`                   | body text                                                         |
| `$muted-color`           | `#f0f1f7`                   | headings/emphasis text, inverted text on buttons                  |
| `$border-color`          | `rgba(255, 255, 255, 0.08)` | dividers, card outlines, panel borders                            |
| `$success-color`         | `#1c9749`                   | completed downloads, sync ok                                      |
| `$danger-color`          | `#801d1e`                   | destructive surfaces (danger button bg)                           |
| `$error-color`           | `#e11d48`                   | error text, error borders, failure states                         |
| `$warning-color`         | `#ffc107`                   | warnings, quota/partial states                                    |
| `$brand-teal`            | `#16b195`                   | accent: focus rings, active nav, links, chips                     |
| `$brand-blue`            | `#3e62c0`                   | secondary accent (info)                                           |
| `$spacing-unit`          | `8px`                       | every gap/padding is `n * $spacing-unit` (4px micro-gaps allowed) |

Supporting non-color tokens: `$disabled-opacity: 0.5`, `$active-opacity: 0.7`, font
sizes `$body-font-size: 14px` / `$hint-font-size: 13px` / `$small-font-size: 12px`,
and the z-index scale below. Accent-only primitives (`$platinum-cyan`,
`$classics-rainbow`, `platinum-gradient` mixin) are reserved for specific
subscriptions/skins — do not reuse them as general accents.

**Dark-only note:** we ship a single dark theme. There is no light mode to pair with,
so semantic tokens have exactly one value today; if a light theme ever lands it must be
a semantic-override layer (never per-component hex edits). Every color decision is
still made against the dark backgrounds — contrast is verified directly on `#121212` /
`#0d0d0d`, never assumed from the token name.

## State matrix

When multiple states apply at once, the higher row wins. These recipes are binding.

| Priority | State    | Recipe                                                                                                                  |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1        | disabled | real `disabled` attribute + `opacity: globals.$disabled-opacity` (0.5) + `pointer-events: none` + `cursor: not-allowed` |
| 2        | loading  | spinner (replaces/overlays label) + `aria-busy="true"` + `pointer-events: none`; keep the element's dimensions stable   |
| 3        | active   | pressed feedback under **150 ms**, opacity/color/transform only — zero layout shift (see `button.scss &:active`)        |
| 4        | focus    | `:focus-visible` ring: 2px `$brand-teal` + 2px offset, ≥3:1 against adjacent colors; never remove outlines              |
| 5        | hover    | subtle color/opacity shift, 150 ms; never the only way to reach a function (no hover-only affordances)                  |
| 6        | default  | base appearance                                                                                                         |

The fork has no global focus-visible rule yet — scope it per component until globals
provide one (pattern used in `sidebar-adding-custom-game-modal.scss`). Disabled still
needs its semantic attribute so assistive tech reports it; never fake disabled with a
class alone.

## Component specs (launcher components)

### Button (`components/button`)

- Heights: **32 px** compact (dense rows, panel actions), **40 px** default
  (`min-height: 40px` today), **48 px** primary CTA (hero, settings, wizard footer).
- Variants: `--primary`, `--outline`, `--dark`, `--danger` — variant styles only swap
  semantic tokens, never introduce new raw values.
- Icon-only buttons **must** have `aria-label` and keep ≥24 px hit area.
- Loading: spinner inside the button + `aria-busy` + disabled; do not hide the button
  or change its width (the import wizard's "Scanning system…" is the reference).

### Input — `text-field`, `select-field`, `checkbox-field`, `radio-field`

- The label is **always visible**; a placeholder is never a label. Helper/hint text
  sits persistently under the field, not in a tooltip.
- Error text goes directly below the field, linked via `aria-describedby`, error color
  `$error-color` + `aria-invalid`.
- Validate on **blur**, not keystroke (see `ui-styling` for the full form contract).

### Card — `game-card`, `vertical-cover-card`

- Interactive variant (library grid): hover lift is **transform-only**
  (`translateY`/`scale`, 150–200 ms). Never animate `width`/`height`/`margin` — the
  grid is virtualized and reflows would jitter scrolling.
- Cover art reserves exact dimensions (fixed `aspect-ratio` + measured cell) so images
  never cause layout shift; skeletons use the same box.

### Badge / Chip — `badge`, `steam-library-badge`, sidebar/filter chips

- One line only: `white-space: nowrap` + `overflow: hidden` + `text-overflow: ellipsis`
  - full text in `title`/tooltip.
- A `+n` overflow chip is an operable disclosure (click expands the hidden values),
  not a dead label.

### Dialog / Modal (`components/modal`, `confirmation-modal`, `shared-modals`)

- Focus is trapped while open; **Esc** closes the topmost modal; focus returns to the
  trigger element on close (stacking is already handled via the topmost-modal check —
  keep that behavior).
- Scrim: measured against the real content behind it, ~`rgb(0 0 0 / 0.5)` composed
  result, strong enough to isolate the modal on `#121212`.
- Enter animation comes from the trigger direction (current `scale-fade-in` 200 ms is
  right); **exit runs faster** than enter. The exit is now the `$motion-fast` token
  (150 ms) on both the content and the scrim, and `modal.tsx` holds the tree for the
  matching `MODAL_EXIT_DURATION_MS` constant before unmounting, so the animations
  always complete first. Remaining structural note: the close is still JS-timer-driven
  (rAF loop) — keep unmount independent of `animationend` events if that loop is ever
  revisited.
- `clickOutsideToClose` only for non-destructive modals; destructive confirms always
  require an explicit choice.

### Tables / rows — download queue, settings lists, snapshot history

- Numeric columns (progress %, speed, sizes, ETA) are **right-aligned** and use
  `font-variant-numeric: tabular-nums` so digits do not dance while values tick.
- Row actions keep their hit area when the row is hovered/selected; row height changes
  are forbidden during state transitions.

## Layout rules

- **Dividers must be visible:** `$border-color` at `rgba(255,255,255,.08)` is subtle on
  purpose; never lower it further. Group separation uses borders, spacing, or
  elevation — never a third gray.
- **Spacing rhythm:** every gap/padding is a multiple of `$spacing-unit` (8 px; 4 px
  micro-gaps allowed). No arbitrary `7px`/`13px` values.
- **z-index scale (documented, exhaustive):**

  | Token                   | Value  | Layer                                                     |
  | ----------------------- | ------ | --------------------------------------------------------- |
  | (content)               | 0/auto | pages, cards, sidebar                                     |
  | `$bottom-panel-z-index` | 3      | download bottom panel                                     |
  | `$title-bar-z-index`    | 4      | window title bar                                          |
  | `$backdrop-z-index`     | 4      | modal scrim                                               |
  | `$modal-z-index`        | 5      | modals (`role="dialog"`)                                  |
  | (popover/tooltip)       | 6–10   | popovers, dropdowns, tooltips — above modals, below toast |
  | `$toast-z-index`        | 150    | toasts — always top                                       |

  Never invent new z-index literals; add a token to globals if a new layer is truly
  needed. Fixed surfaces (bottom panel, title bar) require offset padding in the
  scrolling content behind them.

## Motion

| Token  | Duration | Used for                                          |
| ------ | -------- | ------------------------------------------------- |
| fast   | 150 ms   | hover, color/opacity, pressed feedback            |
| normal | 200 ms   | transforms, panel transitions, modal enter        |
| slow   | 300 ms   | large surfaces (hero changes, full-panel reveals) |

- Easing: decelerate on enter, accelerate on exit; **`linear` only for constant-rate
  progress** (download progress bars) and continuous rotation (spinners).
- Exits are 60–70 % of their enter duration (200 in → ≤140 out).
- Every animation must express cause→effect; no decorative motion, no lingering fades
  below opacity 0.2.
- All motion is cancellable: rapid state toggles must safely replace an in-flight
  micro-interaction, and logic must never depend on an `animationend` firing.
- `@media (prefers-reduced-motion: reduce)` is the global kill-switch — new animations
  must ship with it (pattern: `sidebar-adding-custom-game-modal.scss`), until globals
  carries the switch for everyone.
