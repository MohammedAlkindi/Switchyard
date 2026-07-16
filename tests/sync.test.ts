import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from '../src/commands/spawn.js';
import { sync } from '../src/commands/sync.js';
import { aheadBehind, gitAt } from '../src/lib/git.js';
import { commitFile, makeTempRepo, worktreePath } from './helpers.js';
import type { TempRepo } from './helpers.js';

let repo: TempRepo;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  repo = await makeTempRepo();
});

afterEach(() => {
  vi.restoreAllMocks();
  repo.cleanup();
});

describe('fleet sync', () => {
  it('merges new base commits into the agent branch', async () => {
    await spawn('alice', { cwd: repo.root });
    await commitFile(repo.root, 'from-main.txt', 'm\n', 'feat: main moved on');

    const result = await sync('alice', { cwd: repo.root });

    expect(result).toMatchObject({ branch: 'fleet/alice', base: 'main', behind: 1, updated: true });
    // The base commit is now present in the agent's worktree…
    expect(existsSync(path.join(worktreePath(repo.root, 'alice'), 'from-main.txt'))).toBe(true);
    // …and the branch is no longer behind.
    const { behind } = await aheadBehind(gitAt(repo.root), 'main', 'fleet/alice');
    expect(behind).toBe(0);
  });

  it('is a no-op when the agent is already up to date', async () => {
    await spawn('alice', { cwd: repo.root });

    const result = await sync('alice', { cwd: repo.root });

    expect(result).toMatchObject({ behind: 0, updated: false });
  });

  it('aborts a conflicting merge and leaves the worktree unconflicted', async () => {
    await spawn('alice', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'alice'), 'src.txt', 'agent version\n', 'feat: agent edit');
    await commitFile(repo.root, 'src.txt', 'main version\n', 'feat: main edit');

    await expect(sync('alice', { cwd: repo.root })).rejects.toThrow(/conflicts in 1 file/);

    const status = await gitAt(worktreePath(repo.root, 'alice')).status();
    expect(status.conflicted).toEqual([]);
    expect(status.files).toEqual([]);
  });

  it('refuses when the worktree has uncommitted changes', async () => {
    await spawn('alice', { cwd: repo.root });
    await commitFile(repo.root, 'from-main.txt', 'm\n', 'feat: main moved on');
    writeFileSync(path.join(worktreePath(repo.root, 'alice'), 'wip.txt'), 'w\n');

    await expect(sync('alice', { cwd: repo.root })).rejects.toThrow(/uncommitted change/);
  });

  it('errors clearly for an unknown agent', async () => {
    await expect(sync('ghost', { cwd: repo.root })).rejects.toThrow(/No agent named "ghost"/);
  });
});
