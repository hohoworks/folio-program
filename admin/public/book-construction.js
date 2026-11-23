import { leafDimensions, validLeafLayout, validCoverStock, validSaddleSections } from './vendor/mockup/book-format.js';

export const cutFaces = { fore: '책배', head: '머리', tail: '꼬리' };
const $ = id => document.getElementById(id);
const paper = '#efede4';
const number = input => input.value === '' ? undefined : input.valueAsNumber;
const pair = (a, b) => a == null && b == null ? undefined : [a, b];
const imageAccept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

function show(group, visible) {
  group.hidden = !visible;
  if ('disabled' in group) group.disabled = !visible;
}
function numberField(title, key, value, options = {}) {
  const label = document.createElement('label');
  label.textContent = title;
  const input = document.createElement('input');
  Object.assign(input, { type: 'number', step: 'any', ...options, value: value ?? '' });
  input.dataset.key = key;
  label.append(input);
  return label;
}
function colorField(title, key, value) {
  const label = document.createElement('label');
  label.textContent = title;
  const input = document.createElement('input');
  Object.assign(input, { type: 'color', value: value || paper });
  input.dataset.key = key;
  label.append(input);
  return label;
}
function removeButton(row, notify) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.textContent = '삭제';
  button.addEventListener('click', () => { row.remove(); notify(); });
  return button;
}
function makeRow(listId, title) {
  const row = document.createElement('fieldset');
  row.className = 'construction-row';
  const legend = document.createElement('legend');
  legend.textContent = title;
  row.append(legend);
  $(listId).append(row);
  return row;
}

