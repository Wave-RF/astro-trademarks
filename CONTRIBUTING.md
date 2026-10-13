# Contributing

Thanks for contributing to `@wave-rf/astro-trademarks`.

## Setup

```sh
pnpm install      # resolve deps (there's no committed lockfile — it's a library)
pnpm run setup    # one-time: install the git hooks (pre-commit + pre-push)
```

The package is pure ESM. Source is TypeScript in `src/`, compiled to `dist/` by `pnpm run build` (run automatically on `pnpm pack`); `components/TrademarkNotices.astro` and `styles.css` ship as source. Imports use `.ts` specifiers and erasable syntax only, so Node runs the sources directly in tests.

## Develop

```sh
pnpm test               # node --test: core, HTML engine (golden per skip rule), middleware
pnpm run test:fixtures  # real astro build + dev + on-demand server on Astro 6, Astro 7, Starlight
pnpm run typecheck      # tsc --noEmit (strict)
pnpm run check          # Biome lint + format check (what CI runs)
pnpm run format         # auto-fix formatting
pnpm run verify         # check + typecheck + test (the local gate; what the hooks run)
```

`test:fixtures` takes a minute or two and needs the network. Run it for any change to the engine, the middleware, the integration or the component. `KEEP=1` keeps the built fixture sites for inspection; `pnpm run test:fixtures -- astro7` runs one variant.

See [AGENTS.md §Key Invariants](AGENTS.md#key-invariants) for what must stay true — above all, that **one scan decides both the symbols and the notices**.

**No legal claims in the package.** Don't add a default list of marks, a default owner, or wording about a specific company. The registry is always the consuming site's.

## Pull requests

- **Title must be [Conventional Commits](https://www.conventionalcommits.org/):** `<type>(scope): subject`, ≤ 72 chars, lowercase subject, no trailing period. Types: `feat fix docs refactor test chore ci deps build perf revert style`. A breaking change uses `feat!:` (or a `BREAKING CHANGE:` body footer). The title becomes the squash-merge commit and **drives the version bump** — check it with `scripts/lint-pr-title.sh "<title>"`.
- Run `pnpm run verify` before pushing; the pre-push hook requires it.
- Update the `src/` JSDoc + `README.md` when you change the public surface — options, defaults, `Trademark` fields, exports, component props, CSS variables, skip rules, notice wording (see [AGENTS.md §Documentation Sync](AGENTS.md#documentation-sync)). A change to notice wording quotes the before/after sentence in the PR body. Release notes are generated into GitHub Releases from commit messages; there is no `CHANGELOG.md` to edit.
- PRs merge via **squash**; required checks (`ci`, `pr-title`) must pass.

## Releases

Automated on merge — you don't bump versions or tag by hand. Your PR title decides whether merging it releases: `fix`/`perf`/`revert` → patch, `feat` → minor, `!`/`BREAKING CHANGE` → major, and `deps`/`ci`/`chore`/`docs`/`test`/`refactor`/`build`/`style` → no release. Maintainers: see [RELEASING.md](RELEASING.md).
