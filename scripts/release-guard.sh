#!/usr/bin/env bash
# Bootstrap guard for .github/workflows/publish-npm.yml.
#
# semantic-release treats a repo with no vX.Y.Z tag as "never released" and would
# compute 1.0.0 from the WHOLE history, then try to publish it via OIDC to a
# package that (before the one-time manual publish) does not exist on npm. So the
# workflow only runs semantic-release once a `v*` tag exists (RELEASING.md
# "Bootstrap (one-time)" step 3 creates it).
#
# Prints a GitHub Actions notice and writes `bootstrapped=true|false` to
# $GITHUB_OUTPUT (stdout if unset). Always exits 0; the workflow gates later
# steps on the output. Needs full tag history (checkout fetch-depth: 0).
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
if [ -z "$(git tag -l 'v*')" ]; then
  echo "::notice title=Release skipped::No v* tag exists yet, so semantic-release is not run. Complete RELEASING.md 'Bootstrap (one-time)' (manual 0.1.0 publish + tag v0.1.0)."
  echo "bootstrapped=false" >> "$out"
else
  echo "bootstrapped=true" >> "$out"
fi