export function createConstructionEditor() {
  const notify = () => $('mockup-details').dispatchEvent(new Event('change', { bubbles: true }));
  function appendBand(value = {}) {
    const row = makeRow('edge-bands', '색지 구간');
    row.append(numberField('시작 쪽', 'start', value.start ?? 1, { min: 1, max: 1000, step: 1, required: true }),
      numberField('끝 쪽', 'end', value.end ?? value.start ?? 1, { min: 1, max: 1000, step: 1, required: true }),
      colorField('종이 색', 'color', value.color), removeButton(row, notify));
  }
  const spareLayers = { card: [], cover: [] };
  function appendLayer(kind, color = paper, thickness = .22) {
    const row = makeRow(kind + '-layers', '합지 층');
    row.append(colorField('층 색', 'color', color),
      numberField('층 두께 (mm)', 'thickness', thickness, { min: 0.01, max: 20, required: true }),
      removeButton(row, notify));
  }
  function resizeLayers(kind, count) {
    const list = $(kind + '-layers');
    while (list.children.length > count) spareLayers[kind].push(list.removeChild(list.lastElementChild));
    while (list.children.length < count) {
      const row = spareLayers[kind].pop();
      if (row) list.append(row);
      else appendLayer(kind);
    }
  }
  function writeLayers(kind, stock, defaults) {
    spareLayers[kind] = [];
    $(kind + '-layers').replaceChildren();
    (stock?.layers ?? defaults).forEach((color, i) => appendLayer(kind, color, stock?.layerThicknessMm?.[i]));
  }
  function readStock(kind, measured) {
    const rows = readRows(kind + '-layers');
    return { layers: rows.map(row => row.color),
      ...(measured && { layerThicknessMm: rows.map(row => row.thickness ?? null) }) };
  }
  function drawSection(kind) {
    const measured = kind === 'cover' || $('card-thickness-mode').value === 'measured';
    const { layers, layerThicknessMm } = readStock(kind, measured);
    const weights = layerThicknessMm ?? layers.map(() => 1);
    const valid = weights.every(mm => Number.isFinite(mm) && mm >= .01 && mm <= 20);
    const section = $(kind + '-section-preview');
    section.replaceChildren();
    section.hidden = !valid;
    if (valid) layers.forEach((color, i) => {
      const ply = document.createElement('span');
      ply.style.backgroundColor = color;
      ply.style.flexGrow = weights[i];
      section.append(ply);
    });
    const label = kind === 'cover' ? '표지 한 장' : '카드 한 장';
    const total = weights.reduce((sum, mm) => sum + mm, 0);
    $(kind + '-thickness-summary').textContent = label + ' 단면 · ' + layers.length + '층' +
      (measured && valid ? ' · 총 ' + Number(total.toFixed(3)) + ' mm' : '');
  }
  function updateLayers(kind, measured) {
    const list = $(kind + '-layers');
    const count = list.children.length;
    $(kind + '-layer-count').value = count;
    $('add-' + kind + '-layer').disabled = count >= 16;
    Array.from(list.children).forEach((row, i) => {
      row.querySelector('legend').textContent = (i + 1) + '층';
      row.querySelector('button').disabled = count <= 1;
      const input = row.querySelector('[data-key="thickness"]');
      input.disabled = !measured;
      input.parentElement.hidden = !measured;
    });
    drawSection(kind);
  }
  for (const kind of ['card', 'cover']) {
    const count = $(kind + '-layer-count');
    for (let n = 1; n <= 16; n++) count.add(new Option(n + '층', n));
    count.addEventListener('change', () => resizeLayers(kind, Number(count.value)));
    $('add-' + kind + '-layer').addEventListener('click', () => {
      resizeLayers(kind, Math.min(16, $(kind + '-layers').children.length + 1));
      notify();
    });
    $(kind + '-layers').addEventListener('input', () => drawSection(kind));
  }
  let bookPages = 0;
  const sections = $('saddle-section-list');
  function appendSection(value = {}) {
    const row = makeRow(sections.id, '소책자');
    row.append(numberField('쪽수', 'pages', value.pages, { min: 1, max: 1000, step: 1, required: true }),
      numberField('가로 (mm)', 'width', value.sizeMm?.[0], { min: .01, max: 5000, placeholder: '기본 판형' }),
      numberField('세로 (mm)', 'height', value.sizeMm?.[1], { min: .01, max: 5000, placeholder: '기본 판형' }));
    const colorMode = document.createElement('label');
    colorMode.className = 'check-label';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = !!value.color;
    enabled.dataset.sectionColor = '';
    colorMode.append(enabled, ' 표지·등 색 지정');
    row.append(colorMode, colorField('표지·등 색', 'color', value.color));
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    for (const [direction, label] of [['up', '위로'], ['down', '아래로']]) {
      const move = document.createElement('button');
      move.type = 'button'; move.className = 'text-button'; move.textContent = label; move.dataset.move = direction;
      move.addEventListener('click', () => {
        if (direction === 'up' && row.previousElementSibling) sections.insertBefore(row, row.previousElementSibling);
        if (direction === 'down' && row.nextElementSibling) sections.insertBefore(row.nextElementSibling, row);
        notify();
        move.focus();
      });
      actions.append(move);
    }
    actions.append(removeButton(row, notify));
    row.append(actions);
  }
  function readSections() {
    if (!$('saddle-sections-enabled').checked) return null;
    return readRows(sections.id).map(({ pages, width, height, color }, i) => ({
      pages: pages ?? null,
      ...(width != null || height != null ? { sizeMm: [width ?? null, height ?? null] } : {}),
      ...(sections.children[i].querySelector('[data-section-color]').checked && { color }),
    }));
  }
  function updateSections(enabled) {
    show($('saddle-section-options'), enabled);
    show($('saddle-section-fields'), enabled && $('saddle-sections-enabled').checked);
    const rows = [...sections.children];
    $('add-saddle-section').disabled = rows.length >= 16;
    rows.forEach((row, i) => {
      row.querySelector('legend').textContent = (i + 1) + '권';
      row.querySelector('[data-move="up"]').disabled = i === 0;
      row.querySelector('[data-move="down"]').disabled = i === rows.length - 1;
      row.querySelector('.item-actions > :last-child').disabled = rows.length <= 1;
      const customColor = row.querySelector('[data-section-color]').checked;
      const ink = row.querySelector('[data-key="color"]');
      ink.disabled = !customColor; ink.parentElement.hidden = !customColor;
    });
  }
  function showSectionTotal(total) {
    bookPages = total || 0;
    const assigned = readRows(sections.id).reduce((sum, row) => sum + (row.pages || 0), 0);
    $('saddle-section-total').textContent = '배정 ' + assigned + '쪽' + (bookPages ? ' / 전체 ' + bookPages + '쪽' : '');
  }
  $('saddle-sections-enabled').addEventListener('change', () => {
    if (!$('saddle-sections-enabled').checked || sections.children.length) return;
    if (bookPages < 2) { appendSection({ pages: bookPages || undefined }); return; }
    const first = bookPages >= 8 ? 4 * Math.floor(bookPages / 8) : Math.floor(bookPages / 2);
    appendSection({ pages: first }); appendSection({ pages: bookPages - first });
  });
  $('add-saddle-section').addEventListener('click', () => {
    if (sections.children.length >= 16) return;
    const used = readRows(sections.id).reduce((sum, row) => sum + (row.pages || 0), 0);
    appendSection({ pages: Math.max(0, bookPages - used) || undefined }); notify();
  });
  function appendRange(value = {}, single = false) {
    const row = makeRow('leaf-ranges', single ? '개별 장' : '장 구간');
    row.append(numberField(single ? '장 번호' : '시작 장', 'from', value.from ?? 1, { min: 1, max: 1000, step: 1, required: true }));
    if (!single) row.append(numberField('끝 장', 'to', value.to ?? 1, { min: 1, max: 1000, step: 1, required: true }));
    for (const [key, caption] of [['widthMm', '가로 (mm)'], ['heightMm', '세로 (mm)']]) {
      row.append(numberField(caption, key, value[key], { min: 0.1, placeholder: '기본값 유지' }));
    }
    if (!single) for (const [i, axis] of ['가로', '세로'].entries()) {
      row.append(numberField('장마다 ' + axis + ' 변화 (mm)', 'step' + i, value.stepMm?.[i], { placeholder: '기본값 유지' }));
    }
    const align = document.createElement('label');
    align.innerHTML = '세로 정렬<select data-key="align"><option value="">기본값 유지</option><option value="top">위쪽</option><option value="center">가운데</option><option value="bottom">아래쪽</option></select>';
    align.querySelector('select').value = value.align || '';
    row.append(align, numberField('아래로 이동 (mm)', 'offsetMm', value.offsetMm, { placeholder: '음수는 위로' }), removeButton(row, notify));
  }
  function readRows(id) {
    return [...$(id).children].map(row => {
      const values = {};
      for (const input of row.querySelectorAll('[data-key]')) {
        const value = input.type === 'number' ? number(input) : input.value;
        if (value !== undefined && value !== '') values[input.dataset.key] = value;
      }
      return values;
    });
  }

  for (const [face, name] of Object.entries(cutFaces)) {
    const group = document.createElement('fieldset');
    group.className = 'mockup-group';
    group.innerHTML = `<legend>${name} 단면</legend>
      <label for="mode-${face}">마감 방식</label><select id="mode-${face}"><option value="natural">기본 종이 · 색지 구간 적용</option><option value="solid">단색</option><option value="scan">스캔 이미지</option></select>
      <fieldset id="solid-${face}" class="material-colors" hidden disabled><label for="color-${face}">단면 색</label><input id="color-${face}" type="color"></fieldset>
      <fieldset id="scan-${face}" hidden disabled><label for="edge-${face}">단면 이미지</label><input type="file" id="edge-${face}" accept="${imageAccept}"><p class="help" id="edge-${face}-state"></p>
      <label for="rotation-${face}">시계 방향 회전</label><select id="rotation-${face}"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select>
      <p class="help">원본의 왼쪽 위를 기준으로 사용할 영역을 백분율로 지정하세요.</p><div class="fields two" id="crop-${face}"></div></fieldset>`;
    $('edge-face-fields').append(group);
    for (const [key, label, initial] of [['x', '왼쪽 시작 (%)', 0], ['y', '위쪽 시작 (%)', 0], ['width', '사용할 가로 (%)', 100], ['height', '사용할 세로 (%)', 100]]) {
      $('crop-' + face).append(numberField(label, key, initial, { min: key === 'x' || key === 'y' ? 0 : 0.01, max: 100, required: true }));
    }
  }
  for (const [id, action] of [['add-edge-band', () => appendBand()],
    ['add-leaf-range', () => appendRange()], ['add-leaf-override', () => appendRange({}, true)]]) {
    $(id).addEventListener('click', () => { action(); notify(); });
  }
  let originalLeaf, originalLeafControls;
  function readLeaves() {
    const source = $('leaf-source').value;
    const ranges = readRows('leaf-ranges').map(({ step0, step1, from, to, ...rest }) => ({
      from, to: to ?? from, ...rest, ...(step0 != null || step1 != null ? { stepMm: [step0 ?? null, step1 ?? null] } : {}),
    }));
    const first = pair(number($('leaf-width')), number($('leaf-height')));
    return source === 'uniform' ? null : {
      source, align: $('leaf-align').value, ranges,
      ...(source === 'custom' && { ...(first && { firstSizeMm: first }), stepMm: [number($('leaf-step-width')) || 0, number($('leaf-step-height')) || 0] }),
    };
  }
  function write(value = {}) {
    const { edgeTreatments = {}, edgeBands = [], cardStock, coverStock, saddleSections, leafLayout = {}, ringPositions } = value;
    $('ring-positions').value = Array.isArray(ringPositions) ? ringPositions.join(', ') : ringPositions || '';
    for (const face of Object.keys(cutFaces)) {
      const edge = edgeTreatments?.[face] || {};
      $('mode-' + face).value = edge.mode || 'natural';
      $('color-' + face).value = edge.color || paper;
      $('rotation-' + face).value = edge.rotation || 0;
      for (const input of $('crop-' + face).querySelectorAll('input')) {
        const key = input.dataset.key;
        input.value = edge.crop?.[key] ?? (['x', 'y'].includes(key) ? 0 : 100);
      }
    }
    $('edge-bands').replaceChildren();
    (edgeBands || []).forEach(appendBand);
    $('card-corner').value = cardStock?.cornerRadiusMm ?? 0;
    $('card-thickness-mode').value = cardStock?.layerThicknessMm ? 'measured' : 'auto';
    $('card-thumbnail-mode').value = cardStock?.thumbnailMode || '';
    $('card-thumbnail-card').value = cardStock?.thumbnailCard ?? 1;
    writeLayers('card', cardStock, [paper]);
    $('saddle-sections-enabled').checked = !!saddleSections;
    sections.replaceChildren();
    (saddleSections || []).forEach(appendSection);
    $('cover-stock-enabled').checked = !!coverStock;
    writeLayers('cover', coverStock, [paper, '#c9bba9']);
    $('leaf-source').value = leafLayout?.source || 'uniform';
    $('leaf-align').value = leafLayout?.align || 'top';
    for (const [index, axis] of ['width', 'height'].entries()) {
      $('leaf-' + axis).value = leafLayout?.firstSizeMm?.[index] ?? '';
      $('leaf-step-' + axis).value = leafLayout?.stepMm?.[index] ?? 0;
    }
    $('leaf-ranges').replaceChildren();
    (leafLayout?.ranges || []).forEach(range => appendRange(range, range.from === range.to && !range.stepMm));
    $('leaf-preview-number').value = 1;
    originalLeaf = value.leafLayout ?? null;
    originalLeafControls = JSON.stringify(readLeaves());
  }
  function read() {
    const edgeTreatments = {};
    for (const face of Object.keys(cutFaces)) {
      const mode = $('mode-' + face).value;
      if (mode === 'solid') edgeTreatments[face] = { mode, color: $('color-' + face).value };
      if (mode === 'scan') {
        const crop = Object.fromEntries([...$('crop-' + face).querySelectorAll('input')].map(input => [input.dataset.key, number(input)]));
        edgeTreatments[face] = { mode, rotation: Number($('rotation-' + face).value), crop };
      }
    }
    const currentLeaf = readLeaves();
    const leafLayout = JSON.stringify(currentLeaf) === originalLeafControls ? originalLeaf : currentLeaf;
    const thumbnailMode = $('card-thumbnail-mode').value;
    const cardStock = {
      cornerRadiusMm: number($('card-corner')) ?? 0,
      ...readStock('card', $('card-thickness-mode').value === 'measured'),
      ...(thumbnailMode && { thumbnailMode }),
      ...(thumbnailMode === 'single' && { thumbnailCard: number($('card-thumbnail-card')) ?? null }),
    };
    return { edgeTreatments, edgeBands: readRows('edge-bands'), ringPositions: $('ring-positions').value, cardStock,
      coverStock: $('cover-stock-enabled').checked ? readStock('cover', true) : null, saddleSections: readSections(), leafLayout };
  }
  function update(cards, cardCount) {
    updateSections(!cards && $('binding-type').value === 'saddle-stitch');
    document.querySelectorAll('[data-cards]').forEach(group => show(group, cards));
    document.querySelectorAll('[data-bound]').forEach(group => show(group, !cards));
    for (const face of Object.keys(cutFaces)) {
      const mode = $('mode-' + face).value;
      show($('solid-' + face), mode === 'solid');
      show($('scan-' + face), mode === 'scan');
    }
    show($('leaf-settings'), $('leaf-source').value !== 'uniform');
    show($('leaf-base-fields'), $('leaf-source').value === 'custom');
    show($('cover-stock-fields'), !cards && $('cover-stock-enabled').checked);
    updateLayers('card', $('card-thickness-mode').value === 'measured');
    updateLayers('cover', true);
    const single = $('card-thumbnail-mode').value === 'single';
    $('card-thumbnail-card-row').hidden = !single;
    $('card-thumbnail-card').disabled = !single;
    $('card-thumbnail-card').max = Math.max(1, cardCount || 0);
  }
  function renderLeafPreview(layout, count, trim, pages) {
    if (!layout || $('leaf-options').hidden) return;
    const n = $('leaf-preview-number');
    n.max = Math.max(1, count || 500);
    const leaf = Math.min(Number(n.max), Math.max(1, Math.round(Number(n.value) || 1)));
    const [width, height] = leafDimensions(layout, leaf, trim || undefined, pages);
    $('leaf-preview-size').textContent = width > 0 && height > 0
      ? leaf + '장 · ' + Number(width.toFixed(2)) + ' × ' + Number(height.toFixed(2)) + ' mm' : '';
  }
  return { write, read, update, renderLeafPreview, showSectionTotal };
}

