# Architecture

## The model: one worktree per agent

```
your-project/                        <- main repo, your own checkout (e.g. main)
├── .git/
│   └── info/exclude                 <- fleet adds ".fleet/" here on first spawn
├── .fleet/                          <- never committed, lives only on disk
│   ├── state.json                   <- coordination layer (source of truth)
│   └── worktrees/
│       ├── claude/                  <- full checkout of branch fleet/claude
│       └── codex/                   <- full checkout of branch fleet/codex
└── src/ ...                         <- your files, untouched by any agent
```

```mermaid
graph TD
    R["main repo<br/>(your checkout)"] -- "git worktree add" --> A[".fleet/worktrees/claude/<br/>branch: fleet/claude"]
    R -- "git worktree add" --> B[".fleet/worktrees/codex/<br/>branch: fleet/codex"]
    S[".fleet/state.json<br/>agent → branch → base"] -. tracks .-> A
    S -. tracks .-> B
    C["fleet check"] -- "diff main...fleet/claude<br/>+ uncommitted files" --> A
    C -- "diff main...fleet/codex<br/>+ uncommitted files" --> B
    C --> O["collision table:<br/>file × agents that touched it"]
```

`fleet spawn <name>` runs `git worktree add .fleet/worktrees/<name> -b fleet/<name> <base>` and records the mapping in `state.json`. `fleet check` walks every recorded agent, collects the files each one changed (`git diff --name-only <base>...<branch>` for committed work, `git status --porcelain` in the worktree for uncommitted work), and reports any file that appears under more than one agent.

## Why worktrees, not just branches

Branches alone don't isolate anything — they share one working directory and one index. The incident that motivated this project was exactly that failure mode: two agents on one checkout, one ran `git reset` mid-merge while the other was editing the same files, and the merge state silently vanished.

Worktrees give each agent a **real, separate directory on disk** with its own checked-out files, its own index, and its own HEAD. A `git reset`, `git checkout`, or half-finished merge inside `.fleet/worktrees/codex/` physically cannot disturb the files in `.fleet/worktrees/claude/` or in your main checkout. The only shared surface is the object database and refs — which is precisely what makes `fleet check` cheap: all branches are visible from the main repo without fetching or copying anything.

Fleet also writes `.fleet/` into `.git/info/exclude` (not `.gitignore`) on first spawn, so it never needs to modify — or dirty — the repository it manages.

## State file schema

`.fleet/state.json` is the source of truth for every command:

```json
{
  "version": 1,
  "agents": {
    "claude": {
      "name": "claude",
      "branch": "fleet/claude",
      "baseBranch": "main",
      "worktreePath": ".fleet/worktrees/claude",
      "createdAt": "2026-07-16T09:30:00.000Z"
    }
  }
}
```

- `version` — schema version, bump on breaking changes to this file.
- `branch` — always `fleet/<name>`; the prefix is what makes `fleet clean` safe to scope.
- `baseBranch` — the branch the agent was spawned from; the default base for `fleet diff`, the merge target checked by `fleet clean`, and the comparison point for ahead/behind counts.
- `worktreePath` — relative to the repo root, forward slashes, so the state file survives the repo being moved or shared across OSes.

Writes go through a write-then-rename (`state.json.tmp` → `state.json`) in `src/lib/state.ts`, so a crash mid-write can't corrupt the file. Commands tolerate drift between state and reality (a manually deleted worktree shows as `worktree missing` in `fleet list`; a manually deleted branch becomes a `fleet clean` candidate) rather than crashing.

## Current limitations (v1)

- **Single-repo scope.** State lives per-repository; there is no cross-repo view of agents.
- **No submodule support.** Worktrees of repos with submodules are untested and likely broken; don't rely on them.
- **No remote/multi-machine coordination.** `state.json` is local disk only — two machines managing the same clone don't see each other's agents. Nothing syncs, nothing locks.
- **Collision detection is file-level, not line-level.** Two agents editing disjoint parts of one file is still flagged — deliberately, since file-level overlap is where merge pain starts.
