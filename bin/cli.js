#!/usr/bin/env node
'use strict';

const path = require('path');
const readline = require('readline');
const { detectInstalled, getEnv, allEnvNames, ENVIRONMENTS } = require('../src/environments');
const { install, list } = require('../src/installer');

const PACKAGE_DIR = path.resolve(__dirname, '..');

const BANNER = `
  \x1b[36m    ██╗\x1b[33m██████╗  ██████╗ \x1b[0m
  \x1b[36m   ██╔╝\x1b[33m██╔══██╗██╔═══██╗\x1b[0m
  \x1b[36m  ██╔╝ \x1b[33m██║  ██║██║   ██║\x1b[0m
  \x1b[36m ██╔╝  \x1b[33m██║  ██║██║   ██║\x1b[0m
  \x1b[36m██╔╝   \x1b[33m██████╔╝╚██████╔╝\x1b[0m
  \x1b[36m╚═╝    \x1b[33m╚═════╝  ╚═════╝ \x1b[0m
  \x1b[2mslashdo — curated slash commands for AI coding assistants\x1b[0m
`;

function usage() {
  console.log(BANNER);
  console.log(`Usage:
  npx slash-do@latest                          Install/update all, auto-detect envs
  npx slash-do@latest --env claude             Install for Claude Code only
  npx slash-do@latest --env opencode,gemini    Specific environments
  npx slash-do@latest --list                   Show commands and install status
  npx slash-do@latest --dry-run                Preview changes
  npx slash-do@latest --uninstall              Remove installed commands
  npx slash-do@latest push pr                   Install specific commands only

Options:
  --env <envs>    Comma-separated environments: ${allEnvNames().join(', ')}
  --list          Show all commands and their install status
  --dry-run       Preview changes without applying them
  --uninstall     Remove all slashdo-installed commands
  --help          Show this help message

Environments:
  claude     Claude Code    (~/.claude/commands/)
  opencode   OpenCode       (~/.config/opencode/commands/)
  gemini     Gemini CLI     (~/.gemini/commands/)
  codex      Codex          (~/.codex/skills/)
`);
}

function parseArgs(argv) {
  const args = {
    envs: [],
    list: false,
    dryRun: false,
    uninstall: false,
    help: false,
    commands: [],
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--list':
        args.list = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--uninstall':
        args.uninstall = true;
        break;
      case '--env':
        i++;
        if (i < argv.length) {
          args.envs = argv[i].split(',').map(s => s.trim().toLowerCase());
        }
        break;
      default:
        if (!arg.startsWith('-')) {
          args.commands.push(arg.replace(/^do:/, ''));
        }
        break;
    }
    i++;
  }

  return args;
}

function promptUser(question, choices) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(`\n${question}`);
    choices.forEach((c, i) => console.log(`  ${i + 1}) ${c}`));
    console.log(`  a) All of the above`);
    rl.question('\nSelect (comma-separated numbers, or "a" for all): ', (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'a' || trimmed === 'all') {
        resolve(choices.map((_, i) => i));
        return;
      }
      const indices = trimmed.split(',')
        .map(s => parseInt(s.trim(), 10) - 1)
        .filter(n => !isNaN(n) && n >= 0 && n < choices.length);
      resolve(indices);
    });
  });
}

function printListTable(items, envName) {
  console.log(`\n  Commands for ${envName}:\n`);
  const nameWidth = Math.max(20, ...items.map(i => i.name.length + 2));
  const statusWidth = 14;

  console.log(
    `  ${'COMMAND'.padEnd(nameWidth)} ${'STATUS'.padEnd(statusWidth)} DESCRIPTION`
  );
  console.log(
    `  ${'-------'.padEnd(nameWidth)} ${'------'.padEnd(statusWidth)} -----------`
  );
  for (const item of items) {
    console.log(
      `  ${item.name.padEnd(nameWidth)} ${item.status.padEnd(statusWidth)} ${item.description}`
    );
  }
}

function printResults(results, envName, dryRun) {
  const prefix = dryRun ? '(dry run) ' : '';
  console.log(`\n  ${prefix}${envName}:`);
  for (const action of results.actions) {
    console.log(`    ${action.status}: ${action.name}`);
  }
  console.log(`\n    ${results.installed} installed, ${results.updated} updated, ${results.upToDate} up to date${results.removed ? `, ${results.removed} removed` : ''}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    process.exit(0);
  }

  let selectedEnvs = args.envs;

  if (!selectedEnvs.length) {
    const detected = detectInstalled();
    if (!detected.length) {
      console.log('\nNo supported AI coding environments detected.');
      console.log('Supported environments:');
      for (const [key, env] of Object.entries(ENVIRONMENTS)) {
        console.log(`  ${key.padEnd(12)} ${env.name}`);
      }
      console.log('\nUse --env to specify: npx slash-do@latest --env claude');
      process.exit(1);
    }

    if (detected.length === 1) {
      selectedEnvs = detected;
      console.log(`Detected: ${ENVIRONMENTS[detected[0]].name}`);
    } else {
      const choices = detected.map(k => `${k} (${ENVIRONMENTS[k].name})`);
      const indices = await promptUser('Multiple environments detected. Select which to install:', choices);
      if (!indices.length) {
        console.log('No environments selected.');
        process.exit(0);
      }
      selectedEnvs = indices.map(i => detected[i]);
    }
  }

  const invalidEnvs = selectedEnvs.filter(e => !getEnv(e));
  if (invalidEnvs.length) {
    console.error(`Unknown environment(s): ${invalidEnvs.join(', ')}`);
    console.error(`Valid: ${allEnvNames().join(', ')}`);
    process.exit(1);
  }

  if (args.list) {
    for (const envName of selectedEnvs) {
      const env = getEnv(envName);
      const items = list({ env, packageDir: PACKAGE_DIR });
      printListTable(items, env.name);
    }
    process.exit(0);
  }

  console.log(BANNER);

  for (const envName of selectedEnvs) {
    const env = getEnv(envName);
    const results = install({
      env,
      packageDir: PACKAGE_DIR,
      filterNames: args.commands.length ? args.commands : null,
      dryRun: args.dryRun,
      uninstall: args.uninstall,
    });
    printResults(results, env.name, args.dryRun);
  }

  if (!args.dryRun && !args.uninstall) {
    console.log('\nDone! Commands are available as /do:<name> in your AI coding assistant.');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs };
