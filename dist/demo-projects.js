export const demoProjects = [
  {
    type: 'project',
    id: 'afterimage',
    title: '잔상',
    category: '포스터',
    year: '2026',
    tagIds: ['poster', 'print'],
    description: ['굵은 글자와 붉은색·검정의 겹침으로 잔상의 감각을 구성한 포스터 스터디입니다. 두 번째 이미지는 잉크의 겹침과 종이 표면을 보여줍니다.'],
    translations: { en: {
      title: 'Afterimage',
      category: 'Poster',
      description: ['A poster study with condensed lettering and red-and-black overprints. A close-up follows the ink textures and the surface of the paper.'],
    } },
    images: [
      { imageSrc: 'assets/examples/afterimage.webp', alt: 'Afterimage 문구와 붉은색·검정의 나선이 겹친 세로형 포스터', ratio: 1024 / 1536 },
      { imageSrc: 'assets/examples/afterimage-detail.webp', alt: '포스터 잉크의 겹침과 종이 질감을 가까이에서 본 모습', ratio: 1536 / 1024 },
    ],
  },
  {
    type: 'project',
    id: 'shift-identity',
    title: '시프트',
    category: '아이덴티티',
    year: '2026',
    tagIds: ['identity', 'logo', 'print'],
    description: ['서로 다른 크기의 스테이셔너리에 Shift라는 이름을 배치한 아이덴티티 스터디입니다. 시안·파랑·검정의 대비를 사용했습니다.'],
    translations: { en: {
      title: 'Shift',
      category: 'Identity',
      description: ['An identity study arranging the name Shift across stationery in different sizes. Cyan, blue and black form a limited palette.'],
    } },
    images: [
      { imageSrc: 'assets/examples/shift-identity.webp', alt: '시안·파랑·검정으로 구성한 Shift 스테이셔너리', ratio: 1536 / 1024 },
    ],
  },
  {
    type: 'project',
    id: 'estuary',
    title: '물가의 표식',
    category: '사진',
    year: '2025',
    tagIds: ['photography'],
    description: ['갈대와 물 사이의 붉은 부표를 담은 사진입니다. 넓은 화면 안에서 색의 대비와 식생의 질감을 관찰합니다.'],
    translations: { en: {
      title: 'Estuary Marker',
      category: 'Photography',
      description: ['A red buoy sits among reeds and water. The wide frame studies the contrast of color and the texture of the surrounding vegetation.'],
    } },
    images: [
      { imageSrc: 'assets/examples/estuary.webp', alt: '갈대와 물 사이에 놓인 붉은 부표를 가로로 넓게 담은 사진', ratio: 1672 / 941 },
    ],
  },
  {
    type: 'project',
    id: 'fold-object',
    title: '하나의 접힘',
    category: '오브젝트',
    year: '2025',
    tagIds: ['object'],
    description: ['알루미늄 판 한 장을 구부려 만든 형태 연구입니다. 접힌 선과 빛의 방향에 따라 달라지는 금속 표면을 두 장의 이미지로 살펴봅니다.'],
    translations: { en: {
      title: 'Single Fold',
      category: 'Object',
      description: ['A form study made by bending a single sheet of aluminum. Two views follow the crease and the way light moves across the burnished surface.'],
    } },
    images: [
      { imageSrc: 'assets/examples/fold-object.webp', alt: '한 장의 알루미늄 판을 구부린 형태 연구', ratio: 1 },
      { imageSrc: 'assets/examples/fold-detail.webp', alt: '접힌 알루미늄 표면과 빛의 반사를 가까이에서 본 모습', ratio: 1400 / 933 },
    ],
  },
  {
    type: 'project',
    id: 'index-fm',
    title: '인덱스 FM',
    category: '웹 디자인',
    year: '2026',
    tagIds: ['web'],
    description: ['가상의 웹 라디오 아카이브를 위한 화면 스터디입니다. 흰 바탕과 검은 글자, 턴테이블 이미지에 노란색 세로 띠를 더했습니다.'],
    translations: { en: {
      title: 'Index FM',
      category: 'Web design',
      description: ['A screen study for a fictional web-radio archive. Black lettering and a turntable image sit on a white field, with a yellow band at the side.'],
    } },
    images: [
      { imageSrc: 'assets/examples/index-fm.webp', alt: '턴테이블과 케이블 사진, 검은 글자와 노란색 세로 띠가 있는 흰색 웹 라디오 아카이브 화면', ratio: 1586 / 992 },
    ],
  },
  {
    type: 'project',
    id: 'crossing-still',
    title: '빛을 건너',
    category: '비디오 스틸',
    year: '2025',
    tagIds: ['video'],
    description: ['한 줄기 빛 안에서 움직이는 두 무용수의 흑백 리허설 스틸입니다. 빛의 명암과 몸 사이의 간격을 한 장의 화면으로 기록했습니다.'],
    translations: { en: {
      title: 'Crossing Light',
      category: 'Video still',
      description: ['A black-and-white rehearsal still with two dancers moving through a strip of light. A single frame studies the light and the distance between the bodies.'],
    } },
    images: [
      { imageSrc: 'assets/examples/crossing-still.webp', alt: '길게 드리운 빛 안에서 검은 옷과 흰옷을 입은 두 무용수가 움직이는 흑백 리허설 장면', ratio: 1800 / 836 },
    ],
  },
  {
    type: 'project',
    id: 'interval',
    title: '간격',
    category: '음악 패키지',
    year: '2024',
    tagIds: ['music', 'print'],
    description: ['남색 바탕 위에 라임색 곡선이 반복되는 음악 슬리브 스터디입니다. Interval이라는 제목과 곡선 사이의 간격으로 리듬을 구성했습니다.'],
    translations: { en: {
      title: 'Interval',
      category: 'Music packaging',
      description: ['A music sleeve study of lime-green curves repeating over a deep blue field. The title Interval and the spacing between the curves establish a visual rhythm.'],
    } },
    images: [
      { imageSrc: 'assets/examples/interval.webp', alt: '남색 바탕에 라임색 곡선과 Interval 제목이 있는 정방형 음악 슬리브', ratio: 1 },
    ],
  },
].map(project => ({
  ...project,
  thumbnailSrc: project.images[0].imageSrc.replace('assets/examples/', 'assets/examples/thumbs/'),
}));

export const demoOrder = [
  'afterimage', 'shift-identity', 'quiet-hours', 'estuary',
  'index-fm', 'tidal-notes', 'fold-object', 'city-lines', 'crossing-still', 'interval',
];
