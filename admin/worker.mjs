import { MAX_PROJECT_VIDEO_BYTES, isProjectVideoPath, projectEmbedURL, projectMedia } from '../dist/project-media.js';
import { STOCK_PROJECT_TAGS, idsFor } from '../dist/project-tags.js';
import { mockupViews, trimSize, validBookColor } from '../dist/book-material.js';
import { bookLeafGeometry, validCardStock, validCoverStock, validFaceSize, validLeafLayout, validSaddleSections } from '../dist/book-format.js';
import { mockupDetailFields, validMockupDetail } from '../dist/mockup-options.js';
import { DEFAULT_SITE_TITLE, migrateStarterSite } from '../dist/site-title.js';

const sessionCookie = '__Host-folio-admin';
const sessionDuration = 4 * 60 * 60;
const githubVersion = '2026-03-10';
const catalogPath = 'dist/catalog.json';
const maxAssetBytes = 10 * 1024 * 1024;
const maxPages = 1000;
// Leave 1,000 files for the viewer, admin bundles, fonts, and other static assets.
const maxCatalogFiles = 19000;
const bindingTypes = new Set(['hardcover', 'saddle-stitch', 'exposed-sewn', 'paperback', 'spiral', 'ring']);
const gitSha = /^[a-f0-9]{40}$/;
const encoder = new TextEncoder();

const imageExtensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self' blob: data:",
    "style-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

class RequestError extends Error {
  constructor(status, message, retryAfter, code) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { ...securityHeaders, ...headers } });
}

function adminCode(env) {
  if (typeof env.ADMIN_CODE !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(env.ADMIN_CODE)) {
    throw new RequestError(503, '관리자 접속 코드가 설정되어 있지 않습니다.');
  }
  return env.ADMIN_CODE;
}

function hmacKey(code) {
  return crypto.subtle.importKey(
    'raw', encoder.encode(code), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function base64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  if (globalThis.Buffer) {
    return globalThis.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  const strings = [];
  for (let i = 0; i < bytes.length; i += 0x4000) {
    strings.push(String.fromCharCode(...bytes.subarray(i, i + 0x4000)));
  }
  return btoa(strings.join(''));
}

function urlBase64(bytes) {
  return base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// GitHub accepts binary blobs as base64 JSON. Encode on demand so a full-size
// video does not also require complete base64, JSON and UTF-8 copies in memory.
function gitBlobBody(bytes) {
  const prefix = '{"encoding":"base64","content":"';
  const suffix = '"}';
  const chunkSize = 3 * 65536; // Only the last base64 chunk may contain padding.
  let offset = 0;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(prefix));
    },
    pull(controller) {
      if (offset < bytes.length) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        controller.enqueue(encoder.encode(base64(chunk)));
        offset += chunk.length;
      } else {
        controller.enqueue(encoder.encode(suffix));
        controller.close();
      }
    },
  });
  // Workers use the fixed length as the outgoing Content-Length. Local Fetch
  // implementations can send the same stream with chunked transfer encoding.
  const length = prefix.length + 4 * Math.ceil(bytes.length / 3) + suffix.length;
  return typeof FixedLengthStream === 'function' ? stream.pipeThrough(new FixedLengthStream(length)) : stream;
}

function cookieValue(value, duration = sessionDuration) {
  return `${sessionCookie}=${value}; Path=/; Max-Age=${duration}; Secure; HttpOnly; SameSite=Strict`;
}

async function validCode(expected, provided) {
  if (typeof provided !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(provided)) return false;
  const message = encoder.encode('folio:admin-login:v1');
  const suppliedKey = await hmacKey(provided);
  const signature = await crypto.subtle.sign('HMAC', suppliedKey, message);
  const expectedKey = await hmacKey(expected);
  return crypto.subtle.verify('HMAC', expectedKey, signature, message);
}

