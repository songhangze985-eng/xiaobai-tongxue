import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  copyRuntimeModules,
  installFakeResend,
  launchGateway,
  openPort,
  stopChild,
} from './integration.test-harness.mjs';

test('oversized resend webhook body is rejected on the HTTP response', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-webhook-body-'));
  const data = path.join(root, 'data');
  await mkdir(path.join(root, 'dist'));
  await mkdir(data);
  await writeFile(path.join(root, 'dist', 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);
  await installFakeResend(root);
  await writeFile(path.join(root, 'production-storage.mjs'), `
export async function createProductionStorage() {
  return {
    postgres: { withTransaction() { throw new Error('storage-unused'); } },
    async bootstrapUsers(users) { return users; },
    createInboundProcessor() {
      return { process() { throw new Error('webhook-processor-unused'); } };
    },
  };
}
`);
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port,
    distDir: './dist',
    dataDir: data,
    allowInsecureAuth: true,
    users: [],
  }));
  const child = await launchGateway(root, path.join(root, 'resend.log'), {
    RESEND_WEBHOOK_SECRET: 'test-only-key',
  });
  t.after(async () => {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/webhooks/resend`, {
    method: 'POST',
    body: Buffer.alloc((1024 * 1024) + 1),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'body-too-large' });
  assert.equal(child.exitCode, null);
});
