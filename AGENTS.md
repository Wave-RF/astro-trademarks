# AGENTS.md — AI agent instructions for `@wave-rf/astro-trademarks`

Context for AI coding agents (Claude Code, Copilot, Cursor, etc.) working on this repo. `CLAUDE.md` is a thin pointer here.

## Operating Rules

The non-negotiables, ordered by how often agents miss them. These override convenience: if a rule blocks you, satisfy it; don't work around it.

1. **Validate locally before every push** — `pnpm run verify` (Biome + `tsc --noEmit` + `node --test`). Don't use CI as your first feedback loop ([§Local-First Validation](#local-first-validation)). A change to the engine, the middleware, the component or the integration also runs **`pnpm run test:fixtures`** (real Astro builds) before pushing.
2. **A PR-branch push needs every pre-push reviewer satisfied** — run **`/prepush`**: it reads `scripts/pre-push-reviewers.sh`, runs the reviewers the change needs in parallel (fresh context), skips the rest *on the record*, and loops until each it ran returns `ship_it` ([§Agent PR Discipline](#agent-pr-discipline)).
3. **Every public-surface change updates its docs in the same PR** — a changed option, default, export, `Trademark` field, component prop, CSS variable, skip rule or notice wording must update the **`src/` JSDoc** **and** `README.md` ([§Documentation Sync](#documentation-sync)). Release notes are generated into GitHub Releases - there is no changelog to edit; just use the right Conventional-Commit type, because it decides whether the merge releases (§Release Process).
4. **No legal claims in the package.** Never ship a list of marks, a default owner, or wording about a specific company. Examples in docs are labelled illustrative; fixtures are test data. Notice wording changes are `feat`/`fix` with the before/after sentence in the PR body — they change what every consumer's site asserts.
5. **Address and resolve every review finding** — fix it or track it in an issue; never silently drop one ([§Review Response](#review-response)).
6. **Drafts only; valid title** — `gh pr create --draft` (never `gh pr ready`/approve); the PR **title** must pass Conventional Commits — check with `scripts/lint-pr-title.sh "<title>"` before creating ([§Agent PR Discipline](#agent-pr-discipline)).
7. **Never force-push or rebase a PR branch** — to absorb upstream, `git merge origin/main` ([§Branch Maintenance](#branch-maintenance)).
8. **Never hand-write markers or `--no-verify`** — if you're tempted, the gate is wrong-shaped for your situation; fix that instead ([§Don't bypass the gates](#dont-bypass-the-gates)).

## Project Overview

An Astro integration that marks the **first mention** of each third-party trademark on a page with ® or ™ and renders **that page's** notices. The site supplies its own registry (`defineTrademarks([...])`); nothing ships with legal claims.

- **The engine is Astro middleware**, registered by the integration with `addMiddleware` (order `pre`) in `astro:config:setup`. On every `text/html` response it parses the page (parse5, with source offsets), marks first mentions inside the content root(s), and fills the `<TrademarkNotices />` placeholder (`[data-tm-notices]` → `[data-tm-slot]`) with notices for **exactly the marks that same scan found**. There is deliberately **no rehype/remark plugin**: one HTML-level pass covers `.astro`, Markdown, MDX and Starlight alike.
- **Options reach the middleware through a virtual module** (`virtual:@wave-rf/astro-trademarks/config`) served by a Vite plugin the integration adds; the package is listed in `vite.ssr.noExternal` so that import is bundled, not handed to Node.
- **The pure core** (`src/core.ts`, exported as `./core`) has no Astro/DOM imports: `defineTrademarks`, `findTrademarks`, `markFirstMentions`, `trademarkNotices`, `noticesForText`.
- **Ships compiled JS** (`dist/`, built by `tsc -p tsconfig.build.json` in `prepack`) plus the raw `components/TrademarkNotices.astro` and `styles.css`. Source is TypeScript with `.ts` import specifiers (`rewriteRelativeImportExtensions`), erasable syntax only, so `node --test` runs the sources directly.

## Key Invariants

What must stay true. Each is guarded by a test; preserve the named invariant when you touch its code.

1. **One scan decides both symbols and notices.** `transformHtml` computes `found` in the same loop that places symbols; notices are `trademarkNotices(found, marks)`. Never derive notices from a second, wider scan (raw source, frontmatter, the whole `<body>`) — that is the bug class this package exists to fix: a notice for a mark that never got a symbol. Guarded by the derived-input test in `test/middleware.test.ts` and by the fixture oracle (`test/fixtures/expectations.mjs`), which checks built pages without using the package.
2. **Headings are never marked**, nor anything that repeats heading text (Starlight's `.sl-anchor-link`), nor navigation and menus inside content (`nav`, `menu`, `SKIP_ROLES`). Astro builds the TOC before render, so a heading symbol desyncs heading and TOC.
3. **Skip tiers.** `raw` (script/style/template/textarea/noscript/title, the placeholder): never read. `skip` (default tags/classes, presets, `SKIP_ROLES`, `aria-hidden`, `hidden`, `data-tm-skip`, `astro-island` outside `astro-slot`): no new symbol and a bare mention doesn't count, but a mention already followed by ®/™ counts as found + marked. `mark`: everything else inside a content root.
4. **Surgical edits only.** Edits are insertions/replacements at parse5 source offsets in the original string. Never re-serialise the document. A page with nothing to change is returned as the same string. If entity-aware decoding of a text node disagrees with parse5's value, the node is left alone **and not counted**.
5. **Gate on marks found, not on notices.** No mark found → remove the whole placeholder. Marks found but none with an owner → keep the shell (catch-all). Idempotent: re-running on output changes nothing.
6. **Case-sensitive by default; boundaries are hand-rolled** (`LEFT`/`RIGHT` in `src/core.ts`, Unicode letters/digits/marks + `_`, plus path/domain/handle exclusions and the URL-token check). Longest match at a position wins across case-sensitive and case-insensitive marks. Keep the regexes linear — they run over every page's text.
7. **Notice wording is conservative.** "registered" only when every mark in the sentence is ®; groups keyed by owner + qualifier + licensing; a verbatim `notice` always stands alone; ownerless marks produce no sentence.
8. **Machine-readable responses are untouched by default.** `text/markdown` / `text/plain` are returned as the same `Response` unless `machineReadable` opts in; every other type passes through as the same object.
9. **Rebuilt responses keep status, statusText and headers, and drop `content-length`.**
10. **Notice links are http(s) only and never trusted raw.** `isSafeLink` (absolute `http:`/`https:`, no whitespace, control characters, quotes, backticks, angle brackets or backslashes) runs in `defineTrademarks` validation and again at render; the URL is attribute-escaped in `href` and text-escaped as link text; `rel="noopener noreferrer"` is always set. Links are per mark and de-duplicated per notice.

## Build & Test Commands

```bash
pnpm install            # resolve deps (no committed lockfile — it's a library)
pnpm run setup          # one-time: install git hooks (git config core.hooksPath .githooks)
pnpm run typecheck      # tsc --noEmit (strict)
pnpm test               # node --test test/*.test.ts (fast: core, HTML engine, middleware)
pnpm run test:fixtures  # real `astro build` + `astro dev` + on-demand server: Astro 6, Astro 7, Starlight on both
pnpm run build          # tsc -p tsconfig.build.json -> dist/ (also runs on prepack)
pnpm run check          # biome check . (lint + format check) — the CI gate
pnpm run format         # biome format --write .
pnpm run verify         # biome check + typecheck + test, then write the tree marker
```

`test:fixtures` packs the package, installs the tarball into temp copies of `test/fixtures/{site,starlight}` with pinned Astro versions (`VARIANTS` in `scripts/test-fixtures.mjs`), and checks the output with an oracle that does not import the package. `KEEP=1` keeps the temp dirs; a name argument filters variants (`pnpm run test:fixtures -- starlight`). Bump the pinned versions there when a new Astro major lands.

## Local-First Validation

**Validate locally before pushing.** `pnpm run verify` runs the same gates as CI's `ci` job. On success it writes the tree-keyed marker `tmp/verify-passed-tree-<TREE>` (`tmp/` is gitignored).

Enforced via git hooks (installed by `pnpm run setup`; apply to humans and agents alike):

- **`.githooks/pre-commit`** runs `pnpm run verify` unless the current tree's marker already exists (cached).
- **`.githooks/pre-push`** requires `tmp/verify-passed-tree-<TREE>` for each pushed commit's tree. Tree-keyed, so `verify → commit → push` needs no re-run when the tree is unchanged. Skipped on CI (`$CI` set).

Bypass (`--no-verify`) is for human WIP only; agents must not (§Don't bypass the gates).

## Release Process

**Releases happen on merge**, driven by [semantic-release](https://semantic-release.org) (`.releaserc.json`, run by `publish-npm.yml` on every push to `main`). There is no release PR, no version bump commit and no token: the git tag `vX.Y.Z` is the version's source of truth, and GitHub Releases hold the notes. **The squash-merge title (a Conventional Commit, already enforced by the required `pr-title` check) decides whether the merge releases:**

| Title type | Release |
| ---------- | ------- |
| `fix:` `perf:` `revert:` | patch |
| `feat:` | minor |
| `!` after the type, or a `BREAKING CHANGE:` footer | **major** (no 0.x shielding; the first breaking change goes to `1.0.0`) |
| `deps:` `ci:` `chore:` `docs:` `test:` `refactor:` `build:` `style:` | none |

- `package.json` `version` is the placeholder `0.0.0-development`; semantic-release sets the real version in the CI workspace only. **Never bump it, never create tags by hand, never hand-edit `CHANGELOG.md`.**
- **Bootstrap:** until the one-time manual 0.1.0 publish and the `v0.1.0` tag exist, `scripts/release-guard.sh` makes the workflow skip semantic-release entirely. See [`RELEASING.md`](RELEASING.md) "Bootstrap (one-time)".
- The package ships compiled `dist/`; the workflow runs `pnpm run verify` then `pnpm run build` before semantic-release publishes.
- If a release fails, semantic-release opens a "release failed" issue; fix the cause and re-run the failed run. Caveat: the tag is pushed *before* publishing, so a failure after that point needs the tag deleted first (see RELEASING.md Failures).
- Use **`/release`** to see what the next merge would release. **Full detail** lives in [`RELEASING.md`](RELEASING.md).

## Review Response

Every review finding gets a substantive reply and is addressed — fixed, or tracked in an issue — before merge. Decide: accept, push back (with reasoning), or defer (open a tracking issue and link it). Never silently drop a finding, including ones outside the lane of whichever reviewer raised it. Bot reviewers (if configured) re-engage via their own trigger (e.g. `@coderabbitai review` in a PR comment — `gh pr comment` is allowed for agents).

## Branch Maintenance

To absorb upstream `main` into a PR branch — **merge, don't rebase**:

```bash
git fetch origin main
git merge origin/main --no-edit
```

Force-pushes (`--force`, `--force-with-lease`) are blocked by `.claude/settings.json` and by branch protection, and would lose inline review-thread anchors. Rebase requires a force-push, so it's wrong for the same reason. The `pre-push` hook will block until `pnpm run verify` re-runs after the merge (the merge commit's tree is new) — that's intended. If the merge conflicts, surface it to a human rather than auto-resolving.

## Agent PR Discipline

Agents follow the universal git hooks (pre-commit + pre-push in `.githooks/`). On top of that, PR-workflow rules with no human analog are checked by `.claude/hooks/agent-bash-gate.sh`. The gate is a guard rail against accidents, not adversarial enforcement.

### Drafts only

Create PRs with `gh pr create --draft`. Only humans flip draft → ready (`gh pr ready` is blocked) and only humans approve / request changes (`gh pr review --approve`/`--request-changes` are blocked). Adding/removing human reviewers is humans-only.

**PR title format** — the title becomes the squash-merge subject on `main` (which semantic-release parses), and is gated by the required `pr-title` check. Conventional Commits: `<type>(optional-scope)(optional-!): <subject>`, **≤ 72 chars**, subject lowercase-first, no trailing period. Types: `feat fix docs refactor test chore ci deps build perf revert style`. Validate before creating: `scripts/lint-pr-title.sh "<title>"`. The same script backs the local gate and the CI check, so they never drift.

### Pre-push self-review is mandatory on PR branches

Before pushing a non-main branch, **every** reviewer in `scripts/pre-push-reviewers.sh` must have a marker for HEAD — earned by **running** it (fresh context; writes its marker on `VERDICT: ship_it`) or by a **logged skip** (`scripts/skip-pre-push-review.sh <name> "<reason>"`) when it's genuinely out of lane. The list is the single source of truth — read it; don't hardcode it. The one-command form is **`/prepush`**. Today the gating reviewers are:

- **`pre-push-reviewer`** (code) — the full diff vs `main`, the latest commit, open PR comments/reviews, CI status, linked issues.
- **`docs-reviewer`** (docs) — `README.md`/the `src/` JSDoc for accuracy-vs-code, runnable examples, clarity, **plus** code↔docs sync (code that changed but whose docs didn't).

**`ship_it` requires zero findings at any severity** — a single `[MAY]` forces `iterate`. The orchestrator loops: address every finding, commit, re-invoke the reviewer(s) in fresh context, until all say `ship_it`. The push gate (`agent-bash-gate.sh`) lists any missing markers; `git push` succeeds only when every listed reviewer has one. On `block`, stop and surface it to the user.

### Adding a pre-push reviewer

The set is meant to grow (security is the obvious next). With **no** hook edits (they read the list at push time):

1. Write the subagent at `.claude/agents/<name>.md` (model it on `pre-push-reviewer.md`; end with the parseable `VERDICT: ship_it|iterate|block` line under the same strict rubric).
2. Add `<name>` to `scripts/pre-push-reviewers.sh` — *after* step 1 (a name with no agent file blocks every push until it exists).

The marker `tmp/<name>-passed-<HEAD>` is then required automatically, `review-marker.sh` writes it on `ship_it`, and `/prepush` launches it alongside the rest.

### Don't bypass the gates

- `--no-verify` is for human WIP; agents don't use it.
- Markers are written by tooling, never by hand: `tmp/verify-passed-tree-*` by `pnpm run verify`; `tmp/<reviewer>-passed-*` by the `review-marker.sh` SubagentStop hook on `ship_it`, or by `scripts/skip-pre-push-review.sh` for a deliberately-skipped reviewer (which logs the reason). Don't `touch`/`Write`/`Edit` a marker. To skip, use the skip command so it's recorded.

These are policy, not mechanically enforced — an agent can edit the gate itself. Trust beats whack-a-mole.

## Documentation Sync

Every change to the public surface updates its docs in the same PR:

| Change | Files to update |
| ------ | --------------- |
| Add/modify a `TrademarksOptions` option or its default | `src/options.ts` (type + JSDoc), `README.md` (Options table) |
| Add/modify a `Trademark` field | `src/core.ts` (type + JSDoc), `README.md` (The registry) |
| Change notice wording or grouping | `src/core.ts` (`trademarkNotices` JSDoc), `README.md` (Notice wording table), tests |
| Change a skip rule, preset or matching boundary | `src/html.ts` / `src/core.ts` JSDoc, `README.md` (What is never marked / Matching), golden tests |
| Change a component prop, class hook or CSS variable | `components/TrademarkNotices.astro`, `styles.css`, `README.md` (`<TrademarkNotices />`, Styling) |
| Add/modify an export or subpath | `src/index.ts`, `package.json` `exports`, `README.md` (The pure core) |
| Change `peerDependencies` / `engines` / verified Astro versions | `package.json`, `README.md` (Install, How it works), `scripts/test-fixtures.mjs` `VARIANTS` |
| Any change | a Conventional-Commit message (it decides the release; notes go to GitHub Releases) |

Before finishing, grep the identifiers you touched (option names, export names, class names, CSS variables) across `README.md`, `components/` and `src/` to catch staleness. Prose quality + code↔docs sync are gated by the `docs-reviewer`.

## Worktree workflow (`wt`)

This repo is set up for Worktrunk (`wt`, config in `.config/wt.toml`): `wt switch --create <branch>` seeds `node_modules/` from main (per `.worktreeinclude`), runs `pnpm install`, and installs the git hooks (`pnpm run setup`). `.worktrees/` is gitignored. Without `wt`, the manual equivalent is `git worktree add` + `pnpm install` + `pnpm run setup`.

## File Structure

```text
src/core.ts             → pure core: Trademark type, defineTrademarks, matching, markFirstMentions, notices (./core)
src/html.ts             → the HTML pass: transformHtml, skip rules, compound selectors, placeholder fill (./html)
src/handler.ts          → transformResponse + createTrademarksMiddleware (content-type routing, Response rebuild)
src/options.ts          → TrademarksOptions, defaults, resolveOptions (JSON-serialisable for the virtual module)
src/middleware.ts       → the addMiddleware entrypoint; reads options from the virtual module (./middleware)
src/index.ts            → the integration (default export) + re-exports
src/virtual.d.ts        → types for the virtual config module
components/TrademarkNotices.astro → the notices placeholder component (ships as source)
styles.css              → the .tm-symbol rule (injected by default)
test/*.test.ts          → node --test unit + golden tests
test/fixtures/          → fixture sites (site = plain Astro + MDX + node adapter, starlight) + the independent oracle
scripts/test-fixtures.mjs → packs, installs, builds, serves and checks the fixtures per Astro version
tsconfig.json / tsconfig.build.json → typecheck (src + test) / emit (src → dist)
.githooks/, .claude/, .github/, scripts/ → hooks, agent reviewers, CI + release tooling
```

## CI / Automation

- **`ci.yml`** — `ci` job: Biome + `tsc --noEmit` + `node --test` on every PR/push (Node 24). `fixtures` job: `pnpm run test:fixtures` (real Astro builds; slower, network-bound).
- **`pr-title.yml`** — Conventional-Commit title check (required).
- **`publish-npm.yml`** — release-on-merge: bootstrap guard, `verify`, `build`, then semantic-release + OIDC publish. ONE file (npm allows one trusted-publisher filename per package).
- Dependency updates: Renovate is planned (no Dependabot config).
- Third-party actions are pinned to commit SHAs with version comments where verified (none currently pending).