async function sessionValue(code) {
  const expires = Math.floor(Date.now() / 1000) + sessionDuration;
  const payload = `${expires}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign(
    'HMAC', await hmacKey(code), encoder.encode('folio:admin-session:v1:' + payload),
  );
  return `${payload}.${urlBase64(new Uint8Array(signature))}`;
}

async function hasSession(request, env) {
  const token = request.headers.get('Cookie')
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(sessionCookie + '='))
    ?.slice(sessionCookie.length + 1);
  if (!token) return false;

  const match = /^(\d{1,12})\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const [, expires, nonce, signature] = match;
  const now = Math.floor(Date.now() / 1000);
  const expireTime = Number(expires);
  if (expireTime <= now || expireTime > now + sessionDuration) return false;

  const bytes = Uint8Array.from(atob(signature.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  const message = encoder.encode(`folio:admin-session:v1:${expires}.${nonce}`);
  return crypto.subtle.verify('HMAC', await hmacKey(adminCode(env)), bytes, message);
}

function requireSameOrigin(request, url) {
  if (request.headers.get('Origin') !== url.origin) {
    throw new RequestError(403, '관리자 화면에서 다시 시도해주세요.');
  }
}

async function readLimited(request, limit) {
  const length = Number(request.headers.get('Content-Length'));
  if (length > limit) throw new RequestError(413, '파일 또는 요청의 크기가 너무 큽니다.');
  if (!request.body) throw new RequestError(400, '전송된 데이터가 비어 있습니다.');

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestError(413, '파일 또는 요청의 크기가 너무 큽니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function mimeType(request) {
  return request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
}

async function readJson(request, limit) {
  if (mimeType(request) !== 'application/json') {
    throw new RequestError(415, '관리자 화면에서 다시 제출해주세요.');
  }
  const bytes = await readLimited(request, limit);
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RequestError(400, '제출한 정보를 읽을 수 없습니다.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400, '제출할 정보를 확인해주세요.');
  }
  return value;
}

async function login(request, env) {
  const expected = adminCode(env);
  let decision;
  try {
    const key = request.headers.get('CF-Connecting-IP') || 'local';
    decision = await env.LOGIN_RATE_LIMITER?.limit({ key });
  } catch {
    // An unavailable limiter cannot authorize a login.
  }
  if (typeof decision?.success !== 'boolean') throw new RequestError(503, '관리자 로그인 보호 기능을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
  if (!decision.success) throw new RequestError(429, '접속 시도가 많습니다. 잠시 후 다시 시도해주세요.', 60);
  const data = await readJson(request, 1024);
  if (!await validCode(expected, data.code)) {
    throw new RequestError(401, '접속 코드가 맞지 않습니다.');
  }
  return json({ ok: true }, 200, { 'Set-Cookie': cookieValue(await sessionValue(expected)) });
}

async function staticAsset(url, request, env, path) {
  const assetUrl = new URL(path, url.origin);
  const pdfLibrary = path.startsWith('/vendor/pdfjs/');
  const assetHeaders = new Headers();
  const validator = request.headers.get('If-None-Match');
  if (pdfLibrary && validator) assetHeaders.set('If-None-Match', validator);
  const response = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers: assetHeaders }));
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
  if (pdfLibrary && (response.status === 200 || response.status === 304) && headers.has('ETag')) {
    headers.set('Cache-Control', 'private, no-cache');
  }
  return new Response(response.body, { status: response.status, headers });
}

function gitConfiguration(env) {
  const setting = value => typeof value === 'string' ? value.trim() : value;
  const contentRepository = setting(env.FOLIO_CONTENT_REPOSITORY);
  const contentBranch = setting(env.FOLIO_CONTENT_BRANCH);
  const mode = setting(env.FOLIO_STORAGE_MODE) || (contentRepository || contentBranch ? 'private' : 'single');
  if (!['private', 'single'].includes(mode)) throw new RequestError(503, '관리자의 저장 방식을 확인해주세요.');
  const repository = contentRepository || (mode === 'single' ? setting(env.GITHUB_REPOSITORY) : undefined);
  const token = setting(env.GITHUB_TOKEN);
  const branch = contentBranch || (mode === 'single' && setting(env.GITHUB_BRANCH)) || 'main';
  if (mode === 'private' && !repository) throw new RequestError(503, '별도의 비공개 작품 저장소를 지정해주세요.');
  if (typeof token !== 'string' || !token || /[^\x21-\x7E]/.test(token)) {
    throw new RequestError(503, 'GitHub 저장 권한 키를 확인해주세요. FOLIO_GITHUB_TOKEN에는 키 한 줄만 넣고 관리자 배포를 다시 실행해주세요.', undefined, 'GITHUB_CONFIG');
  }
  if (typeof repository !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      ['.', '..'].includes(repository.split('/')[1]) ||
      typeof branch !== 'string' || /[\x00-\x20\x7F]/.test(branch) ||
      !branch.split('/').every(part => part && part !== '.' && part !== '..')) {
    throw new RequestError(503, '관리자 서버에 GitHub 저장소와 쓰기 권한이 설정되어야 합니다.');
  }
  const ref = 'heads/' + branch.split('/').map(encodeURIComponent).join('/');
  return { repository, token, branch, ref, privateContent: mode === 'private' };
}

async function github(git, path, { method = 'GET', body, accept = 'application/vnd.github+json', allowed = [], range } = {}) {
  const streaming = body instanceof ReadableStream;
  const requestBody = streaming || typeof body === 'string' ? body : JSON.stringify(body);
  let response;
  try {
    response = await fetch('https://api.github.com/repos/' + git.repository + path, {
      method,
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        'Accept': accept,
        ...(range ? { Range: range } : {}),
        'Authorization': 'Bearer ' + git.token,
        'User-Agent': 'HOHO-WORKS-Admin',
        'X-GitHub-Api-Version': githubVersion,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: requestBody,
      ...(streaming ? { duplex: 'half' } : {}),
    });
  } catch {
    throw new RequestError(502, 'GitHub 요청을 전송하지 못했습니다. 최신 관리자 프로그램을 다시 배포한 뒤 다시 시도해주세요.', undefined, 'GITHUB_CONNECTION');
  }
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    throw new RequestError(502, 'GitHub 저장소 주소가 변경되었습니다. 저장소 이름과 이동 여부를 확인하고 관리자 배포를 다시 실행해주세요.', undefined, 'GITHUB_REDIRECT');
  }
  if (response.ok || allowed.includes(response.status)) return response;
  const errorBody = await response.clone().json().catch(() => ({}));
  if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' ||
      (response.status === 403 && (response.headers.has('retry-after') ||
        /secondary rate|rate limit|abuse detection/i.test(errorBody.message || '')))) {
    const retryHeader = response.headers.get('retry-after');
    const retrySeconds = retryHeader && /^\d+$/.test(retryHeader)
      ? Number(retryHeader) : (Date.parse(retryHeader) - Date.now()) / 1000;
    const resetSeconds = Number(response.headers.get('x-ratelimit-reset')) - Date.now() / 1000;
    const retryAfter = Math.max(1, Math.ceil(Number.isFinite(retrySeconds) ? retrySeconds : resetSeconds > 0 ? resetSeconds : 60));
    throw new RequestError(429, 'GitHub 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.', retryAfter);
  }
  if (response.status === 401) {
    throw new RequestError(502, 'GitHub 저장 권한 키가 만료되었거나 유효하지 않습니다. FOLIO_GITHUB_TOKEN을 교체하고 관리자 배포를 다시 실행해주세요.', undefined, 'GITHUB_AUTH');
  }
  if (response.status === 403) {
    if (/user[\s-]?agent/i.test(errorBody.message || '')) {
      throw new RequestError(502, 'GitHub 요청 헤더 설정을 확인해주세요. 최신 관리자 프로그램을 다시 배포해주세요.', undefined, 'GITHUB_HEADERS');
    }
    throw new RequestError(502, 'GitHub 토큰의 작품 저장소 선택과 Contents 읽기·쓰기 권한, 조직 승인 여부를 확인해주세요.', undefined, 'GITHUB_PERMISSION');
  }
  if (response.status === 404) {
    throw new RequestError(502, 'GitHub 작품 저장소와 연결된 브랜치 이름, 토큰의 해당 저장소 접근 권한을 확인해주세요.', undefined, 'GITHUB_NOT_FOUND');
  }
  if ([400, 410].includes(response.status) && /api.?version/i.test(errorBody.message || '')) {
    throw new RequestError(502, 'GitHub API 버전 설정을 확인해주세요. 최신 관리자 프로그램을 다시 배포해주세요.', undefined, 'GITHUB_VERSION');
  }
  throw new RequestError(502, 'GitHub에 저장하지 못했습니다. 다시 시도해주세요.');
}

async function checkedRepository(env) {
  const git = gitConfiguration(env);
  if (git.privateContent) {
    const metadata = await (await github(git, '')).json();
    if (metadata.private !== true || metadata.visibility !== 'private' ||
        metadata.full_name?.toLowerCase() !== git.repository.toLowerCase()) {
      throw new RequestError(503, '설정한 작품 저장소의 이름과 비공개(Private) 상태를 확인해주세요.');
    }
  }
  return git;
}

async function branchHead(git) {
  const response = await github(git, '/git/ref/' + git.ref);
  return (await response.json()).object.sha;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function siteDefaults(value) {
  const site = isRecord(value) ? { ...migrateStarterSite(value) } : {};
  delete site.projectSort;
  return {
    ...site,
    title: typeof site.title === 'string' && site.title.trim() ? site.title : DEFAULT_SITE_TITLE,
    about: { heading: '', text: '', ...(isRecord(site.about) ? site.about : {}) },
    contact: { text: '', email: '', links: [], ...(isRecord(site.contact) ? site.contact : {}) },
    projectTags: site.projectTags === undefined ? STOCK_PROJECT_TAGS.map(tag => ({ ...tag })) : site.projectTags,
    revision: site.revision ?? null,
  };
}

async function readCatalog(git, ref) {
  const response = await github(git, '/contents/' + catalogPath + '?ref=' + encodeURIComponent(ref ?? git.branch), {
    accept: 'application/vnd.github.raw+json',
    allowed: [404],
  });
  if (response.status === 404) {
    if (git.privateContent) throw new RequestError(503, '작품 저장소의 지정한 브랜치에 dist/catalog.json을 먼저 올려주세요.');
    // A missing catalogue is valid only when its repository and branch exist.
    if (ref === undefined) await branchHead(git);
    return { books: [], projects: [], order: [], site: siteDefaults() };
  }

  let catalog;
  try {
    catalog = await response.json();
  } catch {
    throw new RequestError(502, 'GitHub의 책 목록 파일을 읽을 수 없습니다.');
  }
  return normalizeCatalog(catalog);
}

function normalizeCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.books) ||
      (catalog.projects !== undefined && !Array.isArray(catalog.projects))) {
    throw new RequestError(502, '책 목록 파일 형식을 확인해주세요.');
  }
  const projects = catalog.projects || [];
  const items = [...catalog.books, ...projects];
  if (items.some(item => !item || typeof item.id !== 'string' || typeof item.title !== 'string') ||
      new Set(items.map(item => item.id)).size !== items.length) {
    throw new RequestError(502, '작품 목록 파일 형식을 확인해주세요.');
  }
  const ids = new Set(items.map(item => item.id));
  const order = [...new Set(Array.isArray(catalog.order) ? catalog.order.filter(id => ids.has(id)) : [])];
  const orderedIds = new Set(order);
  return {
    ...catalog, projects,
    order: [...order, ...items.map(item => item.id).filter(id => !orderedIds.has(id))],
    site: siteDefaults(catalog.site),
  };
}

async function currentSnapshot(env) {
  if (env.LOCAL_STORE) {
    const { head, catalog } = await env.LOCAL_STORE.snapshot();
    return { head, catalog: normalizeCatalog(catalog) };
  }
  const git = await checkedRepository(env);
  const head = await branchHead(git);
  return { git, head, catalog: await readCatalog(git, head) };
}

function bytesMatch(bytes, prefix, offset = 0) {
  return prefix.every((byte, i) => bytes[offset + i] === byte);
}

function imageMatches(bytes, ext) {
  if (ext === 'jpg') return bytesMatch(bytes, [255, 216, 255]);
  if (ext === 'png') return bytesMatch(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  return bytesMatch(bytes, [82, 73, 70, 70]) && bytesMatch(bytes, [87, 69, 66, 80], 8);
}

function imageDimensions(bytes, ext) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ext === 'png' && bytes.length >= 24 && bytesMatch(bytes, [73, 72, 68, 82], 12)) {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (ext === 'webp' && bytes.length >= 30) {
    if (bytesMatch(bytes, [86, 80, 56, 88], 12)) {
      const integer24 = offset => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
      return [integer24(24) + 1, integer24(27) + 1];
    }
    if (bytesMatch(bytes, [86, 80, 56, 76], 12) && bytes[20] === 47) {
      return [1 + bytes[21] + ((bytes[22] & 63) << 8),
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10)];
    }
    if (bytesMatch(bytes, [86, 80, 56, 32], 12) && bytesMatch(bytes, [157, 1, 42], 23)) {
      return [view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383];
    }
  }
  if (ext === 'jpg') {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset += 1;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 7) {
        return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      }
      offset += size;
    }
  }
  return null;
}

function videoMatches(bytes, ext) {
  const text = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (ext === 'mp4') {
    if (bytes.length < 16 || text(4) !== 'ftyp') return false;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size < 16 || size > bytes.length || size % 4 !== 0) return false;
    for (let offset = 8; offset < size; offset += 4) {
      if (offset !== 12 && /^(?:iso[0-9m]|mp4[12]|avc1|dash|M4V |MSNV)$/i.test(text(offset))) return true;
    }
    return false;
  }
  if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return false;
  // The WebM doctype element belongs to the short EBML header, before the first segment.
  for (let offset = 5; offset + 7 <= Math.min(bytes.length, 4096); offset++) {
    if (bytes[offset] === 0x42 && bytes[offset + 1] === 0x82 && bytes[offset + 2] === 0x84 && text(offset + 3) === 'webm') return true;
    if (bytes[offset] === 0x18 && bytes[offset + 1] === 0x53 && bytes[offset + 2] === 0x80 && bytes[offset + 3] === 0x67) break;
  }
  return false;
}

async function uploadAsset(request, env) {
  const mime = mimeType(request);
  const video = mime === 'video/mp4' || mime === 'video/webm';
  const ext = video ? mime.slice(6) : imageExtensions.get(mime);
  if (!ext) throw new RequestError(415, 'JPG, PNG, WebP 이미지 또는 MP4, WebM 영상을 선택해주세요.');
  const bytes = await readLimited(request, video ? MAX_PROJECT_VIDEO_BYTES : maxAssetBytes);
  const file = { ext };
  if (video) {
    if (!videoMatches(bytes, ext)) throw new RequestError(415, '영상 파일 형식을 확인해주세요.');
  } else {
    if (!imageMatches(bytes, ext)) throw new RequestError(415, '이미지 파일 형식을 확인해주세요.');
    const dimensions = imageDimensions(bytes, ext);
    if (!dimensions || dimensions.some(value => value < 1 || value > 16384) || dimensions[0] * dimensions[1] > 64000000) {
      throw new RequestError(400, '이미지는 가로·세로 16,384px 이하, 총 6,400만 픽셀 이하로 준비해주세요.');
    }
    file.ratio = dimensions[0] / dimensions[1];
  }
  if (env.LOCAL_STORE) {
    const sha = await env.LOCAL_STORE.stage(bytes);
    return json({ sha, ...file }, 201);
  }
  const git = await checkedRepository(env);
  const response = await github(git, '/git/blobs', {
    method: 'POST',
    body: gitBlobBody(bytes),
  });
  return json({ sha: (await response.json()).sha, ...file }, 201);
}

function validText(value, limit, label, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) {
    throw new RequestError(400, `${label}을(를) 확인해주세요.`);
  }
  return value.trim();
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function mutationId(value) {
  const id = value ?? crypto.randomUUID();
  if (typeof id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    throw new RequestError(400, '작품 등록 번호를 확인해주세요.');
  }
  return id.toLowerCase();
}

function itemId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,150}$/.test(value)) {
    throw new RequestError(400, '작품 번호를 확인해주세요.');
  }
  return value;
}

function validAsset(value, type = 'image') {
  const extensions = type === 'video' ? ['mp4', 'webm'] : ['jpg', 'png', 'webp'];
  if (!isRecord(value) || typeof value.sha !== 'string' || !gitSha.test(value.sha) ||
      !extensions.includes(value.ext)) {
    throw new RequestError(400, '파일을 먼저 업로드해주세요.');
  }
  return { sha: value.sha, ext: value.ext };
}

function references(item) {
  return [
    item.thumbnailSrc,
    ...Object.values(item.coverImages || {}),
    ...Object.values(item.edgeTreatments || {}).map(edge => edge?.imageSrc),
    ...(item.pages || []).map(page => page.imageSrc),
    ...projectMedia(item).map(entry => entry.type === 'video' ? entry.videoSrc : entry.imageSrc),
    ...(item.galleryImages || []).map(image => image.imageSrc),
  ].filter(path => typeof path === 'string').map(path => path.replace(/^\.\//, ''));
}

function allReferences(catalog) {
  const siteImage = catalog.site?.about?.imageSrc;
  return [
    ...[...catalog.books, ...catalog.projects].flatMap(references),
    ...(typeof siteImage === 'string' ? [siteImage.replace(/^\.\//, '')] : []),
  ];
}

function enforceAssetLimit(catalog) {
  if (allReferences(catalog).length > maxCatalogFiles) {
    throw new RequestError(400, '사이트 전체 이미지와 영상은 합쳐서 19,000개까지 등록할 수 있습니다. 기존 작품을 정리해주세요.');
  }
}

function projectTags(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new RequestError(400, '프로젝트 분류는 100개까지 등록할 수 있습니다.');
  }
  const ids = new Set();
  return value.map(tag => {
    if (!isRecord(tag) || typeof tag.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(tag.id) || ids.has(tag.id)) {
      throw new RequestError(400, '중복되지 않는 올바른 분류 번호를 사용해주세요.');
    }
    const ko = validText(tag.ko, 80, '국문 분류명', true);
    if (tag.en !== undefined && typeof tag.en !== 'string') throw new RequestError(400, '영문 분류명을 확인해주세요.');
    const en = validText(tag.en, 80, '영문 분류명');
    ids.add(tag.id);
    return { id: tag.id, ko, en };
  });
}

function checkRemovedTags(catalog, nextTags) {
  const nextIds = new Set(nextTags.map(tag => tag.id));
  const removed = catalog.site.projectTags.filter(tag => !nextIds.has(tag.id));
  if (!removed.length) return;
  const used = new Set([
    ...catalog.books.flatMap(item => idsFor(item, 'book', catalog.site.projectTags)),
    ...catalog.projects.flatMap(item => idsFor(item, 'project', catalog.site.projectTags)),
  ]);
  const blocked = removed.filter(tag => used.has(tag.id));
  if (blocked.length) {
    throw new RequestError(409, blocked.map(tag => tag.ko).join(', ') +
      ' 분류를 사용 중인 작업이 있습니다. 해당 작업의 분류를 먼저 바꿔주세요.', undefined, 'TAG_IN_USE');
  }
}

function assignTagIds(item, submitted, existing, kind, tags, retrying) {
  if (submitted !== undefined && (!Array.isArray(submitted) || submitted.length > 100 ||
      submitted.some(id => typeof id !== 'string') || new Set(submitted).size !== submitted.length)) {
    throw new RequestError(400, '작업의 분류 목록을 확인해주세요.');
  }
  const ids = retrying ? item.tagIds : submitted ?? idsFor(existing || {}, kind, tags);
  const allowed = new Set(tags.map(tag => tag.id));
  if (ids.some(id => !allowed.has(id))) {
    throw new RequestError(retrying ? 409 : 400,
      '분류 목록이 변경되었거나 없는 분류가 선택되어 있습니다. 최신 목록에서 다시 선택해주세요.', undefined, 'UNKNOWN_TAG');
  }
  item.tagIds = [...ids];
}

function englishTranslations(submitted, saved, kind) {
  if (submitted === undefined) return saved;
  if (!isRecord(submitted) || (submitted.en !== undefined && !isRecord(submitted.en))) {
    throw new RequestError(400, '영문 번역 정보를 확인해주세요.');
  }
  if (submitted.en === undefined) return saved;
  const translations = isRecord(saved) ? { ...saved } : {};
  const previous = isRecord(translations.en) ? translations.en : {};
  const source = submitted.en;
  const en = { ...previous };
  function textFields(target, input, fields) {
    for (const [field, limit] of fields) {
      if (input[field] !== undefined) {
        if (typeof input[field] !== 'string') throw new RequestError(400, '영문 번역은 텍스트로 입력해주세요.');
        target[field] = validText(input[field], limit, '영문 번역');
      } else if (target[field] === undefined) {
        target[field] = '';
      }
    }
  }
  textFields(en, source, [['title', 160]]);
  if (kind === 'site') {
    for (const [field, fields] of [
      ['about', [['heading', 200], ['text', 12000]]],
      ['contact', [['text', 6000]]],
    ]) {
      if (source[field] !== undefined && !isRecord(source[field])) {
        throw new RequestError(400, '영문 번역 정보를 확인해주세요.');
      }
      en[field] = isRecord(previous[field]) ? { ...previous[field] } : {};
      textFields(en[field], source[field] || {}, fields);
    }
  } else {
    textFields(en, source, [['category', 100]]);
    if (source.description !== undefined) {
      if (typeof source.description !== 'string') throw new RequestError(400, '영문 소개는 텍스트로 입력해주세요.');
      en.description = [validText(source.description, 6000, '영문 소개')];
    } else if (en.description === undefined) {
      en.description = [''];
    }
    if (source.language !== undefined) textFields(en, source, [['language', 60]]);
  }
  translations.en = en;
  return translations;
}

function metadata(data, existing) {
  const item = { ...existing };
  item.title = data.title === undefined && existing ? existing.title : validText(data.title, 160, '제목', true);
  for (const [field, limit, label] of [['category', 100, '분류'], ['year', 40, '연도']]) {
    if (data[field] !== undefined || !existing) item[field] = validText(data[field], limit, label);
  }
  if (data.description !== undefined || !existing) {
    item.description = [validText(data.description, 6000, '소개')];
  }
  if (data.published !== undefined && typeof data.published !== 'boolean') {
    throw new RequestError(400, '공개 여부를 확인해주세요.');
  }
  item.published = data.published ?? existing?.published ?? true;
  const translations = englishTranslations(data.translations, existing?.translations, 'item');
  if (translations !== undefined) item.translations = translations;
  return item;
}

function imageList(values, savedImages, prefix, addImage, name, allowEmpty = false) {
  if (!Array.isArray(values) || (!values.length && !allowEmpty) || values.length > maxPages) {
    throw new RequestError(400, allowEmpty ? '갤러리 이미지는 1,000장까지 등록할 수 있습니다.' : '프로젝트 이미지는 1~1,000장까지 등록할 수 있습니다.');
  }
  const saved = new Map(savedImages.map(image => [image.imageSrc.replace(/^\.\//, ''), image]));
  return values.map((image, index) => {
    if (!isRecord(image)) throw new RequestError(400, '등록할 이미지를 확인해주세요.');
    return fileEntry(image, 'image', saved, prefix, addImage, name + '-' + String(index + 1).padStart(4, '0'));
  });
}

function mediaMetadata(entry, previous) {
  const alt = validText(entry.alt === undefined ? previous?.alt : entry.alt, 500, '설명');
  const ratio = entry.ratio === undefined ? previous?.ratio : entry.ratio;
  if (ratio !== undefined && (!positive(ratio) || ratio < 1 / 16384 || ratio > 16384)) {
    throw new RequestError(400, '가로와 세로 비율을 확인해주세요.');
  }
  return { ...(alt ? { alt } : {}), ...(ratio !== undefined ? { ratio } : {}) };
}

function fileEntry(entry, type, saved, prefix, addAsset, name) {
  const key = type === 'video' ? 'videoSrc' : 'imageSrc';
  if (entry[key] === undefined) return { [key]: addAsset(entry, name, type), ...mediaMetadata(entry) };
  const path = typeof entry[key] === 'string' ? entry[key].replace(/^\.\//, '') : '';
  if (!path.startsWith(prefix) || !saved.has(path)) throw new RequestError(400, '현재 작품에 등록된 파일만 재사용할 수 있습니다.');
  return { [key]: path, ...mediaMetadata(entry, saved.get(path)) };
}

function orderedProjectMedia(values, existing, prefix, addAsset) {
  if (!Array.isArray(values) || !values.length || values.length > maxPages) {
    throw new RequestError(400, '프로젝트에는 이미지, 영상, 웹 페이지를 1~1,000개 등록할 수 있습니다.');
  }
  const saved = { image: new Map(), video: new Map() };
  for (const entry of projectMedia(existing)) {
    if (entry.type === 'image') saved.image.set(entry.imageSrc.replace(/^\.\//, ''), entry);
    if (entry.type === 'video') saved.video.set(entry.videoSrc.replace(/^\.\//, ''), entry);
  }
  return values.map((entry, index) => {
    if (!isRecord(entry)) throw new RequestError(400, '프로젝트 항목을 확인해주세요.');
    const { type } = entry;
    if (type === 'embed') {
      const url = projectEmbedURL(entry.url);
      if (!url) throw new RequestError(400, '웹 페이지의 HTTPS 주소를 확인해주세요.');
      return { type, url, ...mediaMetadata(entry) };
    }
    if (type !== 'image' && type !== 'video') throw new RequestError(400, '프로젝트 항목 유형을 확인해주세요.');
    const name = type + '-' + String(index + 1).padStart(4, '0');
    return { type, ...fileEntry(entry, type, saved[type], prefix, addAsset, name) };
  });
}

function applyThumbnail(item, existing, assets, addImage, kind) {
  const primary = kind === 'book' ? item.coverImages.front : item.images?.[0]?.imageSrc;
  const previous = kind === 'book' ? existing?.coverImages?.front : existing?.images?.[0]?.imageSrc;
  if (assets.thumbnail === undefined) {
    const reorderedCards = existing?.bookForm === 'cards' && item.bookForm === 'cards' &&
      assets.cards !== undefined && assets.front === undefined;
    if (primary !== previous && !reorderedCards) delete item.thumbnailSrc;
    return;
  }
  delete item.thumbnailSrc;
  if (assets.thumbnail === null) return;
  const thumbnail = validAsset(assets.thumbnail);
  const submittedPrimary = kind === 'book' ? assets.front : assets.media?.find(entry => entry.type === 'image') ?? assets.images?.[0];
  if (thumbnail.sha === submittedPrimary?.sha && thumbnail.ext === submittedPrimary?.ext) return;
  item.thumbnailSrc = addImage(thumbnail, 'thumbnail');
}

function storeCutEdges(item, data, assets, addImage) {
  const treatments = data.edgeTreatments;
  const scans = assets.edgeScans ?? {};
  const faces = ['head', 'fore', 'tail'];
  if (!isRecord(scans) || Object.keys(scans).some(key => !faces.includes(key))) {
    throw new RequestError(400, '재단면 이미지 위치를 확인해주세요.');
  }
  if (treatments === undefined && !Object.keys(scans).length) return;
  if (!isRecord(treatments) || Object.keys(treatments).some(key => !faces.includes(key))) {
    throw new RequestError(400, '재단면 설정을 확인해주세요.');
  }
  const result = {};
  for (const face of faces) {
    const edge = treatments[face];
    if (edge?.mode !== 'scan' && scans[face] !== undefined) throw new RequestError(400, '스캔을 사용할 면을 선택해주세요.');
    if (edge === undefined || edge?.mode === 'natural') continue;
    if (edge?.mode === 'solid' && validBookColor(edge.color)) {
      result[face] = { mode: 'solid', color: edge.color.toLowerCase() };
      continue;
    }
    if (edge?.mode !== 'scan' || ![0, 90, 180, 270].includes(edge.rotation ?? 0)) {
      throw new RequestError(400, '재단면의 색상이나 스캔 방향을 확인해주세요.');
    }
    const crop = edge.crop;
    if (crop !== undefined && (!isRecord(crop) || !['x','y','width','height'].every(key => Number.isFinite(crop[key])) ||
        crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
        crop.x + crop.width > 100.00001 || crop.y + crop.height > 100.00001)) {
      throw new RequestError(400, '스캔을 자를 범위를 확인해주세요.');
    }
    const imageSrc = scans[face] ? addImage(scans[face], 'edge-' + face) : item.edgeTreatments?.[face]?.imageSrc;
    if (!imageSrc) throw new RequestError(400, '선택한 재단면의 스캔 이미지를 올려주세요.');
    result[face] = { mode: 'scan', imageSrc, rotation: edge.rotation ?? 0,
      ...(crop && { crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height } }) };
  }
  if (Object.keys(result).length) item.edgeTreatments = result;
  else delete item.edgeTreatments;
}

function faceSize(entry) {
  if (entry.sizeMm === undefined) return {};
  if (!validFaceSize(entry.sizeMm)) throw new RequestError(400, '내지의 실제 크기를 확인해주세요.');
  return { sizeMm: entry.sizeMm };
}

function storeCards(cards, existing, prefix, addImage) {
  if (!Array.isArray(cards) || !cards.length || cards.length > maxPages / 2) {
    throw new RequestError(400, '카드는 1~500장을 등록할 수 있습니다.');
  }
  const saved = new Map((existing?.pages || []).filter(page => page.imageSrc).map(page => [page.imageSrc.replace(/^\.\//, ''), page]));
  return cards.flatMap((card, index) => ['front', 'back'].map(side => {
    if (!isRecord(card)) throw new RequestError(400, '카드 앞뒷면을 확인해주세요.');
    const face = card[side];
    if (side === 'back' && face == null) return { blank: true };
    if (!isRecord(face)) throw new RequestError(400, '카드 앞면 이미지를 확인해주세요.');
    const entry = fileEntry(face, 'image', saved, prefix, addImage, 'card-' + (index + 1) + '-' + side);
    return { ...entry, ...faceSize(face.sizeMm === undefined && saved.has(entry.imageSrc) ? saved.get(entry.imageSrc) : face) };
  }));
}

function storeConstruction(item, data, assets, addImage) {
  const count = item.pages.length / (item.joinSplitPages ? 2 : 1);
  if (data.coverStock != null && (item.bookForm === 'cards' || !validCoverStock(data.coverStock))) {
    throw new RequestError(400, '제본책 표지의 합지 색상과 각 층의 두께를 확인해주세요.');
  }
  const saddle = item.bindingType === 'saddle-stitch' && item.bookForm !== 'cards';
  if (data.saddleSections != null && !saddle) throw new RequestError(400, '분책 설정은 중철 소책자에서 사용할 수 있습니다.');
  for (const key of ['coverStock', 'cardStock', 'saddleSections', 'leafLayout', 'edgeBands', 'ringPositions']) {
    if (data[key] === null) delete item[key];
    else if (data[key] !== undefined) item[key] = data[key];
  }
  if (saddle && item.saddleSections !== undefined && !validSaddleSections(item.saddleSections, count)) {
    throw new RequestError(400, '중철 소책자의 판형·색상과 쪽수를 확인해주세요. 각 권의 쪽수 합은 등록한 내지 ' + count + '쪽과 같아야 합니다.');
  }
  if (item.cardStock !== undefined && !validCardStock(item.cardStock, Math.ceil(count / 2))) {
    throw new RequestError(400, '카드 모서리, 합지 색상과 두께, 대표 카드 번호를 확인해주세요.');
  }
  if (item.leafLayout !== undefined && !validLeafLayout(item.leafLayout, Math.ceil(count / 2), trimSize(item), item.pages)) {
    throw new RequestError(400, '장별 재단 판형과 시작·끝 장을 확인해주세요.');
  }
  if (saddle && item.saddleSections && item.leafLayout && !bookLeafGeometry(item, item.pages, count)) {
    throw new RequestError(400, '소책자 판형에 장별 재단을 적용한 결과가 측정 가능한 크기인지 확인해주세요.');
  }
  if (item.edgeBands !== undefined) {
    if (!Array.isArray(item.edgeBands) || item.edgeBands.length > maxPages || item.edgeBands.some(band => !isRecord(band) ||
      !Number.isInteger(band.start) || !Number.isInteger(band.end) || band.start < 1 || band.end > count ||
      band.end < band.start || !validBookColor(band.color))) throw new RequestError(400, '색지의 적용 쪽수와 색상을 확인해주세요.');
    if (!item.edgeBands.length) delete item.edgeBands;
    else item.edgeBands = item.edgeBands.map(({ start, end, color }) => ({ start, end, color: color.toLowerCase() }));
  }
  if (item.ringPositions !== undefined && (!Array.isArray(item.ringPositions) ||
    item.ringPositions.length !== (item.mockupDetails?.ringCount ?? mockupDetailFields.ringCount.default) ||
    item.ringPositions.some(n => !Number.isFinite(n) || n < 0 || n > 100) || new Set(item.ringPositions).size !== item.ringPositions.length)) {
    throw new RequestError(400, 'O링의 개수와 위치를 확인해주세요.');
  }
  storeCutEdges(item, data, assets, addImage);
}

function buildItem(data, existing, kind, registrationId) {
  const item = metadata(data, existing);
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || kind;
  item.id = existing?.id || slug + '-' + registrationId;
  item.revision = crypto.randomUUID();
  item.lastMutationId = registrationId;
  const tree = [];
  const prefix = 'assets/' + (kind === 'book' ? 'books/' : 'projects/') + item.id + '/';
  const version = existing ? registrationId + '-' : '';
  function addImage(file, name, type) {
    const image = validAsset(file, type);
    const path = prefix + version + name + '.' + image.ext;
    tree.push({ path: 'dist/' + path, mode: '100644', type: 'blob', sha: image.sha });
    return path;
  }
  const assets = data.assets === undefined ? {} : data.assets;
  if (!isRecord(assets)) {
    throw new RequestError(400, '업로드할 이미지를 확인해주세요.');
  }
  if (kind === 'project') {
    if (assets.media !== undefined) {
      if (assets.images !== undefined) throw new RequestError(400, '프로젝트 항목은 하나의 목록으로 보내주세요.');
      item.media = orderedProjectMedia(assets.media, existing, prefix, addImage);
      item.images = item.media.filter(entry => entry.type === 'image').map(({ type, ...image }) => image);
    } else if (assets.images !== undefined || !existing) {
      if (existing?.media?.some(entry => entry.type !== 'image')) {
        throw new RequestError(409, '영상과 웹 페이지를 보존하려면 관리자 화면을 새로고침한 뒤 다시 저장해주세요.');
      }
      item.images = imageList(assets.images, existing?.images || [], prefix, addImage, 'image');
      delete item.media;
    }
    applyThumbnail(item, existing, assets, addImage, kind);
    return { item, tree };
  }

  const bindingType = data.bindingType ?? existing?.bindingType ?? 'paperback';
  if (!bindingTypes.has(bindingType)) throw new RequestError(400, '제본 방식을 확인해주세요.');
  item.bindingType = bindingType;
  if (data.bookForm !== undefined) {
    if (!['bound', 'cards'].includes(data.bookForm)) throw new RequestError(400, '책의 형태를 확인해주세요.');
    item.bookForm = data.bookForm;
  }
  if (data.mockupDetails === null) delete item.mockupDetails;
  else if (data.mockupDetails !== undefined) {
    if (!isRecord(data.mockupDetails)) throw new RequestError(400, '책 목업 설정을 확인해주세요.');
    const details = { ...existing?.mockupDetails };
    for (const [key, value] of Object.entries(data.mockupDetails)) {
      if (!Object.hasOwn(mockupDetailFields, key)) throw new RequestError(400, '알 수 없는 책 목업 설정입니다.');
      const field = mockupDetailFields[key];
      if (!validMockupDetail(field, value)) throw new RequestError(400, field.label + ' 값을 확인해주세요.');
      const normalized = field.type === 'color' && value ? value.toLowerCase() : value;
      if (normalized === field.default) delete details[key];
      else details[key] = normalized;
    }
    if (Object.keys(details).length) item.mockupDetails = details;
    else delete item.mockupDetails;
  }
  for (const key of ['pageJumpEnabled', 'resumeReadingEnabled']) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== 'boolean') throw new RequestError(400, '책 읽기 설정을 확인해주세요.');
    item[key] = data[key];
  }
  if (data.mockupView !== undefined) {
    if (typeof data.mockupView !== 'string' || !Object.hasOwn(mockupViews, data.mockupView)) throw new RequestError(400, '목업의 첫 각도를 확인해주세요.');
    item.mockupView = data.mockupView;
  }
  for (const key of ['caseColor', 'paperColor']) {
    if (data[key] === undefined) continue;
    if (data[key] === null) delete item[key];
    else if (validBookColor(data[key])) item[key] = data[key].toLowerCase();
    else throw new RequestError(400, '목업 색상을 확인해주세요.');
  }
  if (data.firstPageSide === null) delete item.firstPageSide;
  else if (data.firstPageSide !== undefined) {
    if (!['right', 'left'].includes(data.firstPageSide)) throw new RequestError(400, '첫 페이지 위치를 확인해주세요.');
    item.firstPageSide = data.firstPageSide;
  }
  for (const field of ['coverRatio', 'pageRatio']) {
    const value = data[field] === undefined ? existing?.[field] : data[field];
    if (!positive(value) || value < 0.05 || value > 20) {
      throw new RequestError(400, '표지와 내지의 비율을 확인해주세요.');
    }
    item[field] = value;
  }
  if (data.language !== undefined || !existing) item.language = validText(data.language, 60, '언어');
  if (data.trimSizeMm !== undefined || !existing) {
    if (data.trimSizeMm != null && (!Array.isArray(data.trimSizeMm) || data.trimSizeMm.length !== 2 ||
        !data.trimSizeMm.every(value => positive(value) && value >= 10 && value <= 5000))) {
      throw new RequestError(400, '책의 가로와 세로 크기를 확인해주세요.');
    }
    delete item.trimSizeMm;
    if (data.trimSizeMm != null) item.trimSizeMm = data.trimSizeMm;
  }
  if (data.spineWidthMm !== undefined || !existing) {
    if (data.spineWidthMm != null && (!positive(data.spineWidthMm) || data.spineWidthMm > 500)) {
      throw new RequestError(400, '책등 두께를 확인해주세요.');
    }
    delete item.spineWidthMm;
    if (data.spineWidthMm != null) item.spineWidthMm = data.spineWidthMm;
  }
  item.coverImages = { ...existing?.coverImages };
  for (const face of ['front', 'back', 'spine']) {
    if (assets[face] === undefined) continue;
    if (assets[face] === null && face !== 'front') delete item.coverImages[face];
    else item.coverImages[face] = addImage(assets[face], face);
  }
  if (data.joinSplitPages !== undefined && typeof data.joinSplitPages !== 'boolean') {
    throw new RequestError(400, '분리된 내지 복원 설정을 확인해주세요.');
  }
  if (assets.cards !== undefined) {
    if (item.bookForm !== 'cards' || assets.pages !== undefined || data.joinSplitPages || data.pdfLayout !== undefined || data.pdfSheetSides !== undefined) {
      throw new RequestError(400, '카드는 카드 앞뒷면 목록으로 등록해주세요.');
    }
    item.pages = storeCards(assets.cards, existing, prefix, addImage);
    // Older clients can reorder cards without resubmitting construction settings.
    // Keep the chosen front if it survives; use the first card when it was removed.
    if (data.cardStock === undefined && existing?.cardStock?.thumbnailCard) {
      const selected = existing.pages[(existing.cardStock.thumbnailCard - 1) * 2]?.imageSrc;
      const face = item.pages.findIndex((page, index) => index % 2 === 0 && page.imageSrc === selected);
      item.cardStock = { ...existing.cardStock, thumbnailCard: face < 0 ? 1 : face / 2 + 1 };
    }
    delete item.joinSplitPages;
    delete item.pdfLayout;
    delete item.pdfSheetSides;
    if (!item.coverImages.front || (assets.front === undefined && existing?.coverImages?.front === existing?.pages?.[0]?.imageSrc)) {
      item.coverImages.front = item.pages[0].imageSrc;
      item.coverRatio = item.pages[0].ratio ?? item.coverRatio;
    }
  } else if (assets.pages !== undefined || !existing) {
    if (!Array.isArray(assets.pages) || !assets.pages.length || assets.pages.length > maxPages) {
      throw new RequestError(400, '내지는 1~1,000쪽까지 등록할 수 있습니다.');
    }
    if (data.joinSplitPages) throw new RequestError(400, '분리된 기존 이미지에만 내지 복원을 적용할 수 있습니다.');
    delete item.pdfLayout;
    delete item.pdfSheetSides;
    delete item.joinSplitPages;
    if (data.pdfSheetSides !== undefined && data.pdfLayout !== 'mixed') throw new RequestError(400, '혼합 PDF 페이지 구성을 확인해주세요.');
    if (data.pdfLayout !== undefined) {
      if (!['single', 'spread', 'mixed'].includes(data.pdfLayout) ||
          (data.pdfLayout === 'spread' && assets.pages.length % 2 !== 0) ||
          (data.pdfLayout === 'mixed' && assets.pages.length < 3)) {
        throw new RequestError(400, 'PDF 구성과 변환된 쪽수를 확인해주세요.');
      }
      item.pdfLayout = data.pdfLayout;
      if (data.pdfLayout === 'mixed') {
        const sides = data.pdfSheetSides;
        if (!Array.isArray(sides) || sides.length > maxPages || !sides.includes(1) || !sides.includes(2) ||
            !sides.every(n => n === 1 || n === 2) || sides.reduce((sum, n) => sum + n, 0) !== assets.pages.length) {
          throw new RequestError(400, '혼합 PDF 페이지 구성과 내지 쪽수를 확인해주세요.');
        }
        item.pdfSheetSides = sides;
      }
    }
    item.pages = assets.pages.map((file, index) => ({ imageSrc: addImage(file, 'page-' + String(index + 1).padStart(4, '0')), ...faceSize(file) }));
  } else {
    if (data.pdfSheetSides !== undefined || (data.pdfLayout !== undefined && data.pdfLayout !== existing.pdfLayout)) {
      throw new RequestError(400, 'PDF 구성을 바꾸려면 원본 PDF를 다시 선택해주세요.');
    }
    if (data.joinSplitPages === true) {
      if (!item.pages?.length || item.pages.length % 2 !== 0 || (item.pdfLayout && item.pdfLayout !== 'spread' && !existing.joinSplitPages)) {
        throw new RequestError(400, '좌우 반쪽이 짝을 이룬 기존 내지에만 복원을 적용할 수 있습니다.');
      }
      item.joinSplitPages = true;
    } else if (data.joinSplitPages === false) delete item.joinSplitPages;
  }
  if (!item.coverImages.front) throw new RequestError(400, '앞표지를 업로드해주세요.');
  if (item.bookForm !== 'cards' && item.pages.some(page => page.blank)) throw new RequestError(400, '제본책으로 바꾸려면 내지 PDF를 등록해주세요.');
  storeConstruction(item, data, assets, addImage);
  if (assets.galleryImages !== undefined) {
    item.galleryImages = imageList(assets.galleryImages === null ? [] : assets.galleryImages,
      existing?.galleryImages || [], prefix, addImage, 'gallery', true);
  }
  applyThumbnail(item, existing, assets, addImage, kind);
  return { item, tree };
}

function checkRevision(existing, data) {
  if ((existing.revision ?? null) !== (data.baseRevision ?? null)) {
    throw new RequestError(409, '다른 창에서 수정한 내용이 있습니다. 목록을 새로 불러온 뒤 다시 수정해주세요.', undefined, 'REVISION_CONFLICT');
  }
}

function contactEmail(value) {
  const email = validText(value, 254, '이메일').replace(/^mailto:/i, '');
  if (email && !/^[A-Za-z0-9.!$'*+=^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(email)) {
    throw new RequestError(400, '이메일 주소를 확인해주세요.');
  }
  return email;
}

function contactLinks(value) {
  if (!Array.isArray(value) || value.length > 30) {
    throw new RequestError(400, '연락처 링크는 30개까지 등록할 수 있습니다.');
  }
  return value.map(link => {
    if (!isRecord(link)) throw new RequestError(400, '연락처 링크를 확인해주세요.');
    const label = validText(link.label, 100, '링크 이름', true);
    const address = validText(link.url, 2048, '링크 주소', true);
    if (/[\u0000-\u001f\u007f]/.test(link.url)) {
      throw new RequestError(400, '연락처 링크에 제어 문자를 사용할 수 없습니다.');
    }
    let url;
    try {
      url = new URL(address);
    } catch {
      throw new RequestError(400, '연락처 링크는 http 또는 https 주소로 입력해주세요.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        /[\u0000-\u0020\u007f]/.test(address)) {
      throw new RequestError(400, '연락처 링크는 http 또는 https 주소로 입력해주세요.');
    }
    return { label, url: url.href };
  });
}

async function saveSite(request, env) {
  const data = await readJson(request, 128 * 1024);
  const registrationId = mutationId(data.registrationId);
  let prepared;
  return mutateCatalog(env, catalog => {
    const existing = catalog.site;
    if (existing.lastMutationId === registrationId) {
      return { unchanged: true, response: { site: existing } };
    }
    checkRevision(existing, data);
    if (!prepared) {
      for (const field of ['about', 'contact', 'assets']) {
        if (data[field] !== undefined && !isRecord(data[field])) {
          throw new RequestError(400, '사이트 설정을 확인해주세요.');
        }
      }
      const site = {
        ...existing, about: { ...existing.about }, contact: { ...existing.contact },
        revision: crypto.randomUUID(), lastMutationId: registrationId,
      };
      const translations = englishTranslations(data.translations, existing.translations, 'site');
      if (translations !== undefined) site.translations = translations;
      if (data.title !== undefined) site.title = validText(data.title, 160, '사이트 제목');
      if (data.projectTags !== undefined) site.projectTags = projectTags(data.projectTags);
      for (const [field, limit] of [['heading', 200], ['text', 12000]]) {
        if (data.about?.[field] !== undefined) site.about[field] = validText(data.about[field], limit, '소개');
      }
      if (data.contact?.text !== undefined) site.contact.text = validText(data.contact.text, 6000, '연락처 소개');
      if (data.contact?.email !== undefined) site.contact.email = contactEmail(data.contact.email);
      if (data.contact?.links !== undefined) site.contact.links = contactLinks(data.contact.links);
      const tree = [];
      if (data.assets?.about === null) delete site.about.imageSrc;
      else if (data.assets?.about !== undefined) {
        const image = validAsset(data.assets.about);
        site.about.imageSrc = 'assets/site/' + registrationId + '/about.' + image.ext;
        tree.push({ path: 'dist/' + site.about.imageSrc, mode: '100644', type: 'blob', sha: image.sha });
      }
      prepared = { site, tree };
    }
    checkRemovedTags(catalog, prepared.site.projectTags);
    catalog.site = prepared.site;
    return {
      response: { site: prepared.site }, tree: [...prepared.tree],
      cleanup: { kind: 'site' }, message: 'Update site settings',
    };
  });
}

async function cleanupAssets(git, baseTree, id, kind, catalog) {
  const prefix = kind === 'site' ? 'dist/assets/site/'
    : 'dist/assets/' + (kind === 'book' ? 'books/' : 'projects/') + itemId(id) + '/';
  const response = await github(git, '/git/trees/' + baseTree + '?recursive=1');
  const saved = await response.json();
  if (saved.truncated || !Array.isArray(saved.tree)) {
    throw new RequestError(502, '저장소의 전체 파일 목록을 읽을 수 없습니다. 다시 시도해주세요.');
  }
  const retained = new Set(allReferences(catalog).map(path => 'dist/' + path));
  return saved.tree.filter(entry => entry.type === 'blob' && entry.path.startsWith(prefix) && !retained.has(entry.path))
    .map(entry => ({ path: entry.path, mode: '100644', type: 'blob', sha: null }));
}

async function mutateCatalog(env, transform) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { git, head, catalog } = await currentSnapshot(env);
    const previousAssets = env.LOCAL_STORE ? allReferences(catalog) : null;
    const result = transform(catalog);
    if (result.unchanged) return json({ ...result.response, commit: head });
    catalog.demo = false;
    enforceAssetLimit(catalog);
    if (env.LOCAL_STORE) {
      const retained = new Set(allReferences(catalog));
      const removed = previousAssets.filter(path => !retained.has(path));
      const commit = await env.LOCAL_STORE.publish(head, catalog, result.tree || [], removed);
      if (commit) return json({ ...result.response, commit }, result.created ? 201 : 200);
      continue;
    }
    const baseCommit = await github(git, '/git/commits/' + head).then(response => response.json());
    let tree = result.tree || [];
    if (result.cleanup) {
      tree = [...tree, ...await cleanupAssets(git, baseCommit.tree.sha, result.cleanup.id, result.cleanup.kind, catalog)];
    }
    tree.push({ path: catalogPath, mode: '100644', type: 'blob', content: JSON.stringify(catalog, null, 2) + '\n' });
    const newTree = await github(git, '/git/trees', {
      method: 'POST', body: { base_tree: baseCommit.tree.sha, tree },
    }).then(response => response.json());
    const commit = await github(git, '/git/commits', {
      method: 'POST', body: { message: result.message.replace(/[\r\n]+/g, ' '), tree: newTree.sha, parents: [head] },
    }).then(response => response.json());
    const update = await github(git, '/git/refs/' + git.ref, {
      method: 'PATCH', body: { sha: commit.sha, force: false }, allowed: [409, 422],
    });
    if (update.ok) return json({ ...result.response, commit: commit.sha }, result.created ? 201 : 200);
    if (await branchHead(git) === head) {
      throw new RequestError(409, '브랜치 쓰기 제한을 확인하고 다시 시도해주세요.');
    }
  }
  throw new RequestError(409, '다른 변경사항이 게시 중입니다. 잠시 후 다시 시도해주세요.');
}

async function saveItem(request, env, kind) {
  const data = await readJson(request, kind === 'project' ? 4 * 1024 * 1024 : 1024 * 1024);
  const registrationId = mutationId(data.registrationId);
  if (data.id !== undefined) itemId(data.id);
  let prepared;
  return mutateCatalog(env, catalog => {
    const collection = kind === 'book' ? 'books' : 'projects';
    const entries = catalog[collection];
    const existing = data.id === undefined ? null : entries.find(item => item.id === data.id);
    if (data.id !== undefined && !existing) throw new RequestError(404, '작품을 찾을 수 없습니다.');
    const replay = existing?.lastMutationId === registrationId ? existing : data.id === undefined
      ? entries.find(item => item.id.endsWith('-' + registrationId)) : null;
    if (replay) return { unchanged: true, response: { [kind]: replay } };
    if (existing) checkRevision(existing, data);
    const retrying = Boolean(prepared);
    if (!prepared) prepared = buildItem(data, existing, kind, registrationId);
    const { item, tree } = prepared;
    assignTagIds(item, data.tagIds, existing, kind, catalog.site.projectTags, retrying);
    const otherItems = [...catalog.books, ...catalog.projects].filter(entry => entry.id !== existing?.id);
    if (otherItems.some(entry => entry.id === item.id)) throw new RequestError(409, '이미 사용 중인 작품 번호입니다.');
    catalog[collection] = existing ? entries.map(entry => entry.id === item.id ? item : entry) : [...entries, item];
    if (!existing) catalog.order.push(item.id);
    return {
      response: { [kind]: item }, tree: [...tree], created: !existing,
      cleanup: existing ? { id: existing.id, kind } : null,
      message: (existing ? 'Update ' : 'Register ') + kind + ': ' + item.title,
    };
  });
}

async function deleteItem(request, env) {
  const data = await readJson(request, 2048);
  const id = itemId(data.id);
  if (!['book', 'project'].includes(data.kind)) throw new RequestError(400, '작품 종류를 확인해주세요.');
  return mutateCatalog(env, catalog => {
    const collection = data.kind === 'book' ? 'books' : 'projects';
    const existing = catalog[collection].find(item => item.id === id);
    if (!existing) return { unchanged: true, response: { ok: true, id } };
    checkRevision(existing, data);
    catalog[collection] = catalog[collection].filter(item => item.id !== id);
    catalog.order = catalog.order.filter(entry => entry !== id);
    return { response: { ok: true, id }, cleanup: { id, kind: data.kind }, message: 'Delete ' + data.kind + ': ' + existing.title };
  });
}

async function reorderItems(request, env) {
  const data = await readJson(request, 4 * 1024 * 1024);
  if (!Array.isArray(data.order) || data.order.some(id => typeof id !== 'string')) {
    throw new RequestError(400, '작품 순서를 확인해주세요.');
  }
  if (data.baseOrder !== undefined &&
      (!Array.isArray(data.baseOrder) || data.baseOrder.some(id => typeof id !== 'string'))) {
    throw new RequestError(400, '기존 작품 순서를 확인해주세요.');
  }
  let initialOrder;
  return mutateCatalog(env, catalog => {
    const previous = JSON.stringify(catalog.order);
    if (data.baseOrder !== undefined && JSON.stringify(data.order) !== previous &&
        JSON.stringify(data.baseOrder) !== previous) {
      throw new RequestError(409, '다른 창에서 작품 순서를 변경했습니다. 목록을 새로 불러와주세요.');
    }
    if (initialOrder !== undefined && initialOrder !== previous) {
      throw new RequestError(409, '다른 창에서 작품 순서를 변경했습니다. 목록을 새로 불러와주세요.');
    }
    initialOrder = previous;
    const ids = new Set([...catalog.books, ...catalog.projects].map(item => item.id));
    if (data.order.length !== ids.size || new Set(data.order).size !== ids.size || data.order.some(id => !ids.has(id))) {
      throw new RequestError(409, '작품 목록이 변경되었습니다. 모든 작품의 순서를 다시 확인해주세요.');
    }
    if (JSON.stringify(data.order) === previous) return { unchanged: true, response: { order: catalog.order } };
    catalog.order = data.order;
    return { response: { order: catalog.order }, message: 'Reorder portfolio' };
  });
}

function partialVideo(bytes, range, headers) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  const length = bytes.byteLength;
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), length - 1) : length - 1;
    if (start <= end && start < length) {
      return new Response(bytes.subarray(start, end + 1), {
        status: 206,
        headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${length}` },
      });
    }
  }
  return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': 'bytes */' + length } });
}

