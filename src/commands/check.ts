import { existsSync } from 'node:fs';
import { dim, fail, ok, plural, table } from '../lib/format.js';
import {
  branchExists,
  changedFilesVsBase,
  getMainRepoRoot,
  gitAt,
  uncommittedFiles,
} from '../lib/git.js';
import { readState, worktreeAbsPath } from '../lib/state.js';

export interface CheckOptions {
  cwd?: string;
}

export interface Collision {
  file: string;
  agents: string[];
}

export interface CheckResult {
  collisions: Collision[];
  agentsChecked: number;
}

/**
 * Cross-reference every agent branch's changed files (committed vs base, plus
 * uncommitted edits in the worktree) and flag files touched by more than one
 * agent — the collision risks to resolve before anyone merges.
 */
export async function check(options: CheckOptions = {}): Promise<CheckResult> {
  const repoRoot = await getMainRepoRoot(options.cwd ?? process.cwd());
  const git = gitAt(repoRoot);
  const state = readState(repoRoot);
  const agents = Object.values(state.agents).sort((a, b) => a.name.localeCompare(b.name));

  if (agents.length < 2) {
    console.log(
      `Nothing to check: ${plural(agents.length, 'active agent')} ` +
        '(collisions need at least 2).',
    );
    return { collisions: [], agentsChecked: agents.length };
  }

  const agentsByFile = new Map<string, string[]>();
  for (const record of agents) {
    const files = new Set<string>();
    if (
      (await branchExists(git, record.branch)) &&
      (await branchExists(git, record.baseBranch))
    ) {
      for (const f of await changedFilesVsBase(git, record.baseBranch, record.branch)) {
        files.add(f);
      }
    }
    const abs = worktreeAbsPath(repoRoot, record);
    if (existsSync(abs)) {
      for (const f of await uncommittedFiles(abs)) files.add(f.path);
    }
    for (const file of files) {
      const touchers = agentsByFile.get(file) ?? [];
      touchers.push(record.name);
      agentsByFile.set(file, touchers);
    }
  }

  const collisions: Collision[] = [...agentsByFile.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([file, names]) => ({ file, agents: [...names].sort() }))
    .sort((a, b) => a.file.localeCompare(b.file));

  if (collisions.length === 0) {
    console.log(ok(`No collisions across ${agents.length} agents.`));
  } else {
    console.log(fail(`${plural(collisions.length, 'collision risk')} detected:`));
    console.log(
      table(
        ['FILE', 'AGENTS'],
        collisions.map((c) => [c.file, c.agents.join(', ')]),
      ),
    );
    console.log(
      dim(
        'These files are touched by more than one agent (committed or uncommitted). ' +
          'Coordinate before merging.',
      ),
    );
  }

  return { collisions, agentsChecked: agents.length };
}
