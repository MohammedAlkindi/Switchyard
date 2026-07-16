import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { check } from '../src/commands/check.js';
import { spawn } from '../src/commands/spawn.js';
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

describe('fleet check', () => {
  it('flags a file committed by two different agents', async () => {
    await spawn('alice', { cwd: repo.root });
    await spawn('bob', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'alice'), 'src.txt', 'alice\n', 'feat: alice edit');
    await commitFile(worktreePath(repo.root, 'bob'), 'src.txt', 'bob\n', 'feat: bob edit');

    const result = await check({ cwd: repo.root });

    expect(result.agentsChecked).toBe(2);
    expect(result.collisions).toEqual([{ file: 'src.txt', agents: ['alice', 'bob'] }]);
  });

  it('counts uncommitted edits as collision risk', async () => {
    await spawn('alice', { cwd: repo.root });
    await spawn('bob', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'alice'), 'src.txt', 'alice\n', 'feat: alice edit');
    // bob touches the same file but has not committed yet — still a risk.
    writeFileSync(path.join(worktreePath(repo.root, 'bob'), 'src.txt'), 'bob wip\n');

    const result = await check({ cwd: repo.root });
    expect(result.collisions).toEqual([{ file: 'src.txt', agents: ['alice', 'bob'] }]);
  });

  it('reports no collisions when agents touch disjoint files', async () => {
    await spawn('alice', { cwd: repo.root });
    await spawn('bob', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'alice'), 'a.txt', 'a\n', 'feat: a');
    await commitFile(worktreePath(repo.root, 'bob'), 'b.txt', 'b\n', 'feat: b');

    const result = await check({ cwd: repo.root });
    expect(result.collisions).toEqual([]);
  });

  it('skips the check when fewer than two agents exist', async () => {
    await spawn('alice', { cwd: repo.root });
    const result = await check({ cwd: repo.root });
    expect(result).toEqual({ collisions: [], agentsChecked: 1 });
  });
});