async function previewAsset(request, env, url) {
  const path = url.searchParams.get('path')?.replace(/^\.\//, '');
  const video = isProjectVideoPath(path);
  if (!video && (!path || !/^assets\/(?:books|projects|site)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|webp)$/.test(path))) {
    throw new RequestError(400, '미리볼 파일 경로를 확인해주세요.');
  }
  const { git, head, catalog } = await currentSnapshot(env);
  if (!allReferences(catalog).includes(path)) throw new RequestError(404, '파일을 찾을 수 없습니다.');
  const extension = path.split('.').at(-1).toLowerCase();
  const headers = { ...securityHeaders, 'Content-Type': video ? 'video/' + extension : 'image/' + (extension === 'jpg' ? 'jpeg' : extension) };
  if (video) headers['Accept-Ranges'] = 'bytes';
  const range = video ? request.headers.get('Range') : null;
  if (env.LOCAL_STORE) {
    const bytes = await env.LOCAL_STORE.readAsset(path);
    return range ? partialVideo(bytes, range, headers) : new Response(bytes, { headers });
  }
  const response = await github(git, '/contents/dist/' + path + '?ref=' + encodeURIComponent(head), {
    accept: 'application/vnd.github.raw+json', range: /^bytes=\d*-\d*$/i.test(range ?? '') ? range : undefined, allowed: [416],
  });
  if (range && response.status === 200) {
    // Some GitHub Contents responses ignore Range. Satisfy media seeking in the browser.
    return partialVideo(new Uint8Array(await response.arrayBuffer()), range, headers);
  }
  for (const name of ['Content-Length', 'Content-Range']) {
    if (response.headers.has(name)) headers[name] = response.headers.get(name);
  }
  return new Response(response.body, { status: response.status, headers });
}

