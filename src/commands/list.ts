import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { dim, relativeTime, table, warn } from '../lib/format.js';
import {
  aheadBehind,
  branchExists,
  getMainRepoRoot,
  gitAt,
  lastCommitISO,
  uncommittedFiles,
} from '../lib/git.js';
import { readState, worktreeAbsPath } from '../lib/state.js';
import type { AgentRecord } from '../lib/state.js';

export interface ListOptions {
  cwd?: string;
}

export interface AgentListing {
  name: string;
  branch: string;
  baseBranch: string;
  worktreePath: string;
  worktreeMissing: boolean;
  /** null when the branch or base no longer exists. */
  ahead: number | null;
  behind: number | null;
  uncommitted: number;
  /** ISO timestamp: newest of last commit and uncommitted-file mtimes. */
  lastActivity: string | null;
}

export async function list(options: ListOptions = {}): Promise<AgentListing[]> {
  const repoRoot = await getMainRepoRoot(options.cwd ?? process.cwd());
  const state = readState(repoRoot);
  const agents = Object.values(state.agents).sort((a, b) => a.name.localeCompare(b.name));

  if (agents.length === 0) {
    console.log('No active agents. Run `fleet spawn <name>` to create one.');
    return [];
  }

  const listings: AgentListing[] = [];
  for (const record of agents) {
    listings.push(await describeAgent(repoRoot, record));
  }

  const rows = listings.map((l) => [
    l.name,
    l.branch,
    l.baseBranch,
    l.ahead === null ? '?' : `+${l.ahead}/-${l.behind}`,
    l.worktreeMissing
      ? warn('worktree missing')
      : l.uncommitted === 0
        ? dim('clean')
        : warn(`${l.uncommitted} uncommitted`),
    relativeTime(l.lastActivity),
    l.worktreePath,
  ]);
  console.log(table(['AGENT', 'BRANCH', 'BASE', '+/-', 'CHANGES', 'LAST ACTIVITY', 'WORKTREE'], rows));

  return listings;
}

async function describeAgent(repoRoot: string, record: AgentRecord): Promise<AgentListing> {
  const git = gitAt(repoRoot);
  const abs = worktreeAbsPath(repoRoot, record);
  const worktreeMissing = !existsSync(abs);

  let ahead: number | null = null;
  let behind: number | null = null;
  if ((await branchExists(git, record.branch)) && (await branchExists(git, record.baseBranch))) {
    ({ ahead, behind } = await aheadBehind(git, record.baseBranch, record.branch));
  }

  let uncommitted = 0;
  let lastActivity = await lastCommitISO(git, record.branch);
  if (!worktreeMissing) {
    const files = await uncommittedFiles(abs);
    uncommitted = files.length;
    // Uncommitted edits postdate the last commit; use the newest file mtime.
    let newest = lastActivity ? new Date(lastActivity).getTime() : 0;
    for (const f of files) {
      try {
        const mtime = statSync(path.join(abs, f.path)).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch {
        // Deleted or renamed while we looked — skip it.
      }
    }
    if (newest > 0) lastActivity = new Date(newest).toISOString();
  }

  return {
    name: record.name,
    branch: record.branch,
    baseBranch: record.baseBranch,
    worktreePath: record.worktreePath,
    worktreeMissing,
    ahead,
    behind,
    uncommitted,
    lastActivity,
  };
}
