import { leafDimensions, validLeafLayout } from './vendor/mockup/book-format.js';

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
  function appendLayer(color, thickness = 0.22) {
    const row = makeRow('card-layers', '합지 층');
    row.append(colorField('층 색', 'color', color),
      numberField('층 두께 (mm)', 'thickness', thickness, { min: 0.01, max: 20, required: true }),
      removeButton(row, notify));
  }
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
  for (const [id, action] of [['add-edge-band', () => appendBand()], ['add-card-layer', () => appendLayer(paper)],
    ['add-leaf-range', () => appendRange()], ['add-leaf-override', () => appendRange({}, true)]]) {
    $(id).addEventListener('click', () => { action(); notify(); });
  }
  function showCardThickness() {
    const inputs = [...$('card-layers').querySelectorAll('[data-key="thickness"]')];
    const valid = $('card-thickness-mode').value === 'measured' && inputs.length && inputs.every(input => input.validity.valid);
    const total = inputs.reduce((sum, input) => sum + input.valueAsNumber, 0);
    $('card-thickness-summary').textContent = valid ? '카드 한 장 두께 ' + Number(total.toFixed(3)) + ' mm' : '';
  }
  $('card-layers').addEventListener('input', showCardThickness);
  function write(value = {}) {
    const { edgeTreatments = {}, edgeBands = [], cardStock, leafLayout = {}, ringPositions } = value;
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
    $('card-layers').replaceChildren();
    (cardStock?.layers || [paper]).forEach((color, i) => appendLayer(color, cardStock?.layerThicknessMm?.[i]));
    $('leaf-source').value = leafLayout?.source || 'uniform';
    $('leaf-align').value = leafLayout?.align || 'top';
    for (const [index, axis] of ['width', 'height'].entries()) {
      $('leaf-' + axis).value = leafLayout?.firstSizeMm?.[index] ?? '';
      $('leaf-step-' + axis).value = leafLayout?.stepMm?.[index] ?? 0;
    }
    $('leaf-ranges').replaceChildren();
    (leafLayout?.ranges || []).forEach(range => appendRange(range, range.from === range.to && !range.stepMm));
    $('leaf-preview-number').value = 1;
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
    const source = $('leaf-source').value;
    const ranges = readRows('leaf-ranges').map(({ step0, step1, from, to, ...rest }) => ({
      from, to: to ?? from, ...rest, ...(step0 != null || step1 != null ? { stepMm: [step0 ?? null, step1 ?? null] } : {}),
    }));
    const first = pair(number($('leaf-width')), number($('leaf-height')));
    const leafLayout = source === 'uniform' ? null : {
      source, align: $('leaf-align').value, ranges,
      ...(source === 'custom' && { ...(first && { firstSizeMm: first }), stepMm: [number($('leaf-step-width')) || 0, number($('leaf-step-height')) || 0] }),
    };
    const layers = readRows('card-layers');
    const thumbnailMode = $('card-thumbnail-mode').value;
    const cardStock = {
      cornerRadiusMm: number($('card-corner')) ?? 0, layers: layers.map(layer => layer.color),
      ...($('card-thickness-mode').value === 'measured' && { layerThicknessMm: layers.map(layer => layer.thickness ?? null) }),
      ...(thumbnailMode && { thumbnailMode }),
      ...(thumbnailMode === 'single' && { thumbnailCard: number($('card-thumbnail-card')) ?? null }),
    };
    return { edgeTreatments, edgeBands: readRows('edge-bands'), ringPositions: $('ring-positions').value, cardStock, leafLayout };
  }
  function update(cards, cardCount) {
    document.querySelectorAll('[data-cards]').forEach(group => show(group, cards));
    document.querySelectorAll('[data-bound]').forEach(group => show(group, !cards));
    for (const face of Object.keys(cutFaces)) {
      const mode = $('mode-' + face).value;
      show($('solid-' + face), mode === 'solid');
      show($('scan-' + face), mode === 'scan');
    }
    show($('leaf-settings'), $('leaf-source').value !== 'uniform');
    show($('leaf-base-fields'), $('leaf-source').value === 'custom');
    const layers = $('card-layers');
    const measured = $('card-thickness-mode').value === 'measured';
    $('add-card-layer').disabled = layers.children.length >= 16;
    for (const [i, row] of Array.from(layers.children).entries()) {
      row.querySelector('legend').textContent = (i + 1) + '층';
      row.querySelector('button').disabled = layers.children.length <= 1;
      const input = row.querySelector('[data-key="thickness"]');
      input.disabled = !measured;
      input.parentElement.hidden = !measured;
    }
    showCardThickness();
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
  return { write, read, update, renderLeafPreview };
}

export function resolvedLeafLayout(layout, trim) {
  if (!layout?.firstSizeMm || layout.firstSizeMm.every(Number.isFinite)) return layout;
  return { ...layout, firstSizeMm: layout.firstSizeMm.map((size, index) => size ?? trim[index]) };
}

export function materialPayload(meta, pageCount, trim, pages) {
  const cards = meta['book-form-type'] === 'cards';
  const { edgeBands, edgeTreatments, cardStock, ringPositions } = meta.construction;
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
  if (cards && cardStock.layerThicknessMm?.some(mm => !Number.isFinite(mm) || mm < 0.01 || mm > 20)) {
    throw new Error('각 층의 두께를 0.01~20 mm 사이로 입력해주세요.');
  }
  if (cards && cardStock.thumbnailMode === 'single' && (!Number.isInteger(cardStock.thumbnailCard) || cardStock.thumbnailCard < 1 || cardStock.thumbnailCard > Math.ceil(pageCount / 2))) {
    throw new Error('목록에 있는 카드 번호를 대표 카드로 지정해주세요.');
  }
  return { bookForm: cards ? 'cards' : 'bound', edgeBands, edgeTreatments, ringPositions: positions, cardStock: cards ? cardStock : null, leafLayout: cards ? null : leafLayout };
}
