# Deployment

Fleet publishes to npm as [`git-fleet`](https://www.npmjs.com/package/git-fleet). The installed binary is `fleet`.

## Before any release

Every release requires all CI checks green on `main` — lint, typecheck, build, and tests (see `.github/workflows/ci.yml`). Locally that's:

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

`prepublishOnly` re-runs lint, typecheck, and tests automatically, so `npm publish` refuses to ship a broken build — but don't rely on it as your first line of defense.

## Testing a local build before publishing

```sh
npm run build
npm link                 # installs the local build globally as `fleet`

mkdir /tmp/fleet-scratch && cd /tmp/fleet-scratch
git init -b main && git commit --allow-empty -m "init"
fleet spawn test-agent   # run through spawn → list → check → remove → clean
cd - && npm unlink -g git-fleet
```

Walk the full command loop in the scratch repo, not just `--help` — the failure modes worth catching are git-behavior ones.

## Publishing a new version

```sh
npm version patch        # or: minor | major
git push origin main --follow-tags
npm publish
```

`npm version` bumps `package.json`, commits, and tags in one step — don't edit the version by hand.

Semver conventions for this package:

- **patch** — bug fixes, error-message improvements, doc-only changes shipped in the package.
- **minor** — new commands or new flags on existing commands, backwards-compatible.
- **major** — anything that breaks existing usage: renamed/removed commands or flags, changed exit-code semantics, or a `state.json` schema change without a migration path (`version` field in the schema exists for this).

Only the `dist/` output ships to npm (`files` in `package.json`); `prepare` rebuilds it on publish, so there is no manual build step to forget.
