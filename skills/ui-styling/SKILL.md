# UI Styling — Accessibility Reference

> Adapted from the `ui-styling` skill of
> [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT).
> The original targets shadcn/ui + Radix primitives; this fork hand-rolls its
> primitives, so the accessibility invariants Radix would give us for free are written
> down here as explicit requirements.

## When to use

Anything a keyboard or a screen reader touches: modals, menus, forms, icon buttons,
toasts, live download updates — plus any a11y review. The `jsx-a11y` plugin in the
lint gate catches a subset mechanically; this file is the manual contract.

## Keyboard map (expectations per surface)

Tab order equals visual order: title bar → sidebar → content → bottom download panel →
modals when open. Never reorder focus with DOM order tricks or positive `tabindex`.

| Key / gesture       | Expected behavior                                                  | Launcher surface                                                               |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `Tab` / `Shift+Tab` | Move in visual order; only the open modal's contents are reachable | Whole app; modal open = focus trap, closed = focus back to trigger             |
| `Esc`               | Close the topmost modal/menu; focus returns to trigger             | `modal.tsx` handles topmost-check + return — keep for every new overlay        |
| `Enter` / `Space`   | Activate buttons, checkboxes, rows rendered as buttons             | Candidate rows in the import wizard, queue rows, settings rows                 |
| Arrow keys          | Move within menus/lists/dropdowns; confirm with Enter              | `dropdown-menu`, `select-field`, context menus                                 |
| Drag reorder        | Must have a single-pointer and keyboard alternative                | Download queue: move up/down buttons are the keyboard path — never remove them |

No keyboard traps outside an intentionally-open modal. Custom components built on
`div`/`span` need `role` + `tabindex` + key handlers — prefer native `button`/`input`
(the codebase already does).

## Icon semantics — decision tree

Ask what the icon **does**, not what the glyph looks like:

1. **Decorative** — sits beside visible text that already carries the meaning
   (label + icon in the same control): mark `aria-hidden="true"`; no alt, no label.
2. **Meaningful** — standalone image/icon whose information is not in text nearby:
   give a text alternative (`aria-label`, `alt`, or visually-hidden text). Game covers
   and the status glyphs in the bottom panel are meaningful.
3. **Control** — icon alone is the interactive element: accessible name
   (`aria-label`, e.g. "Remove save path") **plus** applicable state
   (`aria-pressed`, `aria-expanded`, `aria-selected`), ≥24 px hit area.

The same glyph can be decorative in one component and a control in another — decide
per use, never per icon name.

## Form validation UX

- **Validate on blur**, not on keystroke; clear the error on valid input. Never
  validate empty fields the user has not visited yet.
- Error message sits **directly below the field**, in `$error-color`, linked with
  `aria-describedby`; field gets `aria-invalid="true"`.
- Failed submit with multiple errors → render a focusable **error summary** at the top,
  focus it, and link each item to its field. Without a summary, focus the first invalid
  field. Inline field errors always stay visible alongside.
- Labels are always visible (`<label htmlFor>`); required fields are marked visually
  **and** for screen readers (`<span className="sr-only">(required)</span>` pattern);
  a placeholder is a hint, never a label.
- Helper/hint text that must survive typing belongs under the field
  (`aria-describedby` can point to hint and error together).
- Read-only ≠ disabled: read-only shows the value with normal contrast and is
  focusable/selectable; disabled is opacity 0.5 + inert.

## Live regions (download progress and toasts)

- **One** `aria-live="polite"` region announces download status **changes** as complete
  contextual phrases: "Cyberpunk 2077 download paused", "Hytale download finished".
  Not one region per stat, not one announcement per percentage tick — state
  transitions only, atomically.
- Progress values themselves (%, speed, ETA) are visual; screen readers get them via
  the change announcements, not by spamming a region every second.
- In-flight scans/long ops: `aria-busy="true"` + visible spinner on the control
  (import-wizard "Scan system" button is the reference), with a recovery path
  (Retry) on failure.
- Toasts (redux `toast-slice`): `aria-live="polite"` container, auto-dismiss 3–5 s,
  never move or steal focus; destructive-result toasts carry an Undo action when the
  operation is reversible.
- Errors that need attention **now** may use `role="alert"` (assertive) — sparingly.

## Testing gates (before UI delivery)

- **Keyboard-only pass:** unplug the mouse; complete the core loops — browse catalogue,
  open game details, start a download, open settings, import a game via the wizard.
- **200 % zoom:** Electron `webContents.setZoomFactor(2)` (or OS scaling) — no clipped
  controls, no lost focus targets, sidebar/grid still usable.
- **Contrast:** body text ≥4.5:1, large text/non-text UI ≥3:1 against the real dark
  backgrounds (`#121212`, `#0d0d0d`); check hover/pressed/disabled states too —
  a state that cannot be distinguished is a failed state.
- **Screen reader smoke:** labels announced, icon-only buttons named, modal
  open/close announced, download status changes spoken once each.
- **Lint:** `corepack yarn lint` — the `jsx-a11y` rules must stay green; new violations
  block the change.
