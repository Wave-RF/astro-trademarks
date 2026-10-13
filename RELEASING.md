# Releasing & maintenance

How `@wave-rf/astro-trademarks` is published. **Releases happen on merge to `main`**, driven by [semantic-release](https://semantic-release.org); there is no release PR and nothing to click. The package has **not been published yet**: do the [Bootstrap (one-time)](#bootstrap-one-time) first.

## Bootstrap (one-time)

> **Why the first publish is manual:** npm OIDC trusted publishing can't *create* a package; the trusted-publisher config attaches to an existing package. So `0.1.0` is published by hand from a laptop. Until a `v*` tag exists, the workflow's guard (`scripts/release-guard.sh`) prints a notice and skips semantic-release entirely. Without the guard, semantic-release would treat the whole history as a first release, compute `1.0.0`, and fail trying to publish a package that doesn't exist.

Do these **in order**:

1. **Merge the bootstrap PR** (`ci: release on merge with semantic-release`). A `ci:` title releases nothing, and the guard skips the release job anyway because there is no tag yet.
2. **Publish 0.1.0 by hand** from a clean checkout of `main` at that merge commit, logged in as a `@wave-rf` org member (`package.json` `version` is still `0.1.0`):

   ```sh
   git checkout main && git pull --ff-only && git status   # clean, at the merge commit
   pnpm install && pnpm run verify
   npm login
   npm pack --dry-run          # dist/*.js + *.d.ts, components/TrademarkNotices.astro, styles.css, README.md, LICENSE, package.json only
   npm publish --access public # prepack builds dist/
   ```

   A laptop publish carries no provenance attestation (that needs CI/OIDC); expected for the bootstrap.
3. **Tag that commit** so semantic-release has a starting point:

   ```sh
   git tag v0.1.0 <merge-commit-sha>
   git push origin v0.1.0
   ```
4. **Configure the npm trusted publisher.** npmjs.com -> the package -> **Settings -> Trusted Publisher** -> **GitHub Actions**, with exactly:

   | Field | Value |
   | ----- | ----- |
   | Organization / owner | `Wave-RF` |
   | Repository | `astro-trademarks` |
   | Workflow filename | `publish-npm.yml` |
   | Environment | *(blank; the job declares no `environment:`)* |

   The filename is matched literally; renaming `publish-npm.yml` breaks publishing. Optional hardening: enable "Require 2FA and disallow tokens" so CI is the only publish path.
5. **Follow-up `chore:` PR** that sets `package.json` `version` to `0.0.0-development` (the placeholder; semantic-release sets the real version in the CI workspace only). It releases nothing. Once it merges, the guard sees `v0.1.0` and every later merge is judged by its title.

Other one-time setup:

- **npm org.** The **`@wave-rf`** org must exist and your account must be able to publish to it.
- **No secrets.** Neither `NPM_TOKEN` nor a PAT is needed. `GITHUB_TOKEN` creates the tag and Release (the workflow grants `contents`, `issues`, `pull-requests` write and `id-token: write`).
- **Branch protection + merge settings.** Run once CI has run on `main` (so the `ci` and `pr-title` check names exist):

  ```sh
  bash scripts/setup-repo.sh
  ```

  Squash-only merges (PR title = commit subject: this is what semantic-release reads), auto-merge, auto-delete, protected `main` (PR required, `ci` + `pr-title` required, no force-push or deletion). `main` stays protected, which is why the release never commits to it.

## The model

- **Every squash-merge to `main` either releases or doesn't, decided by its Conventional-Commit title.** Squash merges use the PR title as the commit subject, and the required `pr-title` check validates it, so the title is the release decision.
- **The git tag is the version.** `vX.Y.Z` tags are created by the release run; nothing is committed back to `main` (it is protected), so there is no changelog commit.
- **GitHub Releases are the changelog.** Notes are generated per release.
- **Auth is OIDC trusted publishing**, no `NPM_TOKEN`. Publishes carry provenance. The GitHub side (tag, Release, comments) uses the built-in `GITHUB_TOKEN`.
- **One channel.** `main` is always `latest`. The old `@dev` channel and the release-please PR are gone.
- **A build step.** The package ships compiled JS (`dist/`, from `tsc -p tsconfig.build.json`) plus `components/` and `styles.css`. The workflow runs `pnpm run build` before semantic-release and disables lifecycle scripts during the publish (`NPM_CONFIG_IGNORE_SCRIPTS`); locally, `prepack` builds it.

### What releases what

| PR / commit title | Release |
| ----------------- | ------- |
| `fix:` `perf:` `revert:` | patch (0.1.0 -> 0.1.1) |
| `feat:` | minor (0.1.0 -> 0.2.0) |
| `feat!:` / any type with `!`, or a `BREAKING CHANGE:` footer | **major** (0.1.0 -> 1.0.0) |
| `deps:` `ci:` `chore:` `docs:` `test:` `refactor:` `build:` `style:` | none |

- There is no 0.x shielding (release-please's "breaking -> minor while 0.x" is gone): the first breaking change releases `1.0.0`. Mark a break deliberately.
- A breaking marker wins over a "no release" type, so `refactor!:` releases a major.
- The workflow runs `pnpm run verify` before `semantic-release`, so a red `main` never releases.
- Commit bodies are not consulted except for `BREAKING CHANGE:`. Only the squash subject matters.
- To ship a runtime dependency bump, title it `fix(deps): bump <pkg> to <version>`. To force a release with no other change, merge any `fix:` PR. There is no `Release-As:` footer.
- No pre-release channels: `branches` is `["main"]` only.

## What a release run does

`publish-npm.yml` (push to `main`, serialised by a `publish-npm` concurrency group, never cancelled):

1. checkout with full history and tags, then the **bootstrap guard**: no `v*` tag means print a notice and skip everything below (green run);
2. pnpm install, `pnpm run verify`, `pnpm run build`;
3. `semantic-release` finds the latest `vX.Y.Z` tag reachable from `main`, analyses the commits since it, and exits quietly if none are releasable;
4. otherwise it pushes the new tag, runs `npm publish` via OIDC with provenance (`@semantic-release/npm`), creates the GitHub Release with generated notes, and comments "released in vX.Y.Z" on the issues and PRs involved.

Node is 24 with **no `registry-url`** on `setup-node` (it writes an `.npmrc` that breaks the OIDC exchange). semantic-release and the conventional-commits preset are pinned to exact versions in `devDependencies`. The preset must stay on 9.x with semantic-release 25 (preset 10.x fails with "requires conventional-changelog-writer@9"); bump them together. `pnpm run check:release` (part of `verify` and CI) exercises the analyzer and notes generator offline against `.releaserc.json`, so a bad bump fails a PR instead of `main`.

### Failures and re-runs

- A failed release opens a **"The automated release is failing"** issue (from `@semantic-release/github`). It closes itself on the next success.
- **Failure before the tag is pushed** (verify red, OIDC misconfigured): fix and re-run the failed workflow run (`gh run rerun <run-id>`). Nothing was released.
- **Failure after the tag is pushed** (e.g. `npm publish` 403/network): the tag already exists, so a re-run sees "no release". Check `npm view @wave-rf/astro-trademarks versions` first; if the version is NOT on npm, delete the tag and re-run:

  ```sh
  git push --delete origin vX.Y.Z
  gh run rerun <run-id>
  ```

  Never delete a tag whose version is already published. Never delete `v0.1.0`.
- **Roll back a bad release:** `npm deprecate "@wave-rf/astro-trademarks@X.Y.Z" "<why>"` and ship a `fix:`.

### Checking what the next merge would do (dry run, no writes)

`/release` in Claude Code summarises the commit list and the version it implies. For an exact replay of the rules, run the programmatic API (`analyzeCommits` / `generateNotes` from the two plugins, with the options in `.releaserc.json`) as `scripts/check-release-config.mjs` does. The CLI `--plugins` override drops the plugin options in `.releaserc.json`, so it falls back to the default preset and rules.

## Verifying a release

```sh
npm dist-tag ls @wave-rf/astro-trademarks      # latest -> the new version
npm view @wave-rf/astro-trademarks@<version>   # provenance shows on the npm page
gh release view v<version>
```

## Troubleshooting

- **A merge didn't release.** Expected if its title was `deps`/`ci`/`chore`/`docs`/`test`/`refactor`/`build`/`style`. Check the run log: "no relevant changes, so no new version is released". Or the guard skipped it: no `v*` tag yet (see Bootstrap).
- **OIDC publish failed (`401`/`403`/`ENEEDAUTH`).** The trusted-publisher config doesn't match (org, repo, workflow filename `publish-npm.yml`), or `setup-node` was given `registry-url`, or the runner's npm is older than 11.5.1.
- **"No release" right after a failed publish.** The tag already exists; see *Failure after the tag is pushed*.
- **Release notes show the wrong range.** semantic-release uses the latest tag reachable from `main`. Don't hand-create tags (other than the one-time `v0.1.0`).

## A merge that didn't release

GitHub starts no workflow for a push made with the built-in `GITHUB_TOKEN`, and Dependabot's auto-merge (enabled by `dependabot-automerge.yml` with that token) is such a push. So:

- an auto-merged Dependabot PR runs no release job (harmless on its own: `deps:`/`ci:` never release), and
- if it lands while the release job for an earlier `fix:`/`feat:` merge is starting, that job logs **"The local branch main is behind the remote one, therefore a new version won't be published"** and exits green — and no later run comes to pick the commit up.

Either way, run the release by hand from `main`:

```bash
gh workflow run publish-npm.yml -R Wave-RF/astro-trademarks --ref main
```

It is safe to run any time: semantic-release re-reads every commit since the last `vX.Y.Z` tag and releases only if one of them warrants it.
