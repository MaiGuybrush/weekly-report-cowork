import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const web = resolve(root, 'apps/web');
const port = await new Promise(resolvePort => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const assigned = server.address().port;
    server.close(() => resolvePort(assigned));
  });
});
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: web,
  stdio: 'ignore'
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (server.exitCode !== null) throw new Error('Angular dev server exited before becoming ready');
    try {
      ready = (await fetch(origin)).ok;
      if (ready) break;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.ok(ready, 'Angular dev server did not become ready');

  const config = await fetch(`${origin}/assets/config.json`);
  assert.equal(config.status, 200);
  assert.equal((await config.json()).apiBaseUrl, 'http://localhost:5080');
  const apiPath = await fetch(`${origin}/api/me`);
  assert.match(apiPath.headers.get('content-type') ?? '', /text\/html/, 'dev server must not proxy /api');
  console.log('Angular dev server serves runtime config without an API proxy');
} finally {
  server.kill();
  if (server.exitCode === null) await once(server, 'exit');
}
