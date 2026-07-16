import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readConfig } from '../lib/config.js';
import { FleetError } from '../lib/errors.js';
import { bold, dim, ok } from '../lib/format.js';
import {
  addWorktree,
  branchExists,
  currentBranch,
  ensureFleetExcluded,
  getMainRepoRoot,
  gitAt,
  verifyBranch,
} from '../lib/git.js';
import { readState, worktreesDir, writeState } from '../lib/state.js';
import type { AgentRecord } from '../lib/state.js';

export interface SpawnOptions {
  /** Base branch to spawn from. Defaults to the current branch. */
  from?: string;
  cwd?: string;
}

export interface SpawnResult {
  record: AgentRecord;
  /** Absolute path of the new worktree. */
  worktreePath: string;
}

// Names become branch names and directory names, so keep them filesystem- and
// ref-safe: no slashes, no leading dots, no whitespace.
const AGENT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export async function spawn(name: string, options: SpawnOptions = {}): Promise<SpawnResult> {
  if (!AGENT_NAME_RE.test(name)) {
    throw new FleetError(
      `Invalid agent name "${name}". Use letters, digits, ".", "_" or "-" ` +
        '(max 64 chars, starting with a letter or digit).',
    );
  }

  const repoRoot = await getMainRepoRoot(options.cwd ?? process.cwd());
  const git = gitAt(repoRoot);
  const state = readState(repoRoot);
  const branch = `fleet/${name}`;

  const existing = state.agents[name];
  if (existing) {
    throw new FleetError(
      `Agent "${name}" already exists (branch ${existing.branch}, worktree ${existing.worktreePath}).\n` +
        `Pick a different name, or remove it first with \`fleet remove ${name}\`.`,
    );
  }
  if (await branchExists(git, branch)) {
    throw new FleetError(
      `Branch "${branch}" already exists but is not tracked by Fleet.\n` +
        `Delete it (\`git branch -d ${branch}\`) or pick a different agent name.`,
    );
  }
  const worktreeAbs = path.join(worktreesDir(repoRoot), name);
  if (existsSync(worktreeAbs)) {
    throw new FleetError(
      `Worktree directory already exists: ${worktreeAbs}\n` +
        'Remove it or pick a different agent name.',
    );
  }

  // Precedence: --from flag > .fleetrc.json defaultBase > current branch.
  let base = options.from ?? readConfig(repoRoot).defaultBase;
  if (base) {
    await verifyBranch(git, base, 'Base');
  } else {
    base = (await currentBranch(git)) ?? undefined;
    if (!base) {
      throw new FleetError(
        'HEAD is detached, so there is no branch to base the agent on. ' +
          'Pass one explicitly with --from <branch>.',
      );
    }
  }

  await ensureFleetExcluded(repoRoot);
  mkdirSync(worktreesDir(repoRoot), { recursive: true });
  await addWorktree(git, worktreeAbs, branch, base);

  const record: AgentRecord = {
    name,
    branch,
    baseBranch: base,
    worktreePath: path.relative(repoRoot, worktreeAbs).split(path.sep).join('/'),
    createdAt: new Date().toISOString(),
  };
  state.agents[name] = record;
  writeState(repoRoot, state);

  console.log(ok(`Spawned agent ${bold(name)}`));
  console.log(`  branch:   ${branch} ${dim(`(from ${base})`)}`);
  console.log(`  worktree: ${worktreeAbs}`);
  console.log('');
  console.log('Point your agent at it:');
  console.log(`  cd ${worktreeAbs}`);

  return { record, worktreePath: worktreeAbs };
}
