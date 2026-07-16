# Fleet

> One repo, many AI coding agents, zero collisions — an isolated git worktree per agent, with collision detection before you merge.

[![npm version](https://img.shields.io/npm/v/git-fleet)](https://www.npmjs.com/package/git-fleet)
[![npm downloads](https://img.shields.io/npm/dm/git-fleet)](https://www.npmjs.com/package/git-fleet)
[![license](https://img.shields.io/github/license/MohammedAlkindi/Switchyard-)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/MohammedAlkindi/Switchyard-/ci.yml?branch=main&label=CI)](https://github.com/MohammedAlkindi/Switchyard-/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/MohammedAlkindi/Switchyard-/pulls)

Two AI coding agents on one checkout ends badly. This project exists because Codex silently ran a `git reset` on `main` mid-merge while Claude Code was mid-task on the same files — the merge state vanished and neither agent noticed. The failure mode isn't exotic: two agents, one working tree, no isolation. Fleet gives each agent its own git worktree and branch, tracks them centrally, and flags file-level collisions between agents before anyone merges.

## What it looks like

*(Illustrative output — the package is not yet published, so no real capture exists.)*

```console
$ fleet spawn claude
Spawned agent claude
  branch:   fleet/claude (from main)
  worktree: ~/project/.fleet/worktrees/claude

Point your agent at it:
  cd ~/project/.fleet/worktrees/claude

$ fleet list
┌────────┬──────────────┬──────┬───────┬───────────────┬───────────────┬──────────────────────────┐
│ AGENT  │ BRANCH       │ BASE │ +/-   │ CHANGES       │ LAST ACTIVITY │ WORKTREE                 │
├────────┼──────────────┼──────┼───────┼───────────────┼───────────────┼──────────────────────────┤
│ claude │ fleet/claude │ main │ +3/-0 │ clean         │ 12m ago       │ .fleet/worktrees/claude  │
│ codex  │ fleet/codex  │ main │ +1/-2 │ 4 uncommitted │ just now      │ .fleet/worktrees/codex   │
└────────┴──────────────┴──────┴───────┴───────────────┴───────────────┴──────────────────────────┘

$ fleet check
1 collision risk detected:
┌───────────────────┬───────────────┐
│ FILE              │ AGENTS        │
├───────────────────┼───────────────┤
│ src/api/routes.ts │ claude, codex │
└───────────────────┴───────────────┘
These files are touched by more than one agent (committed or uncommitted). Coordinate before merging.
```

## Installation

```sh
npm install -g git-fleet
```

Requires Node.js >= 18.17 and git >= 2.31. The installed command is `fleet`.

## Quickstart

```sh
cd your-repo
fleet spawn claude              # isolated worktree on branch fleet/claude
cd .fleet/worktrees/claude      # point your agent here and let it work
fleet check                     # any files also touched by other agents?
fleet diff claude               # review the branch before merging
git merge fleet/claude          # merge from your main checkout, then:
fleet clean                     # sweep up fully merged agents
```

## Commands

| Command | Description | Key flags |
| --- | --- | --- |
| `fleet spawn <agent>` | Create a worktree in `.fleet/worktrees/<agent>/` on a new branch `fleet/<agent>` | `--from <branch>` base branch (default: current branch) |
| `fleet list` | All active agents: branch, base, ahead/behind, uncommitted count, last activity | — |
| `fleet status <agent>` | One agent in detail: uncommitted files, diff stat vs base, ahead/behind | — |
| `fleet check` | Table of files touched by more than one agent — collision risks before merging. Exits 1 if any are found (CI-friendly) | — |
| `fleet diff <agent>` | Full diff of the agent's branch against its base | `--base <branch>` diff against a different branch |
| `fleet remove <agent>` | Remove the worktree; refuses if there are uncommitted changes | `--force` discard changes, `--delete-branch` also delete the branch |
| `fleet clean` | Remove agents whose branches are fully merged into their base | `--dry-run` list only |

All commands work from the main checkout **or** from inside any agent worktree.

## How it works

`fleet spawn` runs `git worktree add` under the hood: each agent gets a real, separate directory with its own checkout of a dedicated `fleet/<agent>` branch, so one agent's `git reset` physically cannot touch another agent's files. A single gitignored `.fleet/state.json` in the main repo maps each agent to its branch, base, and worktree, and `fleet check` uses it to diff every agent branch against its base (`git diff base...branch`, plus uncommitted edits) and cross-reference the changed files. Fleet also adds `.fleet/` to `.git/info/exclude` automatically, so it never dirties the repos it manages. Design rationale and limitations live in [docs/architecture.md](docs/architecture.md).

## Contributing

PRs are welcome. Clone, `npm install`, `npm test` — every command is tested against real throwaway git repositories, and any change to a command must come with such a test (no git mocks; see [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md) for the ground rules). Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Read [docs/architecture.md](docs/architecture.md) before structural changes, and [docs/deployment.md](docs/deployment.md) for the release process.

## License

MIT © Mohammed Alkindi — see [LICENSE](LICENSE).
