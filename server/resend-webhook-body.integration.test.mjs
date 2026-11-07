import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyRuntimeModules, openPort, waitForReady } from './integration.test-harness.mjs';

const WEBHOOK_BODY_LIMIT = 1024 * 1024;
const ISOLATED_ENV_KEYS = [
  'RESEND_API_KEY',
  'RESEND_FROM',
  'DATABASE_URL',
  'REDIS_URL',
  'COS_SECRET_ID',
  'COS_SECRET_KEY',
  'COS_BUCKET',
  'STORAGE_REQUIRED',
  'ADMIN_OWNER_EMAIL',
  'ADMIN_PUBLIC_ORIGIN',
  'COMMERCE_PUBLIC_ORIGIN',
  'ADMIN_TOKEN_HMAC_KEY',
  'CDK_HMAC_KEY',
  'CDK_HMAC_KEYS',
  'CDK_HMAC_KEY_VERSION',
];

function isolatedEnv() {
  const env = {
    ...process.env,
    RESEND_WEBHOOK_SECRET: 'test-webhook-secret',
  };
  for (const key of ISOLATED_ENV_KEYS) delete env[key];
  return env;
}

test('oversized resend webhook body is rejected on the HTTP response', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-webhook-body-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);
  await writeFile(path.join(root, 'production-storage.mjs'), `
export async function createProductionStorage() {
  return {
    postgres: {
      async withTransaction() {
        throw new Error('storage-unused');
      },
    },
    redisOtp: {
      async rateLimit() {
        throw new Error('storage-unused');
      },
    },
    async bootstrapUsers({ configured, registered }) {
      return { configured, registered };
    },
    async importStateIfMissing() {
      return false;
    },
    async getTranscript() {
      return null;
    },
    createInboundProcessor() {
      return {
        async process() {
          throw new Error('webhook-processor-unused');
        },
      };
    },
    async close() {},
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

  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: root,
    env: isolatedEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const serverLog = () => Buffer.concat(stderr).toString('utf8');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });

  try {
    await waitForReady(child);
  } catch (error) {
    assert.fail(`${error.message}\n${serverLog()}`);
  }

  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/webhooks/resend`, {
      method: 'POST',
      body: Buffer.alloc(WEBHOOK_BODY_LIMIT + 1),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const exit = child.exitCode === null
      ? await Promise.race([
        once(child, 'exit').then(([code, signal]) => ({ code, signal })),
        new Promise((resolve) => {
          setTimeout(() => resolve({ code: null, signal: null }), 500);
        }),
      ])
      : { code: child.exitCode, signal: child.signalCode };
    assert.fail(
      `oversized webhook produced no HTTP response (${error.name}: ${error.message}); `
      + `exit=${exit.code}/${exit.signal}\n${serverLog()}`,
    );
  }

  assert.equal(response.status, 413, serverLog());
  assert.deepEqual(await response.json(), { error: 'body-too-large' });
  assert.equal(child.exitCode, null);
});
