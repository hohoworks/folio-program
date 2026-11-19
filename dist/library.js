import { pages } from './book.js';

export const books = [
  {
    id: 'quiet-hours',
    title: 'The Quiet Hours',
    coverRatio: 148 / 210,
    pageRatio: 148 / 210,
    year: '2026',
    tagIds: ['book', 'photography'],
    trimSizeMm: [148, 210],
    category: '사진 에세이',
    description: [
      '해가 숲 바닥에 닿기 전, 안개에 잠긴 침엽수 숲을 걷는다. 멀리 능선의 윤곽이 조금씩 나타나고, 발밑의 자갈길은 솔잎 깔린 오솔길로 이어진다.',
      '새벽이 밝아오면 가까운 나무의 색부터 돌아온다. 안개 낀 능선과 숲길, 돌아오는 길에 처음 들린 새소리를 사진과 짧은 글에 담았다.',
    ],
    coverTitle: ['Quiet', 'Hours'],
    translations: { en: {
      category: 'Photo essay',
      description: [
        'Before sunlight reaches the forest floor, we walk through conifers submerged in mist. The distant ridgeline slowly appears, and the gravel beneath our feet gives way to a trail covered in pine needles.',
        'As dawn arrives, the nearest trees regain their color first. Photographs and short notes record the misty ridge, the forest path, and the first birds heard on the way back.',
      ],
    } },
    coverLabel: 'A FIELD JOURNAL',
    coverCopy: 'A field journal from the hours before the forest wakes.',
    image: './assets/forest.jpg',
    pages,
  },
  {
    id: 'city-lines',
    title: 'City Lines',
    coverRatio: 225 / 145,
    pageRatio: 225 / 145,
    year: '2025',
    tagIds: ['book', 'print'],
    trimSizeMm: [225, 145],
    category: '도시 산문',
    description: [
      '비가 그친 뒤 젖은 아스팔트에 초록 신호등이 거꾸로 비친다. 빵집 앞에 세워 둔 자전거의 바퀴살은 유리창에 비친 거리를 잘게 나눈다.',
      '빌딩 사이에 난 한낮의 빛, 승강장에서 벗겨진 노란 페인트, 강 건너로 하나둘 켜지는 창. 걷는 동안 잠깐씩 눈에 들어온 도시의 선을 여섯 편의 짧은 글로 따라간다.',
    ],
    coverTitle: ['City', 'Lines'],
    translations: { en: {
      category: 'Urban prose',
      description: [
        'After the rain, a green crossing signal appears upside down on the wet asphalt. Outside a bakery, the spokes of a parked bicycle divide the street reflected in its window.',
        'Midday light between buildings, yellow paint worn away on a platform, and windows lighting up across the river. Six short pieces follow the lines of a city noticed while walking.',
      ],
    } },
    coverLabel: 'NOTES ON WALKING',
    coverCopy: 'Six short walks through a city that keeps drawing itself.',
    pages: [
      {
        eyebrow: 'AFTER THE RAIN',
        title: 'Crossing',
        subtitle: 'Notes on walking',
        paragraphs: [
          'The crossing signal turns green. For a moment the wet asphalt carries a second signal, upside down.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'SIDE STREET',
        title: 'Delivery',
        paragraphs: [
          'A delivery rider leans a bicycle against the bakery window. Inside, someone arranges the loaves in a row. Outside, the spokes divide the reflection into narrow triangles.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'MIDDAY',
        title: 'Between towers',
        paragraphs: [
          'At noon the towers leave a narrow channel of light along the pavement. People carry lunch through it, their shadows briefly keeping pace.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'PLATFORM',
        title: 'The yellow line',
        paragraphs: [
          'The yellow paint is worn through beside the stairs. Regulars stop at the same chip in the concrete. When the train arrives, the doors open in front of them.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'ON THE BRIDGE',
        title: 'Work lights',
        paragraphs: [
          'On the far bank, the windows come on in clusters. A cleaner crosses one square of light, pauses, and pulls the blind.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'LAST BLOCK',
        title: 'The way home',
        paragraphs: [
          'Someone has chalked a hopscotch court on the last block. The rain has taken all its numbers. Near the curb, the small outlines remain.',
        ],
        layout: 'text',
      },
    ],
  },
  {
    id: 'tidal-notes',
    title: 'Tidal Notes',
    coverRatio: 1,
    pageRatio: 1,
    year: '2024',
    tagIds: ['book', 'photography'],
    trimSizeMm: [190, 190],
    category: '자연 관찰기',
    description: [
      '썰물에 드러난 계단에는 조금 전 물이 닿았던 높이가 짙은 띠로 남는다. 얕은 웅덩이에서는 새우 한 마리가 해초 잎 사이를 건넌다.',
      '서쪽에서 바람이 불어오고, 밀물이 모래 위의 발자국을 하나씩 채운다. 첫 썰물부터 해 질 무렵까지 물가에서 관찰한 여섯 장면을 담았다.',
    ],
    coverTitle: ['Tidal', 'Notes'],
    translations: { en: {
      category: 'Nature journal',
      description: [
        'A dark band remains on the exposed steps where the water stood a moment ago. In a shallow pool, a shrimp moves between the seaweed.',
        'Wind arrives from the west, and the rising tide fills the footprints in the sand. Six observations follow the waterline from the first ebb to dusk.',
      ],
    } },
    coverLabel: 'SHORE AND WEATHER',
    coverCopy: 'A day at the waterline, from the first ebb to the last light.',
    pages: [
      {
        eyebrow: 'EARLY EBB',
        title: 'Tidal Notes',
        subtitle: 'Shore and weather',
        paragraphs: [
          'The water has pulled away from the steps. On the lowest one, a dark band marks where it stood when I arrived.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'AT THE PIER',
        title: 'Rope',
        paragraphs: [
          'The boats sink lower in their berths as the tide goes out. A rope lifts from the pier, rubs once against the wood, and stretches taut.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'LOW WATER',
        title: 'A small pool',
        paragraphs: [
          'In the shallow pool, the seaweed rests in the shape of the current that left it. A shrimp moves from one blade to the next. The water hardly stirs.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'WIND SHIFT',
        title: 'From the west',
        paragraphs: [
          'The flags go slack before the wind changes. A little later, the tide flats darken in bands as ripples arrive from the west.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'FLOOD',
        title: 'The inlet',
        paragraphs: [
          'A narrow stream crosses the sandbar and fills the footprints one by one. On the far side, the line of waders lifts and settles on higher ground.',
        ],
        layout: 'text',
      },
      {
        eyebrow: 'LAST LIGHT',
        title: 'The upper step',
        paragraphs: [
          'I climb one step higher to stay dry. Across the inlet, someone shakes the sand out of a towel. The day fades before the water stops rising.',
        ],
        layout: 'text',
      },
    ],
  },
];

export { trimSize, spineRatio, loadCatalog, loadBooks } from './catalog.js';
