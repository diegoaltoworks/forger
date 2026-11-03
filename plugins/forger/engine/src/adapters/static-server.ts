/**
 * An `AppServer` that serves one folder over HTTP from this process, so a
 * wireframe can be captured with no dev server. It never leaves the folder: a
 * path that resolves outside it is a 404.
 */

import {existsSync, statSync} from 'fs';
import {join, resolve, sep} from 'path';

import type {AppServer} from '../ports';

export function staticAppServer(root: string, port: number): AppServer {
  const base = resolve(root);
  let server: ReturnType<typeof Bun.serve> | undefined;
  return {
    async start() {
      server = Bun.serve({
        hostname: '127.0.0.1',
        port,
        fetch(req) {
          const path = resolve(join(base, decodeURIComponent(new URL(req.url).pathname)));
          if (path !== base && !path.startsWith(base + sep)) return new Response('not found', {status: 404});
          const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
          return existsSync(file) ? new Response(Bun.file(file)) : new Response('not found', {status: 404});
        },
      });
    },
    async waitReady() {},
    async stop() {
      await server?.stop(true);
      server = undefined;
    },
  };
}
