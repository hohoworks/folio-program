# 두 저장소로 포트폴리오 열기

처음 한 번은 GitHub에 폴더 두 개를 올립니다. 그다음부터는 관리자에서 책이나 작업을 저장하면 방문자 사이트가 자동으로 갱신됩니다.

| 폴더 | GitHub 공개 설정 | 들어 있는 것 |
| --- | --- | --- |
| `folio-program` | **Public** | 사이트와 관리자 프로그램, 공용 예시. 사이트를 그리는 코드입니다. |
| `folio-content` | **Private** | 현재 작품의 전체 목록과 웹용 이미지, 미공개 작업, 소개·연락처. 관리자가 편집하는 원본입니다. |

**방문자에게 공유할 주소는 Cloudflare의 `pages.dev` 주소**입니다. GitHub 저장소 두 개는 운영할 때 사용합니다. 원본 PDF는 등록 과정에서 내지 이미지로 변환되므로 인쇄용 PDF는 별도로 백업하세요.

기본 주소로 운영하면 이 구성은 무료 범위에서 시작할 수 있습니다. 작품 저장소에서는 GitHub Actions를 실행하지 않습니다. 자동 검사와 관리자 배포에는 공개 프로그램 저장소의 무료 표준 실행 환경을 사용합니다. Cloudflare Pages Free의 한도는 월 500회 빌드, 사이트당 파일 20,000개, 파일당 25 MiB입니다. [GitHub Actions 요금](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Cloudflare Pages 한도](https://developers.cloudflare.com/pages/platform/limits/)

## 0. 소유자가 빈 저장소 두 개를 만들기

준비물은 GitHub 계정, Cloudflare 계정, 웹 브라우저입니다. 전달받은 `FOLIO-웹업로드-전달용.zip`을 컴퓨터의 기본 압축 풀기로 열면 웹 안내서와 업로드할 ZIP 두 개가 나옵니다. 안내서 `브라우저-업로드-안내.html`은 브라우저에서 열어 두세요. [GitHub 가입](https://github.com/signup) · [Cloudflare 가입](https://dash.cloudflare.com/sign-up)

1. 앞으로 사이트를 소유할 분의 GitHub 계정으로 로그인하고 **New repository**를 누르세요. Owner에 소유자 계정을 지정합니다. [저장소 만들기](https://github.com/new)
2. 이름 `folio-program`, 공개 범위 **Public**으로 저장소 하나를 만듭니다. 두 번째는 이름 `folio-content`, 공개 범위 **Private**입니다. 두 저장소 모두 초기 README, .gitignore, License는 비워 주세요.
3. 담당자가 따로 있으면 각 저장소의 **Settings → Collaborators → Add people**에서 담당자의 GitHub 아이디를 초대합니다. 담당자는 초대를 수락하고 자기 계정으로 1단계를 진행합니다. 실제 관리자 코드와 배포용 키는 소유자가 3단계에서 입력합니다. [GitHub 협업자 초대](https://docs.github.com/en/account-and-profile/managing-access-to-your-personal-repositories/managing-access-to-your-personal-repositories/inviting-collaborators-to-a-personal-repository)

## 1. 담당자가 브라우저로 파일 올리기

| 전달받은 ZIP | GitHub에서 열 저장소 | 루트에서 확인할 것 |
| --- | --- | --- |
| `folio-program-PUBLIC.zip` | `folio-program` · Public | `admin`, `dist`, `scripts`, `package.json` |
| `folio-content-PRIVATE.zip` | `folio-content` · Private | `build-site.mjs`, `dist/catalog.json` |

1. 두 ZIP을 각각 풀고, `folio-program` 저장소의 **uploading an existing file** 또는 **Add file → Upload files**를 누르세요. 공개용 폴더를 열어 **그 안의 파일과 하위 폴더**를 선택한 뒤 브라우저에 끌어 놓고 **Commit changes**를 누릅니다. GitHub의 **Code** 탭에서 위 표의 항목이 바로 보여야 합니다.
2. 같은 방법으로 **Private 표시가 있는** `folio-content`에 비공개 ZIP의 내용물을 올립니다. 처음 한 번은 `main` 브랜치를 사용합니다. [GitHub 웹 업로드](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
3. 숨김 설정은 전달용 HTML의 복사 버튼으로 등록합니다. 각 저장소의 맨 위 **Code → Add file → Create new file**에서 안내서에 있는 **파일 경로**와 **내용**을 차례로 붙여넣고 **Commit changes**를 누르세요. 공개 저장소에 다섯 파일, 비공개 저장소에 한 파일입니다. `.github/workflows/check.yml`은 프로그램의 다른 파일이 모두 등록된 후 저장합니다. [폴더 경로로 새 파일 만들기](https://docs.github.com/en/repositories/working-with-files/managing-files/creating-new-files)
4. **folio-program → Actions → Check FOLIO**에서 최신 실행이 초록색인지 확인합니다. **Code → Commits**에서 프로그램의 **마지막 커밋**을 열고, 주소 끝의 `/commit/` 다음 **40자리**를 복사하세요. 소유자에게 저장소 두 곳의 주소와 이 번호를 전달합니다.
5. 소유자가 결과물을 확인한 뒤, 파일 등록만 맡긴 일회성 협업자는 **Settings → Collaborators**에서 정리할 수 있습니다. 프로그램 저장소의 쓰기 권한으로 관리자 배포 절차를 수정할 수 있으므로 이후 운영에 필요한 사람만 권한을 유지하세요. [GitHub Actions의 권한 안내](https://docs.github.com/en/actions/reference/security/secure-use)

## 2. 방문자 사이트 연결하기

Cloudflare의 **Workers & Pages → Create application → Pages → Connect to Git**에서 GitHub를 선택하세요. 저장소 선택 화면에서 **비공개 `folio-content`**를 선택합니다. 선택지에 없다면 Cloudflare의 GitHub 앱에 이 저장소의 접근을 허용하세요. [Cloudflare Git 연결 안내](https://developers.cloudflare.com/pages/get-started/git-integration/)

| 설정 항목 | 입력할 값 |
| --- | --- |
| Project name | 원하는 방문자 주소 이름 |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `node build-site.mjs` |
| Build output directory | `public-site` |
| Root directory | 비워 두기 |

같은 화면의 **Environment variables**에 아래 네 줄을 추가하고 **Save and Deploy**를 누릅니다. 미리보기 배포를 켰고 Production과 Preview 설정이 구분되어 있다면 양쪽에 입력하세요.

| 이름 | 값 |
| --- | --- |
| `NODE_VERSION` | `24` |
| `SKIP_DEPENDENCY_INSTALL` | `1` |
| `FOLIO_PROGRAM_REPOSITORY` | `내GitHub아이디/folio-program`. 주소 앞의 `https://github.com/`은 빼세요. |
| `FOLIO_PROGRAM_COMMIT` | 1단계에서 복사한 40자리 버전 번호 |

**Pages에 관리자 코드나 GitHub 쓰기 키를 입력할 필요는 없습니다.** Cloudflare는 지정된 프로그램 버전을 읽은 뒤 공개를 선택한 작품만 새 폴더에 담습니다. 배포가 끝나면 표시된 주소를 열어 작품과 소개를 확인하세요. [Pages 빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [환경 변수 안내](https://developers.cloudflare.com/pages/configuration/build-image/)

**확인** — Pages의 **Deployments**에서 성공한 배포를 열고 `pages.dev` 주소를 눌러보세요. 공개 작품이 0개라면 메뉴와 빈 작업 목록이 보이는 것이 정상입니다.

## 3. 온라인 관리자 연결하기

1. GitHub에서 **Settings → Developer settings → Personal access tokens → Fine-grained tokens**를 엽니다. **Only select repositories**에서 **비공개 `folio-content` 하나만** 선택하고 **Contents → Read and write** 권한으로 키를 만드세요. [GitHub 쓰기 키 만들기](https://github.com/settings/personal-access-tokens/new)
2. **프로그램 저장소 `folio-program`**의 **Settings → Secrets and variables → Actions → Variables → New repository variable**에서 아래 값을 추가하세요.

   | Name | Value |
   | --- | --- |
   | `FOLIO_CONTENT_REPOSITORY` | `내GitHub아이디/folio-content` |
   | `FOLIO_CONTENT_BRANCH` | 기본값은 `main`. 작품 저장소에서 다른 브랜치를 사용할 때만 추가하세요. Pages의 Production branch도 동일하게 맞춥니다. |

3. 같은 화면의 **Secrets** 탭에 네 값을 등록하세요. 기존 관리자와 같은 Cloudflare 계정을 쓰면 기존 값을 재사용할 수 있습니다. 저장소 하나에만 권한을 준 GitHub 키는 새 작품 저장소용으로 교체하세요.

   | Secret 이름 | 넣을 값 |
   | --- | --- |
   | `FOLIO_ADMIN_CODE` | 본인의 관리자 접속 코드 |
   | `FOLIO_GITHUB_TOKEN` | 방금 만든 비공개 작품 저장소용 키 |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 계정 ID |
   | `CLOUDFLARE_API_TOKEN` | 해당 계정의 **Edit Cloudflare Workers** 권한 키 |

   Cloudflare 값을 처음 준비한다면 다음 순서를 따라가세요.

   1. **Workers & Pages**에서 `Your subdomain` 옆의 설정을 열어 `workers.dev` 주소 앞에 붙일 이름을 정하세요. 이미 이름이 있으면 그대로 사용하세요. [관리자 기본 주소](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
   2. 대시보드에서 **⌘K → Copy account ID**를 선택해 본인 계정 ID를 복사하세요. 위 표의 `CLOUDFLARE_ACCOUNT_ID`에 넣을 값입니다. [계정 ID 찾기](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)
   3. **My Profile → API Tokens → Create Token → Edit Cloudflare Workers → Use template**에서 사용할 계정을 선택하고 토큰을 생성하세요. 표시된 토큰을 `CLOUDFLARE_API_TOKEN`에 넣으세요. [Cloudflare 토큰 만들기](https://dash.cloudflare.com/profile/api-tokens)

4. **folio-program → Actions → Publish FOLIO admin → Run workflow**를 기본 브랜치에서 실행하세요. 비공개 저장소와 작업 목록을 확인한 후 관리자가 배포됩니다. Cloudflare에 표시된 관리자 `workers.dev` 주소 끝에 `/admin`을 붙이고 로그인하세요.
5. 다른 시크릿 창에서 관리자 주소를 열어 접속 코드를 요구하는지 확인하세요.

### 첫 작품으로 온라인 연결 확인하기

1. 관리자에서 **사이트 설정**으로 가서 국문 사이트 이름을 입력하고 저장하세요. 로그인한 관리자 상단과 브라우저 탭에서 바로 확인할 수 있습니다. 온라인 방문자 화면은 다음 Pages 배포가 끝난 뒤 새로고침하세요.
2. **작업 관리 → 작업 추가 + → 프로젝트**를 고르고 공개해도 되는 이미지 **한 장**과 제목을 넣으세요. 준비한 이미지가 없으면 `folio-program/dist/assets/examples/afterimage.webp`를 써도 됩니다. **공개** 상태에서 저장하세요. 비공개까지 직접 확인하려면 먼저 **공개** 체크를 끄고 저장해 첫 배포 뒤 목록에서 숨겨졌는지 보고, 다시 체크하고 저장하세요.
3. GitHub의 비공개 `folio-content`에 새 커밋이 생기고 **Cloudflare Pages → Deployments**의 같은 커밋이 성공하면 `pages.dev` 주소에서 새 작업을 눌러보세요. 여기까지 되면 온라인 관리자에서 방문자 사이트까지의 연결이 확인된 것입니다.
4. 책을 처음 올릴 때는 앞표지 이미지와 짧은 PDF로 확인하세요. 낱장 PDF는 **한 쪽씩**, 이미 두 면이 한 페이지인 PDF는 **두 쪽 펼침면**을 선택합니다. PC에서 두 쪽이 함께 보이는지, 휴대폰에서 왼쪽 쪽부터 순서대로 읽히는지 확인한 뒤 나머지 책을 올리세요. [책 파일 준비](README.md#prepare-files)


작품 저장소의 공개 범위를 확인할 수 없거나 Public으로 바뀌면 관리자가 자료 조회와 저장을 중단합니다. 이미 공개로 전환된 GitHub 저장소는 그 즉시 다른 사람이 원본을 볼 수 있으므로 **Private 상태를 유지**하세요. 프로그램 저장소에서 새 버전을 선택할 때는 본인 또는 신뢰하는 작업자가 올린 커밋을 지정하세요.

## 평소에는 무엇을 바꾸나요?

| 하고 싶은 일 | 할 일 |
| --- | --- |
| 책·프로젝트 등록, 소개·연락처 수정 | 온라인 관리자에서 저장합니다. 다음 Pages 배포가 끝나면 반영됩니다. |
| 작업 숨기기 | 관리자에서 **공개**를 해제하고 저장합니다. 다음 배포에 해당 자료가 빠집니다. 이미 내려받은 파일이나 이전 배포 주소의 사본은 남을 수 있습니다. |
| 화면 디자인이나 기능 업데이트 | `folio-program`에 업데이트를 올립니다. GitHub의 **Code → Commits**에서 새 커밋의 전체 40자리 번호를 복사해 Pages의 `FOLIO_PROGRAM_COMMIT`을 갱신하고, **Deployments**에서 작품 저장소 최신 커밋을 다시 배포하세요. 관리자 프로그램도 바뀌었으면 **Publish FOLIO admin**을 다시 실행하세요. |
| 관리자 코드 교체 | 프로그램 저장소에서 `FOLIO_ADMIN_CODE`를 교체한 후 **Publish FOLIO admin**을 다시 실행하세요. 기존 로그인도 만료됩니다. |

### 기존 사이트에서 옮길 때

현재 작업이 온라인에 있다면 GitHub에서 기존 작품 저장소의 최신 커밋을 확인하고 **Code → Download ZIP**으로 최신 자료를 받으세요. 두 새 폴더에는 분리했던 시점의 자료가 들어 있습니다. 그 뒤 추가한 작업은 게시 전에 최신 원본으로 다시 분리하거나 동기화하세요. 기존 자료의 공개 설정을 Public으로 바꾸면 이전 커밋의 내용까지 공개될 수 있습니다.
  
새 Pages 프로젝트를 비공개 작품 저장소에 연결하고 새 주소에서 먼저 확인하면 이전 사이트를 계속 열어둘 수 있습니다. 새 프로젝트의 `pages.dev` 주소는 달라집니다. 개인 도메인을 쓰면 확인 후 새 프로젝트에 연결하세요. 관리자 배포는 같은 Cloudflare 계정의 `folio-admin`을 갱신하므로 **새 작품 저장소 이관이 끝난 다음** 실행하세요.

<details>
<summary>개발자용 · 이 Mac에서 먼저 수정하거나 분리 폴더를 다시 만들 때</summary>


분리된 `folio-program`과 `folio-content`를 같은 상위 폴더에 두세요. 프로그램 폴더에서 [로컬 관리자 실행 안내](README.md#local-admin)에 따라 실행하면 작업은 옆의 `folio-content/dist`에 저장됩니다. 기존 관리자 창에서 입력 중이라면 먼저 저장을 마치세요. 로컬 저장분을 인터넷에 반영할 때는 **작품 저장소**에서 Commit과 Push를 누릅니다. 새 프로그램 폴더에는 접속 코드를 복사해 두지 않았습니다.

분리된 폴더에서 방문자 미리보기를 만들려면 프로그램 폴더에서 아래 두 줄을 실행하고 `http://127.0.0.1:8897/`을 여세요. 로컬 내용을 수정하면 첫 줄을 다시 실행해 미리보기를 갱신하세요.

```sh
FOLIO_CONTENT_DIR="$(cd ../folio-content/dist && pwd)" node scripts/build-public.mjs
python3 -m http.server 8897 --bind 127.0.0.1 --directory public-site
```

기존 통합 폴더에서 두 폴더를 다시 준비할 때는 그 폴더에서 다음을 실행하세요. Node.js 24를 사용합니다. 결과를 담을 **새 폴더 이름**을 지정하면 기존 작업 폴더를 보존합니다.

```sh
node scripts/prepare-repositories.mjs ../FOLIO-분리-새복사본
```

</details>
