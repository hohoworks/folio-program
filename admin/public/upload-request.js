export class APIError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorMessage(cause) {
  return cause instanceof TypeError
    ? '연결 상태를 확인한 뒤 다시 시도해주세요. 저장한 진행 상황에서 이어갈 수 있습니다.'
    : cause.message;
}

async function fetchJSON(path, options) {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal.reason);
  options.signal?.throwIfAborted();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new TypeError('요청 시간이 초과되었습니다.')), 120000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    const result = response.status === 204 ? {} : await response.json().catch(() => null);
    return { response, result };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

async function wait(seconds, signal, onWait) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    onWait?.(Math.ceil((end - Date.now()) / 1000));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(finish, Math.min(1000, end - Date.now()));
      function finish() {
        signal?.removeEventListener('abort', abort);
        resolve();
      }
      function abort() {
        clearTimeout(timeout);
        reject(signal.reason);
      }
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

export async function request(path, { onResponse, ...options } = {}, onWait) {
  const { signal } = options;
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    let result;
    try {
      ({ response, result } = await fetchJSON(path, options));
    } catch (cause) {
      if (signal?.aborted || attempt === 3) throw cause;
      await wait(2 ** attempt, signal, seconds => onWait?.(seconds, false));
      continue;
    }
    if (response.ok && result) {
      onResponse?.(response);
      return result;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = response.headers.get('Retry-After');
      const headerDelay = retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter)
        : retryAfter ? (Date.parse(retryAfter) - Date.now()) / 1000 : 0;
      const seconds = Math.max(1, Math.ceil(headerDelay || result?.retryAfter || 2 ** attempt));
      await wait(seconds, signal, remaining => onWait?.(remaining, response.status === 429));
      continue;
    }
    const message = response.status === 401
      ? '접속 시간이 지났습니다. 진행 상황이 저장되었습니다. 다시 로그인한 뒤 이어서 저장해주세요.'
      : result?.error || '저장하지 못했습니다. 다시 시도해주세요.';
    throw new APIError(message, response.status, result?.code);
  }
}

export function postJson(path, data, signal, onWait) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  }, onWait);
}

export function uploadAsset(blob, signal, onWait) {
  return request('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
    signal,
  }, onWait);
}

export { uploadAsset as uploadImage };
