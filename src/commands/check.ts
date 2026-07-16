import { existsSync } from 'node:fs';
import type { SimpleGit } from 'simple-git';
import { dim, fail, ok, plural, table } from '../lib/format.js';
import {
  branchExists,
  changedFilesVsBase,
  getMainRepoRoot,
  gitAt,
  uncommittedFiles,
} from '../lib/git.js';
import { formatRanges, parseUnifiedDiff, rangesOverlap } from '../lib/lines.js';
import type { FileRanges } from '../lib/lines.js';
import { readState, worktreeAbsPath } from '../lib/state.js';
import type { AgentRecord } from '../lib/state.js';

export interface CheckOptions {
  /** Print machine-readable JSON instead of the table. */
  json?: boolean;
  /**
   * Line-level refinement: only count files where the agents' edited line
   * ranges actually overlap; report disjoint same-file edits separately.
   */
  lines?: boolean;
  cwd?: string;
}

export interface Collision {
  file: string;
  agents: string[];
  /**
   * --lines only: overlapping line ranges in merge-base coordinates, or
   * 'whole-file' when line info is unknowable (binary/untracked files, …).
   */
  overlap?: string;
}

export interface CheckResult {
  collisions: Collision[];
  /** --lines only: multi-agent files whose edits touch disjoint lines. */
  disjoint?: Collision[];
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
  const json = options.json ?? false;

  if (agents.length < 2) {
    const result: CheckResult = { collisions: [], agentsChecked: agents.length };
    if (options.lines) result.disjoint = [];
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        `Nothing to check: ${plural(agents.length, 'active agent')} ` +
          '(collisions need at least 2).',
      );
    }
    return result;
  }

  const agentsByFile = new Map<string, string[]>();
  // --lines only: file -> agent -> edited ranges (merge-base coordinates).
  const rangesByFile = new Map<string, Map<string, FileRanges>>();

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
    if (options.lines) {
      const ranges = await collectAgentRanges(git, repoRoot, record, files);
      for (const [file, fileRanges] of ranges) {
        const perAgent = rangesByFile.get(file) ?? new Map<string, FileRanges>();
        perAgent.set(record.name, fileRanges);
        rangesByFile.set(file, perAgent);
      }
    }
  }

  const multiAgent = [...agentsByFile.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([file, names]) => ({ file, agents: [...names].sort() }))
    .sort((a, b) => a.file.localeCompare(b.file));

  let collisions: Collision[];
  let disjoint: Collision[] | undefined;
  if (options.lines) {
    collisions = [];
    disjoint = [];
    for (const { file, agents: names } of multiAgent) {
      const perAgent = rangesByFile.get(file);
      // An agent with no parsed ranges has no net change vs merge-base.
      const entries = names.map((n) => perAgent?.get(n) ?? []);
      const overlap = rangesOverlap(entries);
      if (overlap === 'whole') {
        collisions.push({ file, agents: names, overlap: 'whole-file' });
      } else if (overlap.length > 0) {
        collisions.push({ file, agents: names, overlap: formatRanges(overlap) });
      } else {
        disjoint.push({ file, agents: names });
      }
    }
  } else {
    collisions = multiAgent;
  }

  const result: CheckResult = { collisions, agentsChecked: agents.length };
  if (disjoint !== undefined) result.disjoint = disjoint;

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (collisions.length === 0) {
    console.log(ok(`No collisions across ${agents.length} agents.`));
  } else {
    console.log(fail(`${plural(collisions.length, 'collision risk')} detected:`));
    console.log(
      options.lines
        ? table(
            ['FILE', 'AGENTS', 'LINES'],
            collisions.map((c) => [c.file, c.agents.join(', '), c.overlap ?? '']),
          )
        : table(
            ['FILE', 'AGENTS'],
            collisions.map((c) => [c.file, c.agents.join(', ')]),
          ),
    );
    console.log(
      dim(
        options.lines
          ? 'Line ranges are relative to the merge base — exact when the agents share a base, a heuristic otherwise.'
          : 'These files are touched by more than one agent (committed or uncommitted). ' +
              'Coordinate before merging.',
      ),
    );
  }
  if (disjoint && disjoint.length > 0) {
    console.log(
      dim(
        `${plural(disjoint.length, 'shared file')} with disjoint line edits (not counted as collisions):`,
      ),
    );
    for (const d of disjoint) {
      console.log(dim(`  ${d.file} (${d.agents.join(', ')})`));
    }
  }

  return result;
}

/**
 * Edited line ranges for every file an agent touched, in merge-base
 * coordinates: one `git diff -U0 <merge-base>` run inside the worktree covers
 * committed and uncommitted work at once; untracked files (and anything else
 * whose lines can't be resolved) are marked 'whole'.
 */
async function collectAgentRanges(
  git: SimpleGit,
  repoRoot: string,
  record: AgentRecord,
  files: Set<string>,
): Promise<Map<string, FileRanges>> {
  const abs = worktreeAbsPath(repoRoot, record);
  const worktreeExists = existsSync(abs);
  const branchesExist =
    (await branchExists(git, record.branch)) && (await branchExists(git, record.baseBranch));

  if (!branchesExist) {
    // No merge base to anchor line numbers to — fall back to whole-file.
    return new Map([...files].map((f) => [f, 'whole' as const]));
  }

  const mergeBase = (await git.raw(['merge-base', record.baseBranch, record.branch])).trim();
  const diffText = worktreeExists
    ? await gitAt(abs).raw(['diff', '-U0', '--no-color', mergeBase])
    : await git.raw(['diff', '-U0', '--no-color', mergeBase, record.branch]);
  const ranges = parseUnifiedDiff(diffText);

  if (worktreeExists) {
    for (const f of await uncommittedFiles(abs)) {
      // Untracked files never appear in `git diff`; both agents adding the
      // same new file is a real collision, so mark them whole-file.
      if (f.status === '??') ranges.set(f.path, 'whole');
    }
  }
  return ranges;
}
