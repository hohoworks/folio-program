# FOLIO 작품 보관함

GitHub에서 이 저장소의 이름 옆에 **Private**가 표시되어야 합니다. `dist/catalog.json`에는 공개·미공개 작품, 소개, 연락처와 편집 정보가 들어 있습니다. `dist/assets/`에는 관리자가 저장한 웹용 이미지가 들어갑니다.

Cloudflare Pages를 **이 저장소**에 연결하세요. Build command는 `node build-site.mjs`, Build output directory는 `public-site`입니다. Pages의 환경 변수에 `NODE_VERSION=24`, `SKIP_DEPENDENCY_INSTALL=1`, `FOLIO_PROGRAM_REPOSITORY`(본인 소유의 공개 프로그램 저장소), `FOLIO_PROGRAM_COMMIT`(사용할 프로그램 버전의 40자리 커밋 번호)을 입력합니다.

설치가 끝나면 온라인 관리자에서 작업을 저장하세요. Cloudflare는 이 저장소의 새 커밋을 감지하고 공개로 선택한 작업만 배포합니다. 이전 방식의 `dist` 폴더를 배포 대상으로 지정하면 편집 원본이 공개될 수 있습니다.

PDF는 등록할 때 웹용 페이지 이미지로 변환됩니다. 인쇄용 PDF와 인디자인 파일은 별도로 보관하세요. 자세한 설치·업데이트 순서는 프로그램 저장소의 **SPLIT-HOSTING.md**에 있습니다.
