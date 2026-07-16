import { existsSync } from 'node:fs';
import { bold, dim, ok, warn } from '../lib/format.js';
import {
  aheadBehind,
  getMainRepoRoot,
  gitAt,
  uncommittedFiles,
  verifyBranch,
} from '../lib/git.js';
import type { UncommittedFile } from '../lib/git.js';
import { getAgent, readState, worktreeAbsPath } from '../lib/state.js';
import type { AgentRecord } from '../lib/state.js';

export interface StatusOptions {
  /** Print machine-readable JSON instead of the human summary. */
  json?: boolean;
  cwd?: string;
}

export interface StatusResult {
  record: AgentRecord;
  ahead: number;
  behind: number;
  uncommitted: UncommittedFile[];
  /** Output of `git diff --stat <base>...<branch>`. */
  diffStat: string;
  worktreeMissing: boolean;
}

export async function status(name: string, options: StatusOptions = {}): Promise<StatusResult> {
  const repoRoot = await getMainRepoRoot(options.cwd ?? process.cwd());
  const git = gitAt(repoRoot);
  const state = readState(repoRoot);
  const record = getAgent(state, name);
  const abs = worktreeAbsPath(repoRoot, record);
  const worktreeMissing = !existsSync(abs);

  await verifyBranch(git, record.branch, 'Agent');
  await verifyBranch(git, record.baseBranch, 'Base');

  const { ahead, behind } = await aheadBehind(git, record.baseBranch, record.branch);
  const diffStat = (
    await git.raw(['diff', '--stat', `${record.baseBranch}...${record.branch}`])
  ).trimEnd();
  const uncommitted = worktreeMissing ? [] : await uncommittedFiles(abs);

  const result: StatusResult = { record, ahead, behind, uncommitted, diffStat, worktreeMissing };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(bold(`Agent ${record.name}`));
  console.log(`  branch:   ${record.branch}`);
  console.log(`  base:     ${record.baseBranch} (${ahead} ahead, ${behind} behind)`);
  console.log(`  worktree: ${abs}${worktreeMissing ? ` ${warn('(missing)')}` : ''}`);
  console.log(`  created:  ${record.createdAt}`);
  console.log('');

  if (uncommitted.length > 0) {
    console.log(bold(`Uncommitted changes (${uncommitted.length}):`));
    for (const f of uncommitted) {
      console.log(`  ${warn(f.status.padEnd(2))} ${f.path}`);
    }
  } else if (!worktreeMissing) {
    console.log(ok('Working tree clean.'));
  }
  console.log('');

  if (diffStat) {
    console.log(bold(`Committed changes vs ${record.baseBranch}:`));
    console.log(diffStat);
  } else {
    console.log(dim(`No committed changes vs ${record.baseBranch} yet.`));
  }

  return result;
}
