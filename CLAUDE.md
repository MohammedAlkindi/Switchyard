# CLAUDE.md

Fleet (npm: `git-fleet`, bin: `fleet`) is a TypeScript CLI that lets multiple AI coding agents work on one git repository without colliding: each agent gets its own worktree in `.fleet/worktrees/<agent>/` on a branch `fleet/<agent>`, tracked in a gitignored `.fleet/state.json`, with `fleet check` flagging files touched by more than one agent before anyone merges. Commands live in `src/commands/` (one file per command), shared git/state/formatting logic in `src/lib/`, and the commander wiring in `src/cli.ts`.

## Hard rules

- **Never commit `.fleet/` directories.** Test fixtures create them inside temp repos only; if one ever appears in this repo's working tree, something is wrong — it is gitignored on purpose.
- **Tests must never touch the developer's real repo state.** Every test operates exclusively on a throwaway repo created by `makeTempRepo()` in `tests/helpers.ts`. Never run state-mutating git commands against this repository from test code.
- **Keep the dependency footprint minimal.** Runtime deps are exactly `commander`, `simple-git`, `chalk`, `cli-table3`. Justify any new dependency (what it does, why it can't be ~30 lines of our own code) before adding it.

## Testing

Every new or changed command ships with a test in `tests/<command>.test.ts` that runs against a **real temporary git repository** (`tmp` + `simple-git`, via `tests/helpers.ts`). No git mocks, ever — this tool's entire value proposition is correctness against real git behavior, and a mock would test nothing.

Run `npm test` (vitest) before and after changes. `npm run lint` and `npm run typecheck` must also pass.

## Commits

Conventional Commits, enforced: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`. One logical change per commit. Never commit with failing tests.

## Where things live

Read `docs/architecture.md` before making structural changes — it explains why worktrees (not just branches) are the isolation mechanism, the `.fleet/state.json` schema, and the v1 limitations. Release process is in `docs/deployment.md`.
