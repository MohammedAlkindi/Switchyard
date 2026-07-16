import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctor } from '../src/commands/doctor.js';
import { spawn } from '../src/commands/spawn.js';
import { branchExists, gitAt } from '../src/lib/git.js';
import { readState, statePath, writeState } from '../src/lib/state.js';
import { makeTempRepo, worktreePath } from './helpers.js';
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

function checkByName(result: Awaited<ReturnType<typeof doctor>>, name: string) {
  const check = result.checks.find((c) => c.name === name);
  expect(check, `expected a "${name}" check`).toBeDefined();
  return check!;
}

describe('fleet doctor', () => {
  it('reports all healthy for a well-formed setup', async () => {
    await spawn('alice', { cwd: repo.root });

    const result = await doctor({ cwd: repo.root });

    expect(result.healthy).toBe(true);
    for (const check of result.checks) {
      expect(check.ok, `${check.name}: ${check.detail}`).toBe(true);
    }
  });

  it('--json prints checks and health as parseable JSON', async () => {
    await spawn('alice', { cwd: repo.root });

    const result = await doctor({ json: true, cwd: repo.root });

    const printed = JSON.parse(
      vi.mocked(console.log).mock.calls.at(-1)?.[0] as string,
    ) as { checks: unknown; healthy: boolean };
    expect(printed).toEqual({ checks: result.checks, healthy: true });
  });

  it('detects a corrupted state file and rebuilds it with --fix', async () => {
    await spawn('alice', { cwd: repo.root });
    writeFileSync(statePath(repo.root), 'not json {{{');

    const broken = await doctor({ cwd: repo.root });
    expect(broken.healthy).toBe(false);
    expect(checkByName(broken, 'state-file').ok).toBe(false);

    const fixed = await doctor({ fix: true, cwd: repo.root });
    expect(checkByName(fixed, 'state-file').fixed).toBe(true);
    expect(fixed.healthy).toBe(true);

    // Rebuilt from `git worktree list`: the live agent was re-adopted.
    const state = readState(repo.root);
    expect(state.agents['alice']).toMatchObject({
      name: 'alice',
      branch: 'fleet/alice',
      worktreePath: '.fleet/worktrees/alice',
    });
  });

  it('detects an orphaned worktree and adopts it with --fix', async () => {
    await spawn('alice', { cwd: repo.root });
    // Drop the entry but leave the worktree: an orphan.
    writeState(repo.root, { version: 1, agents: {} });

    const broken = await doctor({ cwd: repo.root });
    expect(broken.healthy).toBe(false);
    expect(checkByName(broken, 'orphaned-worktrees').detail).toContain('alice');

    const fixed = await doctor({ fix: true, cwd: repo.root });
    expect(checkByName(fixed, 'orphaned-worktrees').fixed).toBe(true);
    expect(fixed.healthy).toBe(true);
    expect(readState(repo.root).agents['alice']?.branch).toBe('fleet/alice');
  });

  it('removes a non-worktree leftover directory with --fix', async () => {
    await spawn('alice', { cwd: repo.root });
    const junk = path.join(path.dirname(worktreePath(repo.root, 'alice')), 'junk');
    mkdirSync(junk, { recursive: true });
    writeFileSync(path.join(junk, 'leftover.txt'), 'x\n');

    const broken = await doctor({ cwd: repo.root });
    expect(checkByName(broken, 'orphaned-worktrees').ok).toBe(false);

    const fixed = await doctor({ fix: true, cwd: repo.root });
    expect(fixed.healthy).toBe(true);
    expect(existsSync(junk)).toBe(false);
    // The healthy agent was untouched.
    expect(readState(repo.root).agents['alice']).toBeDefined();
  });

  it('detects a stale state entry and prunes it with --fix, keeping the branch', async () => {
    await spawn('alice', { cwd: repo.root });
    rmSync(worktreePath(repo.root, 'alice'), { recursive: true, force: true });

    const broken = await doctor({ cwd: repo.root });
    expect(broken.healthy).toBe(false);
    expect(checkByName(broken, 'stale-entries').detail).toContain('alice');

    const fixed = await doctor({ fix: true, cwd: repo.root });
    expect(checkByName(fixed, 'stale-entries').fixed).toBe(true);
    expect(fixed.healthy).toBe(true);
    expect(readState(repo.root).agents).toEqual({});
    // Pruning state never deletes branches.
    expect(await branchExists(gitAt(repo.root), 'fleet/alice')).toBe(true);
  });
});