const apiMethods = new Map([
  ['/api/login', ['POST']],
  ['/api/logout', ['POST']],
  ['/api/catalog', ['GET']],
  ['/api/preview', ['GET']],
  ['/api/assets', ['POST']],
  ['/api/books', ['GET', 'POST']],
  ['/api/projects', ['POST']],
  ['/api/site', ['POST']],
  ['/api/delete', ['POST']],
  ['/api/order', ['POST']],
]);

async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === 'POST') requireSameOrigin(request, url);
  const methods = apiMethods.get(pathname);
  if (methods && !methods.includes(request.method)) {
    return json({ error: '지원하지 않는 요청 방식입니다.' }, 405, { Allow: methods.join(', ') });
  }

  if (pathname === '/api/login' && request.method === 'POST') return login(request, env);
  if (pathname === '/api/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookieValue('', 0) });
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    if (['/', '/admin', '/admin/'].includes(pathname)) {
      return staticAsset(url, request, env, await hasSession(request, env) ? '/index.html' : '/login.html');
    }
    if (['/style.css', '/login.js', '/favicon.ico'].includes(pathname)) {
      return staticAsset(url, request, env, pathname);
    }
  }

  if (!await hasSession(request, env)) throw new RequestError(401, '관리자 로그인이 필요합니다.');
  if ((pathname === '/api/books' || pathname === '/api/catalog') && request.method === 'GET') {
    const catalog = env.LOCAL_STORE ? (await currentSnapshot(env)).catalog : await readCatalog(await checkedRepository(env));
    return json(pathname === '/api/books' ? { books: catalog.books } : catalog);
  }
  if (pathname === '/api/preview' && request.method === 'GET') return previewAsset(request, env, url);
  if (pathname === '/api/assets' && request.method === 'POST') return uploadAsset(request, env);
  if (pathname === '/api/books' && request.method === 'POST') return saveItem(request, env, 'book');
  if (pathname === '/api/projects' && request.method === 'POST') return saveItem(request, env, 'project');
  if (pathname === '/api/site' && request.method === 'POST') return saveSite(request, env);
  if (pathname === '/api/delete' && request.method === 'POST') return deleteItem(request, env);
  if (pathname === '/api/order' && request.method === 'POST') return reorderItems(request, env);
  if ((request.method === 'GET' || request.method === 'HEAD') &&
      (['/admin.js', '/draft-store.js', '/upload-request.js', '/site-settings.js', '/project-tags.js', '/project-media.js', '/media-order.js', '/image-encoding.js', '/pdf-layout.js', '/mockup-controls.js', '/mockup-preview.js', '/mockup-preview.css', '/book-construction.js', '/card-editor.js'].includes(pathname) || pathname.startsWith('/vendor/'))) {
    return staticAsset(url, request, env, pathname);
  }
  throw new RequestError(404, '요청한 페이지를 찾을 수 없습니다.');
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof RequestError) {
        return json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) },
          error.status, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
      }
      return json({ error: '서버에서 오류가 발생했습니다. 다시 시도해주세요.' }, 500);
    }
  },
};
