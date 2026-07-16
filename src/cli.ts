#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { Command } from 'commander';
import { check } from './commands/check.js';
import { clean } from './commands/clean.js';
import { completion } from './commands/completion.js';
import { diff } from './commands/diff.js';
import { doctor } from './commands/doctor.js';
import { list } from './commands/list.js';
import { merge } from './commands/merge.js';
import { remove } from './commands/remove.js';
import { spawn } from './commands/spawn.js';
import { status } from './commands/status.js';
import { watch } from './commands/watch.js';
import { FleetError } from './lib/errors.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

/** Run a command action, mapping expected failures to a clean exit-1 message. */
async function run(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof FleetError) {
      console.error(chalk.red(`error: ${err.message}`));
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`unexpected error: ${message}`));
    if (process.env.FLEET_DEBUG && err instanceof Error && err.stack) {
      console.error(err.stack);
    } else {
      console.error(chalk.dim('Re-run with FLEET_DEBUG=1 for a stack trace.'));
    }
  }
}

const program = new Command();

program
  .name('fleet')
  .description(
    'Manage multiple AI coding agents working on the same git repository.\n' +
      'Each agent gets an isolated worktree + branch; Fleet tracks them and\n' +
      'flags file-level collisions before you merge.',
  )
  .version(pkg.version)
  .showHelpAfterError('(run `fleet --help` for usage)');

program
  .command('spawn')
  .description('create an isolated worktree + branch (fleet/<name>) for an agent')
  .argument('<agent-name>', 'name for the agent, e.g. claude, codex, cursor')
  .option('--from <branch>', 'base branch to spawn from (default: current branch)')
  .action((name: string, opts: { from?: string }) => run(() => spawn(name, opts)));

program
  .command('list')
  .description('show all active agents: branch, ahead/behind, changes, last activity')
  .action(() => run(() => list()));

program
  .command('status')
  .description("detailed view of one agent's worktree and branch vs its base")
  .argument('<agent-name>', 'agent to inspect')
  .action((name: string) => run(() => status(name)));

program
  .command('check')
  .description('flag files touched by more than one agent (exits 1 if any are found)')
  .action(() =>
    run(async () => {
      const result = await check();
      if (result.collisions.length > 0) process.exitCode = 1;
    }),
  );

program
  .command('diff')
  .description("show an agent branch's full diff against its base branch")
  .argument('<agent-name>', 'agent to diff')
  .option('--base <branch>', 'diff against this branch instead of the recorded base')
  .action((name: string, opts: { base?: string }) => run(() => diff(name, opts)));

program
  .command('watch')
  .description('live-updating `fleet list`, re-rendered on an interval until Ctrl+C')
  .option('--interval <seconds>', 'refresh interval in seconds (default: 3)', parseFloat)
  .action((opts: { interval?: number }) => run(() => watch(opts)));

program
  .command('merge')
  .description("merge an agent's branch into the current branch, then clean up the agent")
  .argument('<agent-name>', 'agent to merge')
  .option('--delete-branch', 'delete the branch after merging (already the default cleanup)')
  .option('--no-clean', 'keep the worktree and branch after merging')
  .action((name: string, opts: { deleteBranch?: boolean; clean?: boolean }) =>
    run(() => merge(name, opts)),
  );

program
  .command('doctor')
  .description('diagnose state/reality drift; exits 1 if problems remain unfixed')
  .option('--fix', 'repair what can be repaired (rebuild state, adopt/remove orphans, prune stale entries)')
  .action((opts: { fix?: boolean }) =>
    run(async () => {
      const result = await doctor(opts);
      if (!result.healthy) process.exitCode = 1;
    }),
  );

program
  .command('completion')
  .description('output a shell completion script (agent names are a snapshot)')
  .argument('<shell>', 'bash, zsh, or fish')
  .action((shell: string) => run(() => completion(shell)));

program
  .command('remove')
  .description("remove an agent's worktree (branch is kept unless --delete-branch)")
  .argument('<agent-name>', 'agent to remove')
  .option('--force', 'discard uncommitted changes / delete an unmerged branch')
  .option('--delete-branch', "also delete the agent's fleet/<name> branch")
  .action((name: string, opts: { force?: boolean; deleteBranch?: boolean }) =>
    run(() => remove(name, opts)),
  );

program
  .command('clean')
  .description('remove agents whose branches are fully merged into their base')
  .option('--dry-run', 'list what would be cleaned without removing anything')
  .action((opts: { dryRun?: boolean }) => run(() => clean(opts)));

program.addHelpText(
  'after',
  '\nExamples:\n' +
    '  fleet spawn claude              spawn an agent off the current branch\n' +
    '  fleet spawn codex --from main   spawn a second agent off main\n' +
    '  fleet check                     any files touched by both?\n' +
    '  fleet diff claude               review before merging fleet/claude\n' +
    '  fleet merge claude              merge fleet/claude and clean it up\n' +
    '  fleet remove codex --force      drop a worktree, discarding its changes\n' +
    '  fleet clean                     sweep up fully merged agents\n' +
    '  fleet doctor --fix              repair state drift after manual surgery\n',
);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
