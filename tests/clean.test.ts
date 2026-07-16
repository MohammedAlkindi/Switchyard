import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clean } from '../src/commands/clean.js';
import { spawn } from '../src/commands/spawn.js';
import { branchExists, gitAt } from '../src/lib/git.js';
import { readState } from '../src/lib/state.js';
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

describe('fleet clean', () => {
  it('removes an agent with no commits of its own (trivially merged)', async () => {
    await spawn('alice', { cwd: repo.root });

    const result = await clean({ cwd: repo.root });

    expect(result.cleaned.map((c) => c.name)).toEqual(['alice']);
    expect(existsSync(worktreePath(repo.root, 'alice'))).toBe(false);
    expect(await branchExists(gitAt(repo.root), 'fleet/alice')).toBe(false);
    expect(readState(repo.root).agents).toEqual({});
  });

  it('removes an agent after its branch is merged into base', async () => {
    await spawn('alice', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'alice'), 'feature.txt', 'f\n', 'feat: feature');
    await repo.git.merge(['fleet/alice']);

    const result = await clean({ cwd: repo.root });

    expect(result.cleaned.map((c) => c.name)).toEqual(['alice']);
    expect(result.cleaned[0]?.reason).toBe('merged');
    expect(await branchExists(gitAt(repo.root), 'fleet/alice')).toBe(false);
  });

  it('keeps agents with unmerged commits', async () => {
    await spawn('bob', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'bob'), 'wip.txt', 'w\n', 'feat: unmerged');

    const result = await clean({ cwd: repo.root });

    expect(result.cleaned).toEqual([]);
    expect(result.kept).toEqual([{ name: 'bob', reason: 'has unmerged commits vs main' }]);
    expect(await branchExists(gitAt(repo.root), 'fleet/bob')).toBe(true);
    expect(readState(repo.root).agents['bob']).toBeDefined();
  });

  it('keeps agents with uncommitted changes', async () => {
    await spawn('carol', { cwd: repo.root });
    writeFileSync(path.join(worktreePath(repo.root, 'carol'), 'wip.txt'), 'w\n');

    const result = await clean({ cwd: repo.root });

    expect(result.cleaned).toEqual([]);
    expect(result.kept[0]?.name).toBe('carol');
    expect(result.kept[0]?.reason).toMatch(/uncommitted change/);
    expect(existsSync(worktreePath(repo.root, 'carol'))).toBe(true);
  });

  it('--dry-run lists candidates without removing anything', async () => {
    await spawn('alice', { cwd: repo.root });

    const result = await clean({ dryRun: true, cwd: repo.root });

    expect(result.cleaned.map((c) => c.name)).toEqual(['alice']);
    expect(existsSync(worktreePath(repo.root, 'alice'))).toBe(true);
    expect(await branchExists(gitAt(repo.root), 'fleet/alice')).toBe(true);
    expect(readState(repo.root).agents['alice']).toBeDefined();
  });
});
