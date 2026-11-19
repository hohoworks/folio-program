import { createReadStream, existsSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import worker from '../admin/worker.mjs';
import { createLocalStore } from './local-store.mjs';

const repo = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const host = '127.0.0.1';
const port = Number(process.env.FOLIO_ADMIN_PORT || 8787);
const origin = `http://${host}:${port}`;
const split = existsSync(join(repo, '.folio-split-program'));
const defaultContent = split ? join(repo, '..', 'folio-content', 'dist') : join(repo, 'dist');
const content = await realpath(resolve(process.env.FOLIO_CONTENT_DIR || defaultContent));
if (split && (content === repo || content.startsWith(repo + sep) || repo.startsWith(content + sep))) {
  throw new Error('작품은 프로그램 저장소 밖의 비공개 folio-content/dist 폴더에 저장해야 합니다.');
}
const adminAssets = await realpath(join(repo, 'admin/public'));
const stateRoot = split ? join(content, '..') : repo;
const stateDir = resolve(process.env.FOLIO_ADMIN_STATE_DIR || join(stateRoot, '.wrangler/local-admin'));
if (!/^[A-Za-z0-9_-]{43,128}$/.test(process.env.ADMIN_CODE || '')) {
  throw new Error('.dev.vars 파일에 기존 관리자 접속 코드를 ADMIN_CODE로 설정해주세요.');
}
if (stateDir === adminAssets || stateDir.startsWith(adminAssets + sep)) throw new Error('임시 저장 폴더는 관리자 화면 밖에 지정해주세요.');
const localStore = await createLocalStore(content, stateDir);
const privateState = await realpath(stateDir);
if (privateState === adminAssets || privateState.startsWith(adminAssets + sep)) throw new Error('임시 저장 폴더가 관리자 화면 안에 있습니다.');

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};
const env = {
  ADMIN_CODE: process.env.ADMIN_CODE,
  LOCAL_STORE: localStore,
  ASSETS: {
    async fetch(request) {
      const wanted = resolve(adminAssets, '.' + new URL(request.url).pathname);
      try {
        const file = await realpath(wanted);
        if (!file.startsWith(adminAssets + sep)) return new Response(null, { status: 404 });
        const info = await lstat(file, { bigint: true });
        if (!info.isFile()) return new Response(null, { status: 404 });
        const headers = { 'Content-Type': mime[extname(file)] || 'application/octet-stream' };
        if (file.startsWith(join(adminAssets, 'vendor', 'pdfjs') + sep)) {
          headers.ETag = `W/"${info.size}-${info.mtimeNs}"`;
          if (request.headers.get('If-None-Match') === headers.ETag) return new Response(null, { status: 304, headers });
        }
        return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file)), {
          headers,
        });
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return new Response(null, { status: 404 });
        throw error;
      }
    },
  },
  LOGIN_RATE_LIMITER: {
    attempts: [],
    limit() {
      const now = Date.now();
      this.attempts = this.attempts.filter(time => now - time < 60000);
      if (this.attempts.length >= 8) return { success: false };
      this.attempts.push(now);
      return { success: true };
    },
  },
};

const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.headers.host !== `${host}:${port}` || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
      outgoing.writeHead(403).end();
      return;
    }
    const url = new URL(incoming.url, origin);
    if (url.origin !== origin) {
      outgoing.writeHead(403).end();
      return;
    }
    const request = new Request(url, {
      method: incoming.method, headers: incoming.headers,
      ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }),
    });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), 'X-Folio-Storage': 'local' });
    if (response.body) Readable.fromWeb(response.body).on('error', () => outgoing.destroy()).pipe(outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
server.listen(port, host, () => console.log(`로컬 관리자 · ${origin}/admin`));
