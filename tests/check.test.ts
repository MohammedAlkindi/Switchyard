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

  it('--json prints the result as parseable JSON', async () => {
    await spawn('alice', { cwd: repo.root });
    await spawn('bob', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'alice'), 'src.txt', 'alice\n', 'feat: alice edit');
    await commitFile(worktreePath(repo.root, 'bob'), 'src.txt', 'bob\n', 'feat: bob edit');

    const result = await check({ json: true, cwd: repo.root });

    const printed = JSON.parse(
      vi.mocked(console.log).mock.calls.at(-1)?.[0] as string,
    ) as typeof result;
    expect(printed).toEqual(result);
    expect(printed.collisions).toEqual([{ file: 'src.txt', agents: ['alice', 'bob'] }]);
  });
});

describe('fleet check --lines', () => {
  const numberedLines = (): string[] => Array.from({ length: 12 }, (_, i) => `line${i + 1}`);

  async function seedNumberedFile(): Promise<void> {
    await commitFile(repo.root, 'big.txt', `${numberedLines().join('\n')}\n`, 'feat: fixture');
  }

  function editLine(agent: string, lineNo: number): string {
    const lines = numberedLines();
    lines[lineNo - 1] = `edited by ${agent}`;
    return `${lines.join('\n')}\n`;
  }

  it('treats same-file edits on disjoint lines as non-collisions', async () => {
    await seedNumberedFile();
    await spawn('alice', { cwd: repo.root });
    await spawn('bob', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'alice'), 'big.txt', editLine('alice', 2), 'feat: alice edit');
    await commitFile(worktreePath(repo.root, 'bob'), 'big.txt', editLine('bob', 10), 'feat: bob edit');

    const result = await check({ lines: true, cwd: repo.root });

    expect(result.collisions).toEqual([]);
    expect(result.disjoint).toEqual([{ file: 'big.txt', agents: ['alice', 'bob'] }]);
  });

  it('flags overlapping edits with their line ranges, including uncommitted ones', async () => {
    await seedNumberedFile();
    await spawn('alice', { cwd: repo.root });
    await spawn('bob', { cwd: repo.root });
    await commitFile(worktreePath(repo.root, 'alice'), 'big.txt', editLine('alice', 5), 'feat: alice edit');
    // bob's overlapping edit is uncommitted — still measured from the merge base.
    writeFileSync(path.join(worktreePath(repo.root, 'bob'), 'big.txt'), editLine('bob', 5));

    const result = await check({ lines: true, cwd: repo.root });

    expect(result.collisions).toEqual([
      { file: 'big.txt', agents: ['alice', 'bob'], overlap: '5' },
    ]);
    expect(result.disjoint).toEqual([]);
  });

  it('marks files without line info (untracked on both sides) as whole-file', async () => {
    await spawn('alice', { cwd: repo.root });
    await spawn('bob', { cwd: repo.root });
    writeFileSync(path.join(worktreePath(repo.root, 'alice'), 'new.txt'), 'a\n');
    writeFileSync(path.join(worktreePath(repo.root, 'bob'), 'new.txt'), 'b\n');

    const result = await check({ lines: true, cwd: repo.root });

    expect(result.collisions).toEqual([
      { file: 'new.txt', agents: ['alice', 'bob'], overlap: 'whole-file' },
    ]);
  });
});