export function resolvedLeafLayout(layout, trim) {
  if (!layout?.firstSizeMm || layout.firstSizeMm.every(Number.isFinite)) return layout;
  return { ...layout, firstSizeMm: layout.firstSizeMm.map((size, index) => size ?? trim[index]) };
}

export function materialPayload(meta, pageCount, trim, pages) {
  const cards = meta['book-form-type'] === 'cards';
  const { edgeBands, edgeTreatments, cardStock, coverStock, ringPositions } = meta.construction;
  const saddleSections = !cards && meta['binding-type'] === 'saddle-stitch' ? meta.construction.saddleSections : null;
  if (saddleSections && !validSaddleSections(saddleSections, pageCount)) throw new Error('권별 쪽수의 합을 전체 ' + pageCount + '쪽에 맞추고, 판형은 가로·세로를 함께 입력해주세요.');
  const leafLayout = resolvedLeafLayout(meta.construction.leafLayout, trim);
  for (const { start, end } of edgeBands) {
    if (start < 1 || end < start || end > pageCount) throw new Error('색지의 시작·끝 쪽을 내지 쪽수 안에서 지정해주세요.');
  }
  for (const cut of Object.values(edgeTreatments)) {
    const c = cut.crop;
    if (c && (c.x + c.width > 100.00001 || c.y + c.height > 100.00001)) throw new Error('단면 이미지의 자르기 영역이 원본을 벗어났습니다.');
  }
  const positions = !cards && meta['binding-type'] === 'ring' && ringPositions.trim() ? ringPositions.trim().split(/[\s,]+/).map(Number) : null;
  if (positions && (positions.some(n => !Number.isFinite(n) || n < 0 || n > 100) || positions.length !== new Set(positions).size || positions.length !== meta.mockupDetails.ringCount)) {
    throw new Error('독립 O링 위치는 링 개수만큼 서로 다른 0~100 사이 숫자로 입력해주세요.');
  }
  if (!cards && leafLayout && !validLeafLayout(leafLayout, Math.ceil(pageCount / 2), trim || undefined, pages)) {
    throw new Error('장별 재단 크기를 확인해주세요. 각 장의 가로·세로가 양수이고 구간이 실제 장수 안에 있어야 합니다.');
  }
  if (!cards && coverStock && !validCoverStock(coverStock)) throw new Error('표지 합지의 층 색상과 두께(0.01~20 mm)를 확인해주세요.');
  if (cards && cardStock.layerThicknessMm?.some(mm => !Number.isFinite(mm) || mm < 0.01 || mm > 20)) {
    throw new Error('각 층의 두께를 0.01~20 mm 사이로 입력해주세요.');
  }
  if (cards && cardStock.thumbnailMode === 'single' && (!Number.isInteger(cardStock.thumbnailCard) || cardStock.thumbnailCard < 1 || cardStock.thumbnailCard > Math.ceil(pageCount / 2))) {
    throw new Error('목록에 있는 카드 번호를 대표 카드로 지정해주세요.');
  }
  return { bookForm: cards ? 'cards' : 'bound', edgeBands, edgeTreatments, ringPositions: positions, cardStock: cards ? cardStock : null, coverStock: cards ? null : coverStock, saddleSections, leafLayout: cards ? null : leafLayout };
}
