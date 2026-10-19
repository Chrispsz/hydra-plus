# Hydra Plus — Skills

Adapted, launcher-focused skills for future coding agents (and humans) working on this
fork. Everything in this directory is documentation: `skills/` is markdown-only, it is
invisible to `tsconfig.node.json` / `tsconfig.web.json` and to eslint, and it is only
touched by prettier's formatting gate.

Source: distilled and re-hosted from the **ui-ux-pro-max** skill pack (MIT) —
<https://github.com/nextlevelbuilder/ui-ux-pro-max-skill> — and rewritten for this
codebase: SCSS modules (not Tailwind/shadcn), dark-only theming, Electron desktop
surfaces (sidebar, library grid, download queue / bottom panel, modals, settings pages,
game-details hero, forms).

## Index

| Skill                                       | Read when                                 | One line                                                                 |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| [`design-system`](./design-system/SKILL.md) | touching any SCSS or building a component | three-layer tokens, state matrix, component specs, z-index scale, motion |
| [`ui-ux-pro-max`](./ui-ux-pro-max/SKILL.md) | any UX-facing change or review            | priority triage, the 25 launcher rules, canonical pre-delivery checklist |
| [`ui-styling`](./ui-styling/SKILL.md)       | accessibility work, forms, live regions   | keyboard map, icon semantics, validation UX, a11y test gates             |
| [`code-quality`](./code-quality/SKILL.md)   | every task, before claiming done          | gate suite, verification culture, coding patterns, lean-fork scope       |

Rule of thumb: `code-quality` applies to every task; pick the other three by surface —
SCSS/tokens → `design-system`, interaction/UX decisions → `ui-ux-pro-max`, anything a
screen reader or a keyboard touches → `ui-styling`.

## How we use these

1. Read the matching skill **before** writing code. The rules here are the review
   baseline: reviewers (human or agent) may reject work that violates them.
2. Every change — UI or not — passes the gate suite before it is called "done" (full
   detail in [`code-quality/SKILL.md`](./code-quality/SKILL.md)):
   - `corepack yarn typecheck:node` and `corepack yarn typecheck:web` — TypeScript on
     both sides of the IPC bridge.
   - `corepack yarn test` — the `node:test` suite (colocated `*.test.ts` files).
   - `corepack yarn check:ota-bridge` — preload ↔ renderer drift (defaults to
     `--base local`, the mode for a fork that publishes full builds).
   - `corepack yarn lint` — eslint (the `jsx-a11y` plugin is active).
   - `corepack yarn format-check` — prettier.
   - `node /home/z/i18n-count.cjs` (run from the repo root) — en/pt-BR key parity; must
     print `I18N SYNCHRONIZED`.
3. UI deliveries additionally walk the pre-delivery checklist at the end of
   [`ui-ux-pro-max/SKILL.md`](./ui-ux-pro-max/SKILL.md) (reduced-motion, dark contrast,
   small window, icon discipline, pressed states, tokens, targets, labels).

## Attribution

- Original skill pack: [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
  by NextLevelBuilder — **MIT License**. The pack ships searchable data catalogs
  (79 styles, 192 palettes, 74 font pairings, 119 UX rules, motion presets, stack
  guides); consult it directly when a data-driven choice is needed.
- The files here are adaptations, not copies. Rules were selected, merged and
  contextualized for an Electron game launcher; tooling-specific content that does not
  apply to this fork (Tailwind/shadcn setup, mobile safe areas, GSAP, landing pages)
  was deliberately omitted. The fork's own engineering rules in
  [`code-quality/SKILL.md`](./code-quality/SKILL.md) come from the fork's history, not
  from the pack.
