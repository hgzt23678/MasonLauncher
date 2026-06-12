import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ensureInstanceSubdirectory,
  ensureLauncherLogsDirectory,
  ensureManagedInstanceDirectory,
  managedInstanceDirectory,
} from '../src/instance-paths';

test('instance path is derived below the managed instances root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-instances-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const instance = await ensureManagedInstanceDirectory(root, 'profile-1');
  assert.equal(
    instance,
    await fs.realpath(path.join(root, 'profile-1', 'instance')),
  );
});

test('invalid instance IDs and symlink escapes are rejected', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-instances-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-outside-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  assert.throws(() => managedInstanceDirectory(root, '../outside'));

  const profileRoot = path.join(root, 'profile-2');
  await fs.mkdir(profileRoot, { recursive: true });
  try {
    await fs.symlink(
      outside,
      path.join(profileRoot, 'instance'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'EACCES')
    ) {
      t.skip('Symlink creation is not permitted in this environment.');
      return;
    }
    throw error;
  }
  await assert.rejects(
    ensureManagedInstanceDirectory(root, 'profile-2'),
    /symlink|junction/,
  );
});

test('instance child directories reject symlink and junction escapes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-instances-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-outside-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const instance = await ensureManagedInstanceDirectory(root, 'profile-3');
  try {
    await fs.symlink(
      outside,
      path.join(instance, 'mods'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'EACCES')
    ) {
      t.skip('Symlink creation is not permitted in this environment.');
      return;
    }
    throw error;
  }
  await assert.rejects(
    ensureInstanceSubdirectory(instance, 'mods'),
    /symlink|junction/,
  );
});

test('launcher logs remain below the managed profile directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-instances-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const logs = await ensureLauncherLogsDirectory(root, 'profile-4');
  const canonicalProfile = await fs.realpath(path.join(root, 'profile-4'));
  assert.equal(
    path.relative(canonicalProfile, logs),
    'launcher-logs',
  );
});
