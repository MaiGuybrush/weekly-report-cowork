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
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Angular dev server exited before becoming ready');
    try {
      ready = (await fetch(origin)).ok;
      if (ready) break;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.ok(ready, 'Angular dev server did not become ready');

  const response = await fetch(`${origin}/api/me`);
  const contentType = response.headers.get('content-type') ?? '';
  assert.ok(
    !(response.status === 200 && contentType.includes('text/html')),
    '/api/me must be proxied to the API, not answered with the Angular index page'
  );
  console.log('Angular dev server proxies /api/me');
} finally {
  server.kill();
  if (server.exitCode === null) await once(server, 'exit');
}
