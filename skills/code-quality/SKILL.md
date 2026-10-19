# Code Quality — Fork Engineering Discipline

> Fork-specific rules, inspired by the community patterns surfaced in the skills
> research: pullboard's "nothing ships until a second agent verifies" and
> anti-samcheonpo's anti-false-completion harness, plus this fork's own hard rules.
> (The UI/UX rules live in the sibling skills; this one applies to every task.)

## The gate suite — run in this order, all of them, every delivery

From the repo root (`corepack yarn <script>`):

| #   | Command                          | Catches                                                                    | Notes                                                                                     |
| --- | -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `corepack yarn typecheck:node`   | Main/preload/shared TS errors                                              | `tsconfig.node.json` (main, preload, shared, types, locales index)                        |
| 2   | `corepack yarn typecheck:web`    | Renderer TS errors, IPC contract drift in `declaration.d.ts`               | `tsconfig.web.json`                                                                       |
| 3   | `corepack yarn test`             | Logic regressions                                                          | `node:test`; colocated `src/**/*.test.ts` + `scripts/*.test.mjs`                          |
| 4   | `corepack yarn check:ota-bridge` | Preload ↔ renderer drift (member added to one side, missing on the other) | Defaults to `--base local` in `package.json` — the mode for a fork publishing full builds |
| 5   | `corepack yarn lint`             | eslint, incl. `jsx-a11y` in the renderer                                   |                                                                                           |
| 6   | `corepack yarn format-check`     | prettier formatting                                                        | Run `corepack yarn prettier --write <paths>` on what you touched                          |
| 7   | `node /home/z/i18n-count.cjs`    | en/pt-BR key parity                                                        | Run from the repo root; must print `I18N SYNCHRONIZED` (0 missing either way)             |

Gates are cheap; rework is not. If a gate is red for a reason unrelated to your change,
prove it: `git stash` → re-run the gate → `git stash pop` → cite the pre-existing
failure verbatim in your report. A gate you did not run is a gate that failed.

## Verification culture (nothing ships unverified)

- **A task is done only when the gates pass on the FINAL tree** — not on an earlier
  snapshot, not "it was green before I merged". Re-run after the last edit.
- Second-agent rule: significant changes get verified by someone other than the author
  (another agent running the gates and reading the diff counts; humans preferred for
  design calls).
- **Never claim completion without evidence.** The report states, per gate: command,
  exit status, and any deviation. "Should pass" and "probably fine" are deviations.
- Pre-existing warnings: quote them exactly and mark them pre-existing (with the stash
  proof above), never silently absorb them into your change.
- Deviations (design decisions, scope changes, skipped steps) are documented explicitly
  in the worklog entry — reviewers diff claims against reality.
- No secret ever gets persisted: credentials (PATs, OAuth secrets) are used inline,
  one-shot, and never written to remotes, git config, env files, or logs.

## Coding patterns

- **Pure functions + dependency injection for everything testable.** Reference
  pattern: `src/main/services/external-games/*` — `buildXCandidates(deps)` pure
  builders take injected `fs`/`env`/`registry` and are unit-tested without Electron;
  a thin `scanX()` does the real wiring and stays untested-but-trivial. Keep Electron
  imports out of pure modules so tests load on any machine.
- **Colocated node:test files**: `foo.ts` lives next to `foo.test.ts`
  (`custom-game-save-paths.ts` + `.test.ts`). No parallel `tests/` mirror tree.
- **No new dependencies** without a strong justification written down (what it
  replaces, maintenance/upstream-merge cost, supply-chain risk). Prefer platform
  APIs and the existing toolset first.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, …) — commitlint + husky enforce
  them; one logical change per commit, scope tag when it clarifies (`docs(skills): …`).
- IPC changes touch **four layers**: main event → `src/preload/index.ts` →
  `src/renderer/src/declaration.d.ts` → renderer hooks/slices. The OTA-bridge gate
  exists because these drift; keep the four layers in one commit.

## Lean-fork scope discipline

The fork is stability-first: a minimalist launcher that downloads and launches games
and backs up saves to the user's own Google Drive. Everything that does not serve that
must justify itself against upstream-merge cost and review surface.

**Out of scope — do not reintroduce:** achievements, souvenirs, chat/social, Epic
support, paid debrid services, big-bang rewrites. (These were deliberately removed /
never carried: they balloon the diff against upstream, add fragile external
dependencies, and contradict the free-only stance.) "Big-bang rewrites" includes
replacing storage (LevelDB), the download engine, or the theming approach in one
move — evolve in-place with green gates between steps.

**In scope tests for a new feature:** does it serve download / launch / cloud-saves?
Does it survive an upstream merge? Does it keep the i18n pair and the four IPC layers
consistent? If any answer is no, it is out.

## i18n rules

- Two locales ship: `en` and `pt-BR` (`src/locales/<locale>/translation.json`). pt-BR
  is a **real translation** — never English copy-paste; brand terms (e.g. "Hytale")
  may stay identical.
- **Parity is a hard gate**: every key must exist in both locales with non-empty
  values. `node /home/z/i18n-count.cjs` (from repo root) is the quick check; a missing
  key blocks the delivery.
- **Translation guard test pattern**: features with user-facing copy add a colocated
  test that (1) every new key exists and is non-empty in every locale, (2) locks the
  exact agreed EN + pt-BR copy, (3) asserts prose actually differs between locales,
  with documented exceptions for proper nouns. References:
  `src/renderer/src/pages/library/external-games-translations.test.ts` and
  `steam-library-translations.test.ts`.
- New UI text goes through i18next namespaces (`useTranslation`), never hardcoded
  strings in components.
