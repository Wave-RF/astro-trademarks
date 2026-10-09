<!--
PR title MUST be Conventional Commits (the required `pr-title` check, and the
squash-merge subject release-please parses for the version bump):
  <type>(optional-scope)(optional-!): <lowercase subject, no trailing period>   (<= 72 chars)
  types: feat fix docs refactor test chore ci deps build perf revert style
  breaking change: add `!` (e.g. `feat!: …`) or a `BREAKING CHANGE:` body footer.
-->

## Summary

<!-- What changed and why. -->

## Test plan

<!-- How you verified it. `pnpm run verify` (Biome + tsc + node --test) at minimum. -->

## Checklist

- [ ] `pnpm run verify` passes locally (Biome + `tsc --noEmit` + `node --test`)
- [ ] `pnpm run test:fixtures` passes locally (real Astro builds) — required for changes to the engine, middleware, component or integration
- [ ] Public surface changes (`TrademarksOptions` options, `Trademark` fields, exports, component props, CSS variables, skip rules) are reflected in the `src/` JSDoc **and** `README.md`
- [ ] Notice wording changes quote the before/after sentence in this description
