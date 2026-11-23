const number = (label, initial, min, max, step = 1) => ({ type: 'number', label, default: initial, min, max, step });
const color = (label, initial) => ({ type: 'color', label, default: initial });

export const mockupDetailFields = Object.freeze({
  cornerRadiusMm: number('모서리 둥글기', 0, 0, 20, 0.1),
  coverGloss: number('표지 광택', 0, 0, 100),
  spineShape: { type: 'enum', label: '책등 모양', default: 'square', choices: ['square', 'round'] },
  boardThicknessMm: number('표지 보드 두께', null, 0.1, 5, 0.1),
  endpaperColor: color('면지색', null),
  grooveWidthMm: number('제본 홈 너비', null, 0.5, 10, 0.1),
  headbandEnabled: { type: 'boolean', label: '헤드밴드', default: false },
  headbandColor: color('헤드밴드 바탕색', '#9b8261'),
  headbandAccentColor: color('헤드밴드 줄무늬색', '#eee6cf'),
  ribbonEnabled: { type: 'boolean', label: '가름끈', default: false },
  ribbonMaterial: { type: 'enum', label: '가름끈 재질', default: 'silk', choices: ['silk', 'cotton'] },
  ribbonColor: color('가름끈 색', '#843643'),
  ribbonLengthMm: number('가름끈 길이', 6, 0, 100),
  ribbonAngle: number('가름끈 각도', 12, 0, 60),
  stitchType: { type: 'enum', label: '중철 방식', default: 'wire', choices: ['wire', 'loop', 'thread'] },
  stapleCount: { ...number('철심 개수', 2, 1, 10), integer: true },
  stapleInsetPercent: number('첫·끝 철심의 가장자리 여백 (%)', 25, 5, 45),
  stapleThicknessMm: number('철심 굵기', 0.3, 0.1, 0.5, 0.01),
  stapleColor: color('철심색', '#9a9a9a'),
  sewingStationCount: { ...number('노출사철 실 개수', 5, 1, 12), integer: true },
  threadColor: color('제본 실색', null),
  ringCount: { ...number('링 개수', 12, 1, 60), integer: true },
  ringDiameterMm: number('링 지름', 14, 4, 65, 0.1),
  wireDiameterMm: { ...number('스프링 선재 굵기', null, 0.4, 5, 0.1), decimalPlaces: 1 },
  ringColor: color('링 색', '#686b70'),
  ringPlacement: { type: 'enum', label: '링 위치', default: 'left', choices: ['left', 'top', 'right', 'bottom'] },
});

export function validMockupDetail(field, value) {
  if (value === null) return field.default === null;
  switch (field.type) {
    case 'number': return Number.isFinite(value) && value >= field.min && value <= field.max &&
      (!field.integer || Number.isInteger(value)) &&
      (field.decimalPlaces === undefined || Number.isInteger(value * 10 ** field.decimalPlaces));
    case 'color': return typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
    case 'boolean': return typeof value === 'boolean';
    case 'enum': return field.choices.includes(value);
    default: return false;
  }
}

// Old books and partially configured bindings use the same defaults in every view.
export function resolveMockupDetails(values) {
  const details = {};
  for (const [name, field] of Object.entries(mockupDetailFields)) {
    const value = values?.[name];
    details[name] = validMockupDetail(field, value) ? value : field.default;
  }
  return details;
}
