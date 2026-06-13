import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isConfirmedMinecraftWindow,
  type WindowProbeCandidate,
} from '../src/minecraft-window-probe';

const candidate = (
  update: Partial<WindowProbeCandidate> = {},
): WindowProbeCandidate => ({
  pid: 1234,
  parentPid: 1000,
  pidInTree: true,
  handle: 100,
  title: 'Minecraft 1.20.1',
  className: 'LWJGL',
  executablePath: 'C:\\Java\\bin\\javaw.exe',
  visible: true,
  minimized: false,
  cloaked: false,
  ownerHandle: 0,
  bounds: { x: 100, y: 100, width: 1280, height: 720 },
  intersectsVirtualScreen: true,
  ...update,
});

test('only a visible on-screen top-level window in the Java PID tree is confirmed', () => {
  assert.equal(isConfirmedMinecraftWindow(candidate()), true);
  assert.equal(
    isConfirmedMinecraftWindow(candidate({ pidInTree: false })),
    false,
  );
  assert.equal(
    isConfirmedMinecraftWindow(candidate({ visible: false })),
    false,
  );
  assert.equal(
    isConfirmedMinecraftWindow(candidate({ minimized: true })),
    false,
  );
  assert.equal(
    isConfirmedMinecraftWindow(candidate({ cloaked: true })),
    false,
  );
  assert.equal(
    isConfirmedMinecraftWindow(candidate({ ownerHandle: 99 })),
    false,
  );
  assert.equal(
    isConfirmedMinecraftWindow(
      candidate({ bounds: { x: 0, y: 0, width: 0, height: 0 } }),
    ),
    false,
  );
  assert.equal(
    isConfirmedMinecraftWindow(candidate({ intersectsVirtualScreen: false })),
    false,
  );
});
