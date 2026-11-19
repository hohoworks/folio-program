const databaseName = 'folio-editor';
function draftKey(key) {
  return key === 'current' ? 'folio-editor-draft-v1' : 'folio-editor-' + key + '-draft-v1';
}
let database;

function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts');
      request.result.createObjectStore('files');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('브라우저 저장소가 잠겨 있습니다.'));
  });
  return database;
}

async function operate(store, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadDraft(key = 'current') {
  let backup;
  try {
    backup = JSON.parse(localStorage.getItem(draftKey(key)));
  } catch {}
  try {
    const draft = await operate('drafts', 'readonly', store => store.get(key));
    if (draft && (!backup || draft.updated > backup.updated)) return draft;
  } catch {}
  return backup?.cleared ? null : backup;
}

export async function saveDraft(draft, key = 'current') {
  let saved = false;
  try {
    localStorage.setItem(draftKey(key), JSON.stringify(draft));
    saved = true;
  } catch {}
  try {
    await operate('drafts', 'readwrite', store => store.put(draft, key));
    return { saved: true, filesSupported: true };
  } catch {
    return { saved, filesSupported: false };
  }
}

export async function saveFile(key, file) {
  try {
    await operate('files', 'readwrite', store => store.put(file, key));
    return true;
  } catch {
    return false;
  }
}

export async function loadFile(key) {
  try {
    return await operate('files', 'readonly', store => store.get(key));
  } catch {
    return null;
  }
}

export async function deleteFile(key) {
  try {
    await operate('files', 'readwrite', store => store.delete(key));
  } catch {}
}

export async function clearDraft(key = 'current') {
  const previous = await loadDraft(key);
  try {
    localStorage.setItem(draftKey(key), JSON.stringify({ cleared: true, updated: Date.now() }));
  } catch {}
  await Promise.allSettled([
    operate('drafts', 'readwrite', store => store.delete(key)),
    ...Object.values(previous?.files || {}).map(file => deleteFile(file.storageKey)),
  ]);
}

export async function fileSignature(file) {
  const hashes = [];
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
    hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-256', chunk)));
  }
  const summary = new Uint8Array(hashes.length * 32 + 8);
  new DataView(summary.buffer).setBigUint64(0, BigInt(file.size));
  hashes.forEach((hash, index) => summary.set(hash, 8 + index * 32));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', summary));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
