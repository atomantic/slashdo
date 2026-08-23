import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('fetch_file preserves an existing destination when curl writes a partial response', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'slashdo-fetch-file-'));
  const destination = path.join(tempDir, 'push.md');
  const curl = path.join(tempDir, 'curl');
  const functionSource = spawnSync('sed', ['-n', '/^fetch_file()/,/^}/p', 'install.sh'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  try {
    assert.equal(functionSource.status, 0, functionSource.stderr);
    await writeFile(destination, 'previously working command\n');
    await writeFile(curl, '#!/usr/bin/env bash\nprintf partial > "${@: -1}"\nexit 18\n', { mode: 0o755 });

    const result = spawnSync('bash', ['-c', `${functionSource.stdout}\nfetch_file commands/do/push.md "$1"`, '--', destination], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, BASE_URL: 'https://example.invalid', LOCAL_MODE: 'false', PATH: `${tempDir}:${process.env.PATH}` },
    });

    assert.equal(result.status, 1, result.stderr);
    assert.equal(await readFile(destination, 'utf8'), 'previously working command\n');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
