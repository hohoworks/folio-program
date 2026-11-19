import { clearDraft, fileSignature, loadDraft, loadFile, saveDraft, saveFile } from '/draft-store.js';
import { errorMessage, postJson, uploadImage } from '/upload-request.js';
import { STOCK_PROJECT_TAGS, idsFor } from './project-tags.js';
import { encodeWebImage, imageTargetBytes } from './image-encoding.js';

const $ = selector => document.querySelector(selector);
const textFields = ['site-title', 'site-title-en', 'about-heading', 'about-heading-en', 'about-text', 'about-text-en', 'contact-text', 'contact-text-en', 'contact-email', 'contact-instagram'];

function instagramHandle(value) {
  let username = value.trim();
  if (!username) return '';
  if (/^https?:\/\//i.test(username) || /^www\./i.test(username) || /^instagram\.com\//i.test(username)) {
    const url = new URL(/^https?:\/\//i.test(username) ? username : 'https://' + username);
    if (!['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase()) ||
        url.username || url.password || url.port ||
        !/^\/[^/]+\/?$/.test(url.pathname)) throw new Error('인스타그램 프로필 주소를 확인해주세요.');
    username = url.pathname.replace(/^\/|\/$/g, '');
  } else username = username.replace(/^@/, '');
  if (!/^(?!\.)(?!.*\.\.)(?!.*\.$)[A-Za-z0-9._]{1,30}$/.test(username)) {
    throw new Error('인스타그램 계정 이름이나 프로필 주소를 확인해주세요.');
  }
  return username;
}

function isInstagramLink(link) {
  try {
    return /^https?:\/\/(?:www\.)?instagram\.com\//i.test(link.url) && Boolean(instagramHandle(link.url));
  } catch {
    return false;
  }
}

export async function createSiteEditor({ onSaved, onCommitted, onBusy }) {
  let draft = await loadDraft('site');
  if (draft?.metadata) delete draft.metadata['project-sort'];
  let source;
  let savedSite;
  let busy = false;
  let pendingFile = false;
  let persistence = Promise.resolve();
  let dirty = Boolean(draft);
  let generation = 0;
  let usedTagIds = new Set();
  const fields = $('#site-fields');
  const save = $('#site-save');
  const message = $('#site-status');
  const error = $('#site-error');
  const notice = $('#site-draft-notice');

  if (draft?.files?.about) source = await loadFile(draft.files.about.storageKey);

  function fresh(site = {}) {
    const links = site.contact?.links || [];
    const profiles = links.filter(isInstagramLink);
    const instagram = profiles.findLast(link => /^(instagram|인스타그램)$/i.test(link.label?.trim()) ||
      link.label === '@' + instagramHandle(link.url));
    return {
      version: 1, draftId: crypto.randomUUID(), registrationId: crypto.randomUUID(),
      baseRevision: site.revision ?? null,
      metadata: {
        'site-title': site.title || '',
        'about-heading': site.about?.heading || '',
        'about-text': site.about?.text || '',
        'contact-text': site.contact?.text || '',
        'contact-email': site.contact?.email || '',
        'contact-instagram': instagram ? '@' + instagramHandle(instagram.url) : '',
        'site-title-en': site.translations?.en?.title || '',
        'about-heading-en': site.translations?.en?.about?.heading || '',
        'about-text-en': site.translations?.en?.about?.text || '',
        'contact-text-en': site.translations?.en?.contact?.text || '',
      },
      links: links.filter(link => link !== instagram).map(link => ({ ...link, id: crypto.randomUUID() })),
      projectTags: structuredClone(Array.isArray(site.projectTags) ? site.projectTags : STOCK_PROJECT_TAGS),
      savedImage: site.about?.imageSrc || '',
      removeImage: false, files: {}, uploaded: null, commitPayload: null,
    };
  }

  function persist() {
    if (!draft) return Promise.resolve();
    draft.updated = Date.now();
    const snapshot = structuredClone(draft);
    persistence = persistence.catch(() => {}).then(async () => {
      const result = await saveDraft(snapshot, 'site');
      if (!result.saved) notice.textContent = '브라우저 저장소를 사용할 수 없습니다. 이 창에서 계속 작업해주세요.';
    });
    return persistence;
  }

  function update() {
    const disabled = busy || pendingFile || !draft || !savedSite;
    fields.disabled = disabled || Boolean(draft?.commitPayload);
    save.disabled = disabled;
    save.textContent = draft?.commitPayload ? '저장 확인 →' : '저장 →';
    $('#site-reload').disabled = disabled;
    onBusy(busy || pendingFile);
  }

  function read() {
    if (!draft) return;
    for (const id of textFields) draft.metadata[id] = $('#' + id).value;
    draft.removeImage = $('#about-remove').checked;
    draft.registrationId = crypto.randomUUID();
    dirty = true;
  }

  function showImage() {
    const image = $('#about-preview');
    if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
    const original = !draft.files.about && !draft.removeImage && draft.savedImage;
    const url = source ? URL.createObjectURL(source) : original ? '/api/preview?path=' + encodeURIComponent(original) : '';
    if (url) image.src = url;
    else image.removeAttribute('src');
    $('#about-preview-wrap').hidden = !url || draft.removeImage;
    $('#about-remove-row').hidden = !draft.savedImage && !draft.files.about;
    $('#about-image-state').textContent = draft.files.about
      ? draft.files.about.name + (source ? ' · 선택됨' : ' · 같은 원본을 다시 선택해주세요.')
      : draft.savedImage && !draft.removeImage ? '기존 이미지 유지' : '';
  }

  function renderLinks() {
    const list = $('#contact-links');
    list.replaceChildren(...draft.links.map((link, index) => {
      const item = document.createElement('li');
      for (const [field, text, type, max] of [['label', '이름', 'text', 100], ['url', '주소', 'url', 2048]]) {
        const label = document.createElement('label');
        label.textContent = text;
        const input = document.createElement('input');
        input.type = type;
        input.required = true;
        input.maxLength = max;
        input.value = link[field] || '';
        input.setAttribute('aria-label', '링크 ' + (index + 1) + ' ' + text);
        if (field === 'url') {
          input.placeholder = 'https://';
          input.addEventListener('input', () => input.setCustomValidity(''));
        }
        input.addEventListener('input', () => {
          link[field] = input.value;
          draft.registrationId = crypto.randomUUID();
          dirty = true;
          persist();
        });
        label.append(input);
        item.append(label);
      }
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      for (const [label, delta] of [['↑', -1], ['↓', 1], ['제거', 0]]) {
        const button = document.createElement('button');
        button.className = 'text-button';
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-label', '링크 ' + (index + 1) + (delta < 0 ? ' 위로' : delta > 0 ? ' 아래로' : ' 제거'));
        button.disabled = delta < 0 && index === 0 || delta > 0 && index === draft.links.length - 1;
        button.addEventListener('click', () => {
          const [current] = draft.links.splice(index, 1);
          if (delta) draft.links.splice(index + delta, 0, current);
          draft.registrationId = crypto.randomUUID();
          dirty = true;
          persist();
          renderLinks();
        });
        actions.append(button);
      }
      item.append(actions);
      return item;
    }));
  }

  function renderProjectTags() {
    const tags = draft.projectTags || [];
    $('#project-tags').replaceChildren(...tags.map((tag, index) => {
      const item = document.createElement('li');
      for (const [key, text] of [['ko', '이름 · KO'], ['en', '이름 · EN']]) {
        const label = document.createElement('label');
        label.textContent = text;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = tag[key] || '';
        input.maxLength = 80;
        input.required = key === 'ko';
        input.setAttribute('aria-label', '태그 ' + (index + 1) + ' ' + text);
        if (key === 'en') input.lang = 'en';
        input.addEventListener('input', () => {
          tag[key] = input.value;
          draft.registrationId = crypto.randomUUID();
          dirty = true;
          persist();
        });
        label.append(input);
        item.append(label);
      }
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      for (const [text, delta] of [['↑', -1], ['↓', 1], ['제거', 0]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-button';
        button.textContent = text;
        button.setAttribute('aria-label', '태그 ' + (index + 1) + (delta < 0 ? ' 위로' : delta > 0 ? ' 아래로' : ' 제거'));
        button.disabled = delta < 0 && index === 0 || delta > 0 && index === tags.length - 1;
        button.addEventListener('click', () => {
          if (!delta && usedTagIds.has(tag.id)) {
            error.textContent = '“' + tag.ko + '” 태그를 사용하는 작업에서 선택을 해제한 뒤 제거해주세요.';
            return;
          }
          const [current] = tags.splice(index, 1);
          if (delta) tags.splice(index + delta, 0, current);
          draft.registrationId = crypto.randomUUID();
          dirty = true;
          persist();
          renderProjectTags();
        });
        actions.append(button);
      }
      item.append(actions);
      return item;
    }));
  }

  function write() {
    for (const id of textFields) $('#' + id).value = draft.metadata[id] || '';
    $('#about-remove').checked = draft.removeImage;
    $('#about-image').value = '';
    renderLinks();
    renderProjectTags();
    showImage();
    update();
  }

  $('#site-form').addEventListener('input', event => {
    if (event.target.type === 'file' || event.target.closest('#contact-links, #project-tags')) return;
    read();
    if (event.target.id === 'contact-instagram') event.target.setCustomValidity('');
    persist();
    if (event.target.id === 'about-remove') showImage();
  });

  $('#add-contact-link').addEventListener('click', () => {
    if (!draft || busy || pendingFile) return;
    if (draft.links.length >= 30) {
      error.textContent = '연락처 링크는 30개까지 추가할 수 있습니다.';
      return;
    }
    draft.links.push({ id: crypto.randomUUID(), label: '', url: '' });
    draft.registrationId = crypto.randomUUID();
    dirty = true;
    persist();
    renderLinks();
    $('#contact-links li:last-child input').focus();
  });

  $('#add-project-tag').addEventListener('click', () => {
    if (!draft || busy || pendingFile) return;
    if (draft.projectTags.length >= 100) {
      error.textContent = '프로젝트 태그는 100개까지 추가할 수 있습니다.';
      return;
    }
    draft.projectTags.push({ id: 'tag-' + crypto.randomUUID(), ko: '', en: '' });
    draft.registrationId = crypto.randomUUID();
    dirty = true;
    persist();
    renderProjectTags();
    $('#project-tags li:last-child input').focus();
  });

  $('#about-image').addEventListener('change', async () => {
    const file = $('#about-image').files[0];
    if (!file || !draft || busy || pendingFile) return;
    const current = ++generation;
    pendingFile = true;
    error.textContent = '';
    update();
    try {
      await imageBlob(file);
      const signature = await fileSignature(file);
      if (current !== generation) return;
      if (draft.files.about?.signature !== signature) {
        draft.uploaded = null;
        draft.registrationId = crypto.randomUUID();
      }
      draft.files.about = {
        storageKey: draft.draftId + ':about',
        signature, name: file.name, size: file.size, type: file.type,
      };
      source = file;
      draft.removeImage = false;
      $('#about-remove').checked = false;
      dirty = true;
      const stored = await saveFile(draft.files.about.storageKey, file);
      await persist();
      if (!stored) notice.textContent = '진행 상황을 저장했습니다. 다시 접속하면 이미지 원본을 재선택해주세요.';
      showImage();
    } catch (cause) {
      error.textContent = errorMessage(cause);
    } finally {
      pendingFile = false;
      update();
    }
  });

  $('#site-reload').addEventListener('click', async () => {
    if (!savedSite || busy || pendingFile) return;
    if (dirty && !window.confirm('현재 설정의 임시 수정을 비우고 최신 내용을 불러올까요?')) return;
    await onSaved();
    await persistence.catch(() => {});
    await clearDraft('site');
    source = null;
    dirty = false;
    draft = fresh(savedSite);
    notice.textContent = '';
    error.textContent = '';
    message.textContent = '최신 설정을 불러왔습니다.';
    write();
  });

  $('#site-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!draft || busy || pendingFile) return;
    error.textContent = '';
    $('#site-relogin').hidden = true;
    if (!draft.commitPayload) {
      read();
      const inputs = [...$('#contact-links').querySelectorAll('input[type="url"]')];
      for (const input of inputs) {
        try {
          const url = new URL(input.value);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        } catch {
          input.setCustomValidity('http:// 또는 https://로 시작하는 주소를 입력해주세요.');
          input.reportValidity();
          return;
        }
      }
      try {
        const instagram = instagramHandle(draft.metadata['contact-instagram'] || '');
        if (draft.links.length + Number(Boolean(instagram)) > 30) throw new Error('추가 링크와 인스타그램은 합쳐서 30개까지 등록할 수 있습니다.');
      } catch (cause) {
        $('#contact-instagram').setCustomValidity(cause.message);
        $('#contact-instagram').reportValidity();
        return;
      }
    }
    busy = true;
    message.textContent = '설정 저장 중…';
    update();
    try {
      await persist();
      if (!draft.commitPayload) {
        const meta = draft.metadata;
        const assets = {};
        if (draft.removeImage) assets.about = null;
        else if (draft.files.about) {
          if (draft.uploaded?.signature !== draft.files.about.signature) {
            if (!source) throw new Error('About 이미지 원본을 다시 선택해주세요.');
            const blob = await imageBlob(source);
            const asset = await uploadImage(blob, undefined, waitMessage);
            draft.uploaded = { asset, signature: draft.files.about.signature };
            await persist();
          }
          assets.about = draft.uploaded.asset;
        }
        const instagram = instagramHandle(meta['contact-instagram'] || '');
        draft.commitPayload = {
          registrationId: draft.registrationId,
          baseRevision: draft.baseRevision,
          title: meta['site-title'].trim(),
          about: { heading: meta['about-heading'].trim(), text: meta['about-text'].trim() },
          contact: {
            text: meta['contact-text'].trim(), email: meta['contact-email'].trim(),
            links: [
              ...draft.links.map(link => ({ label: link.label.trim(), url: link.url.trim() })),
              ...(instagram ? [{
                label: '@' + instagram, url: 'https://www.instagram.com/' + instagram + '/',
              }] : []),
            ],
          },
          assets,
          projectTags: draft.projectTags.map(tag => ({ id: tag.id, ko: tag.ko.trim(), en: tag.en.trim() })),
          translations: {
            en: {
              title: meta['site-title-en']?.trim() || '',
              about: { heading: meta['about-heading-en']?.trim() || '', text: meta['about-text-en']?.trim() || '' },
              contact: { text: meta['contact-text-en']?.trim() || '' },
            },
          },
        };
        await persist();
      }
      const { site } = await postJson('/api/site', draft.commitPayload, undefined, waitMessage);
      savedSite = site;
      onCommitted(site);
      await persistence.catch(() => {});
      await clearDraft('site');
      source = null;
      dirty = false;
      draft = fresh(site);
      write();
      notice.textContent = '';
      message.textContent = '사이트 설정을 저장했습니다.';
      await onSaved();
    } catch (cause) {
      if ([400, 409, 413, 415, 422].includes(cause.status)) {
        draft.commitPayload = null;
        draft.registrationId = crypto.randomUUID();
      }
      await persist();
      error.textContent = errorMessage(cause);
      message.textContent = draft.commitPayload ? '저장 확인을 누르면 같은 요청을 다시 확인합니다.' : '';
      $('#site-relogin').hidden = cause.status !== 401;
      if (cause.status === 409) {
        await onSaved();
        message.textContent = cause.code === 'TAG_IN_USE'
          ? '작업 관리에서 해당 태그 선택을 해제한 뒤 다시 저장해주세요.'
          : '최신 내용 불러오기를 눌러 다른 창에서 저장한 내용을 확인해주세요. 현재 입력은 임시 저장했습니다.';
      }
    } finally {
      busy = false;
      update();
    }
  });

  function waitMessage(seconds, limited) {
    message.textContent = (limited ? '요청이 많습니다. ' : '연결을 다시 시도합니다. ') + seconds + '초 후 이어갑니다.';
  }

  if (draft) {
    notice.textContent = '사이트 설정의 임시 수정을 불러왔습니다.';
    write();
  }

  return {
    setSite(site, works = []) {
      savedSite = site;
      const savedTags = Array.isArray(site.projectTags) ? site.projectTags : STOCK_PROJECT_TAGS;
      usedTagIds = new Set(works.flatMap(work => idsFor(work, work.kind, savedTags)));
      if (draft) {
        if (!Array.isArray(draft.projectTags)) {
          draft.projectTags = structuredClone(savedTags);
          renderProjectTags();
        }
        const english = site.translations?.en || {};
        const defaults = {
          'site-title-en': english.title,
          'about-heading-en': english.about?.heading,
          'about-text-en': english.about?.text,
          'contact-text-en': english.contact?.text,
        };
        for (const [id, value] of Object.entries(defaults)) {
          if (draft.metadata[id] === undefined) {
            draft.metadata[id] = value || '';
            $('#' + id).value = value || '';
          }
        }
      }
      if (!draft || !dirty && !busy) {
        draft = fresh(site);
        write();
      }
      update();
    },
    async persist() {
      if (draft && dirty) return persist();
    },
  };
}

async function imageBlob(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('PNG, JPG, WebP 이미지를 선택해주세요.');
  }
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.size <= imageTargetBytes) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    try {
      return await encodeWebImage(canvas);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
