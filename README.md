# FOLIO 호스팅 설명서

**담당자가 브라우저로 처음 올릴 때는 전달용 ZIP의 `브라우저-업로드-안내.html`을 여세요.** 같은 설정을 [두 저장소로 포트폴리오 열기](SPLIT-HOSTING.md)에서도 확인할 수 있습니다. Pages와 관리자에 입력하는 값도 그 안내를 기준으로 합니다.

아래 1~7단계는 사이트 프로그램과 작품을 **한 비공개 저장소**에 함께 두는 기존 방식입니다. 8단계 이후의 작품 관리 방법은 두 방식이 같습니다.

‘호스팅’은 이 사이트를 인터넷에 올려 항상 열리게 하는 일입니다. 처음 한 번 연결해두면 이후에는 관리자에서 책과 작업을 등록하면 됩니다.

### 어디부터 누르면 될까요?

| 지금 하고 싶은 일 | 열 곳 | 끝났는지 확인하는 방법 |
| --- | --- | --- |
| 이 컴퓨터에서 책이나 작업을 먼저 등록하기 | [내 컴퓨터의 관리자](http://127.0.0.1:8787/admin) | 접속 코드로 들어가면 **작업 관리**와 **사이트 설정**이 보입니다. |
| 공개 프로그램·비공개 작품 저장소로 처음 배포 | [두 저장소 설치 설명서](SPLIT-HOSTING.md) | 관리자에서 저장한 작업이 비공개 작품 저장소에 기록됩니다. |
| 한 비공개 저장소로 사이트 공개하기 | [1~3단계 따라 하기](#first-launch) | 휴대폰에서도 나의 `pages.dev` 주소가 열립니다. |
| 나만의 작업 등록 화면 만들기 | [4~7단계 따라 하기](#connect-admin) | 내 관리자 주소 끝에 `/admin`을 붙이고 접속 코드를 넣으면 작업 목록이 열립니다. |
| 포스터나 책 한 권 추가하기 | [작업 하나 올리기](#add-work) | 공개 사이트의 **작업** 메뉴에서 새 썸네일이 보입니다. |

**이 컴퓨터에서 먼저 작업할 때**는 관리자 화면에 `FOLIO 관리자 접속 코드.txt`의 한 줄을 입력하세요. **작업 관리 → 작업 추가 +**에서 책이나 프로젝트를 고르고 저장한 뒤 [포트폴리오 미리보기](http://127.0.0.1:8896/)를 새로고침하면 결과가 보입니다. 아직 공개한 작품이 없다면 작업 목록이 비어 있는 것이 정상입니다. 관리자와 미리보기 주소를 다시 실행하는 방법은 [로컬 실행 안내](#local-admin)에 있습니다.

로컬 관리자에서 저장한 작업은 이 컴퓨터의 `folio-github/dist` 폴더에 들어갑니다. 인터넷에 처음 공개할 때는 작업을 저장한 **현재 폴더**로 1~3단계를 진행하세요. 이미 GitHub에 연결했다면 GitHub Desktop에서 변경 파일을 확인하고 **Commit to main → Push origin**을 눌러 반영합니다. 배포한 온라인 관리자를 사용하려면 4~7단계까지 연결하세요.

자주 찾는 설명은 [파일 준비](#prepare-files), [방문자 화면과 필터 초기화](#visitor-guide), [평소 수정·이어 올리기](#maintenance), [문제 해결](#troubleshooting), [무료 범위와 백업](#free-operation)에서 바로 열 수 있습니다. 첫 배포는 GitHub Desktop과 웹 화면에서 진행합니다.

| 사용하는 서비스 | 하는 일 |
| --- | --- |
| GitHub | 사이트 파일과 작업의 변경 내용을 보관 |
| Cloudflare Pages | 방문자가 보는 포트폴리오를 인터넷에 공개 |
| Cloudflare Workers | 접속 코드를 확인하고 관리자 등록·수정을 처리 |

**이 포트폴리오에는 GitHub 비공개 저장소와 Cloudflare Free를 권합니다.** 작업 원본과 미공개 작품은 GitHub에 보관하고, 방문객에게는 공개한 작품만 `pages.dev` 주소로 보여줍니다. 관리자는 별도의 `workers.dev/admin` 주소에서 로그인합니다. Cloudflare Pages는 비공개 GitHub 저장소도 연결할 수 있습니다. [Cloudflare의 GitHub 연결 안내](https://developers.cloudflare.com/pages/get-started/git-integration/)

이미 사이트를 운영하고 있다면 [기존 사이트 업데이트](#update-program)부터 읽으세요. 이번 버전은 Pages에 입력할 **빌드 명령과 공개 폴더**가 모두 바뀌었습니다. 관리자 코드가 보호하는 범위와 분실 시 조치는 [관리자 보안](#admin-security)에 있습니다.

<a id="first-launch"></a>

## 1. 준비물 확인하기

- 본인 GitHub 계정. 계정이 없다면 [GitHub 가입](https://github.com/signup)에서 만듭니다.
- 본인 Cloudflare 계정. 계정이 없다면 [Cloudflare 가입](https://dash.cloudflare.com/sign-up)에서 만듭니다.
- [GitHub Desktop](https://desktop.github.com/) 앱. 설치한 뒤 본인 GitHub 계정으로 로그인합니다.
- Finder에 있는 통합 원본 `folio-github` 폴더.
- 따로 전달된 `FOLIO 관리자 접속 코드.txt` 파일. 관리자 화면에 들어가는 비밀번호입니다.

현재 컴퓨터에서는 위 폴더를 그대로 사용합니다. 별도로 받은 `FOLIO-배포파일.zip`을 사용하는 경우에는 압축을 풀고, 안에 있는 `folio-github` 폴더를 사용합니다. 이 ZIP에는 편집용 원본도 들어 있으므로 본인이 보관하고, 방문객에게는 완성된 사이트 주소를 공유하세요.

## 2. 사이트 폴더를 GitHub에 올리기

GitHub에서 사이트 파일을 보관하는 공간을 ‘저장소’, 영어로 Repository라고 부릅니다.

1. **GitHub Desktop**을 엽니다.
2. 맥 상단 메뉴에서 **File → Add Local Repository…**를 누릅니다.
3. **Choose…**를 누르고 `folio-github` 폴더를 선택합니다. Finder에서 해당 폴더를 선택 창으로 끌어와도 됩니다.

4. **Add Repository**를 누릅니다. 현재 컴퓨터의 폴더는 이 단계에 맞게 준비해두었습니다. 압축을 새로 푼 폴더에서 ‘This directory does not appear to be a Git repository’가 나오면 **create a repository here instead?**를 누르고 기존 폴더 안에 저장소를 만듭니다.
5. 왼쪽 **Changes**에서 파일 목록이 보이면 아래 **Summary**에 `사이트 첫 업로드`를 적습니다.
6. **Commit to main**을 누릅니다. 이름과 이메일 설정을 묻는다면 본인 GitHub 계정 정보를 사용합니다. Commit은 변경 내용을 한 번 저장하는 버튼입니다.
7. 위쪽 **Publish repository**를 누릅니다.
8. Name은 `folio-github`로 둡니다. **Keep this code private**에 체크한 상태로 **Publish Repository**를 누릅니다. 저장소가 비공개여도 방문자는 공개 사이트를 열 수 있습니다. 공개 저장소를 선택하면 누구나 GitHub에서 미공개 작품을 포함한 원본과 변경 이력을 볼 수 있습니다.
9. **Repository → View on GitHub**를 누릅니다. 브라우저에 본인 저장소가 열립니다.

**이 단계가 끝나면** 주소가 `https://github.com/본인아이디/folio-github` 형태로 보이고, Code 탭에 `dist`, `admin`, `scripts`, `.github` 등이 보입니다.

## 3. 방문자가 보는 사이트 주소 만들기

1. [Cloudflare 대시보드](https://dash.cloudflare.com/)에 로그인합니다.
2. **Workers & Pages**를 엽니다. 메뉴를 찾기 어려우면 대시보드 검색에서 `Workers & Pages`를 찾습니다.
3. **Create application → Pages → Connect to Git**를 선택합니다. 화면에 Pages 시작 링크가 따로 표시되면 그 링크를 선택합니다.
4. **GitHub**를 선택하고 계정 연결을 허용합니다. 저장소를 선택하는 화면에서 방금 만든 `folio-github`를 선택합니다.
5. 설정 화면에 다음 값을 넣습니다. Root directory는 저장소 최상위를 사용합니다.

   | 화면의 항목 | 넣을 값 |
   | --- | --- |
   | Project name | 원하는 영문 이름. 예를 들어 `my-folio` |
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | `node scripts/build-public.mjs` |
   | Build output directory | `public-site` |
   | Root directory | 최상위 그대로, 별도 폴더 지정 없이 진행 |

6. 환경 변수인 **Environment variables**에서 아래 두 값을 추가합니다. 값의 글자까지 그대로 입력합니다.

   | 이름 | 값 |
   | --- | --- |
   | `NODE_VERSION` | `24` |
   | `SKIP_DEPENDENCY_INSTALL` | `1` |

7. **Save and Deploy**를 누릅니다. 화면이 완료될 때까지 기다립니다.
8. 표시된 `https://my-folio.pages.dev` 형태의 주소를 누릅니다. 실제 주소의 앞부분은 본인이 선택한 이름에 따라 달라집니다.

Pages 연결 화면과 환경 변수는 공식 안내에서도 확인할 수 있습니다. [Git 연결과 배포 설정](https://developers.cloudflare.com/pages/get-started/git-integration/), [Node 버전·의존성 설치 설정](https://developers.cloudflare.com/pages/configuration/build-image/)

**이 단계가 끝나면** 방문자 주소에 직접 공개한 작업이 보입니다. 예시 전시가 켜진 초기 견본은 책 세 권과 예시 프로젝트 일곱 개를 보여줍니다. 본인 설정을 저장한 뒤에는 공개한 작업이 없으면 빈 목록으로 열립니다.

`dist`는 관리자가 작성하는 원본 폴더입니다. Cloudflare가 배포할 때마다 `public-site`를 새로 만들어 공개 작품, 소개·연락처, 화면에 필요한 파일을 담습니다. 예시 전시를 끄면 견본 이미지도 배포에서 빠집니다. 이 폴더는 자동 생성되므로 직접 관리할 필요가 없습니다.

<a id="connect-admin"></a>

## 4. 관리자가 파일을 저장할 권한 만들기

관리자는 책을 올릴 때 그 파일을 GitHub 저장소에 저장합니다. 이를 허용하는 키를 한 번 만들어야 합니다. 이 키는 관리자 로그인 비밀번호와 용도가 다릅니다.

1. [GitHub 저장 권한 만들기](https://github.com/settings/personal-access-tokens/new)를 엽니다.
2. **Token name**에 `FOLIO 관리자`를 적습니다.
3. **Expiration**에서 유효기간을 정합니다. 유효기간이 끝나면 이 단계에서 새 키를 만들어 교체하면 됩니다.
4. **Resource owner**는 저장소를 만든 본인 계정으로 둡니다.
5. **Repository access → Only select repositories**를 선택합니다.
6. 목록에서 `folio-github`만 선택합니다.
7. **Repository permissions**에서 **Contents → Read and write**를 선택합니다.
8. **Generate token**을 누릅니다. 조직 계정의 승인이 필요한 경우 승인을 완료한 뒤 사용합니다.
9. 생성된 긴 문자열을 복사해 안전하게 임시 보관합니다. 아래에서 `FOLIO_GITHUB_TOKEN`에 넣을 값입니다.

설정 화면을 다시 찾으려면 GitHub 개인 **Settings → Developer settings → Personal access tokens → Fine-grained tokens**를 엽니다. [GitHub 토큰 만들기](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

<a id="cloudflare-admin-credentials"></a>

## 5. Cloudflare 관리자 배포 권한 준비하기

1. Cloudflare의 **Workers & Pages**로 돌아갑니다.
2. **Your subdomain** 옆 **Change** 또는 `workers.dev` 설정에서 원하는 하위 주소를 정합니다. 이 주소로 관리자 페이지를 열게 됩니다.
3. 대시보드 검색을 열고 `Copy account ID`를 입력한 뒤 결과를 선택해 계정 ID를 복사합니다. **Workers & Pages → Account Details → Account ID**에서도 복사할 수 있습니다. 아래의 `CLOUDFLARE_ACCOUNT_ID`에 넣을 값입니다.
4. [Cloudflare API Tokens 화면](https://dash.cloudflare.com/profile/api-tokens)을 엽니다. 대시보드에서는 우상단 프로필의 **My Profile → API Tokens**에서 같은 화면으로 들어갈 수 있습니다. **Create Token**을 누릅니다.
5. 권한 템플릿에서 **Edit Cloudflare Workers**를 선택합니다. 화면에 **Use template**가 보이면 누릅니다.
6. 사용할 Cloudflare 계정으로 범위를 지정하고 토큰을 만듭니다.
7. 생성된 문자열을 복사합니다. 아래의 `CLOUDFLARE_API_TOKEN`에 넣을 값입니다.

각 화면의 위치는 Cloudflare 공식 안내를 기준으로 합니다. [관리자 기본 주소](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [계정 ID 복사](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/), [사용자 API 토큰 만들기](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

## 6. 네 개의 비밀값 입력하기

1. 브라우저에서 GitHub의 `본인아이디/folio-github` 저장소를 엽니다.
2. 위쪽 **Settings**를 누릅니다.
3. 왼쪽 **Secrets and variables → Actions**로 들어갑니다.
4. **Secrets** 탭에서 **New repository secret**를 누릅니다.
5. 아래 표의 Name과 Secret을 하나씩 입력하고 **Add secret**를 누릅니다. 총 네 번 반복합니다.

   | Name에 그대로 입력 | Secret에 붙여넣을 내용 |
   | --- | --- |
   | `FOLIO_ADMIN_CODE` | `FOLIO 관리자 접속 코드.txt` 안의 한 줄 |
   | `FOLIO_GITHUB_TOKEN` | 4단계에서 만든 GitHub 저장 권한 키 |
   | `CLOUDFLARE_ACCOUNT_ID` | 5단계에서 복사한 Cloudflare 계정 ID |
   | `CLOUDFLARE_API_TOKEN` | 5단계에서 만든 Cloudflare 배포 권한 키 |

이 값들은 여기에 입력하면 됩니다. 프로젝트 파일에 비밀번호나 권한 키를 적어 올리는 절차는 없습니다. 배포용 압축 파일에도 실제 접속 코드와 로컬 비밀 설정은 포함되어 있지 않습니다.

GitHub의 **Secrets** 탭에서 네 이름이 모두 등록됐는지 확인하세요. 저장한 값은 다시 표시되지 않으므로 교체할 때는 해당 항목을 갱신합니다. [GitHub 저장소 비밀값 설정](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets?tool=webui)

## 7. 관리자 주소 만들기

1. GitHub 저장소 위쪽의 **Actions**를 누릅니다.
2. 왼쪽에서 **Publish FOLIO admin**을 선택합니다.
3. **Run workflow**를 누릅니다. Branch는 `main`으로 두고 실행합니다.
4. 실행 항목을 열어 초록색 체크가 표시될 때까지 기다립니다.
5. Cloudflare **Workers & Pages**로 돌아가서 새로 생긴 **folio-admin**을 선택합니다.
6. 화면에 표시되는 `workers.dev` 주소 뒤에 `/admin`을 붙여 접속합니다.
7. `FOLIO 관리자 접속 코드.txt` 안의 코드를 입력합니다.

**이 단계가 끝나면** 아래 두 주소를 갖게 됩니다.

| 주소 | 사용 용도 |
| --- | --- |
| `https://선택한이름.pages.dev` | 방문자에게 알려줄 포트폴리오 주소 |
| `https://folio-admin.본인하위주소.workers.dev/admin` | 본인이 책과 작업을 관리하는 주소 |

실제로 생성된 주소를 각각 북마크해두세요. 현재 미리보기에 사용한 `127.0.0.1` 주소는 본인 컴퓨터의 확인용 주소입니다.

이후 책·작업·소개를 추가하거나 수정할 때는 관리자 주소를 엽니다. 일상적인 등록은 관리자에서 **저장**하면 공개 사이트 배포까지 이어집니다. **Publish FOLIO admin**은 관리자 프로그램이나 비밀값을 바꿀 때 다시 실행합니다.

<a id="admin-security"></a>

### 접속 코드는 어디까지 보호하나요?

| 상황 | 실제 동작 |
| --- | --- |
| 누군가 관리자 주소를 알고 있음 | 로그인 화면은 열립니다. 처음 접속한 사람은 코드 없이 편집 화면, 등록한 자료의 관리자 미리보기, 저장·삭제 기능을 사용할 수 없습니다. |
| 내가 로그인한 컴퓨터를 다른 사람이 사용함 | 같은 브라우저에서는 최대 4시간 동안 코드를 다시 입력하지 않고 관리할 수 있습니다. 공용 기기에서는 사용을 마친 뒤 **로그아웃**하세요. |
| 코드를 계속 틀림 | Cloudflare에서 같은 접속 IP의 시도를 60초당 8회 기준으로 제한합니다. 지역별 집계이므로 정확히 여덟 번을 전 세계에서 합산하는 방식은 아닙니다. 제한 기능을 사용할 수 없는 경우에는 새 로그인을 중단합니다. [Cloudflare 로그인 제한의 동작 방식](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |
| 코드가 유출됐거나 로그인한 기기를 잃어버림 | 새 무작위 코드를 만들어 GitHub의 **Settings → Secrets and variables → Actions → FOLIO_ADMIN_CODE**를 교체하고 **Publish FOLIO admin**을 다시 실행하세요. 새 코드로 배포되면 기존 로그인도 무효가 됩니다. |
| GitHub나 Cloudflare 계정으로 직접 접근함 | 해당 계정에 부여한 권한은 관리자 코드와 별개입니다. 두 계정에는 각각 2단계 인증을 켜고, GitHub 저장 키는 이 저장소 하나에만 권한을 주세요. |

새 코드는 비밀번호 관리자의 생성기로 영문 대소문자·숫자를 섞어 64자로 만들 수 있습니다. 먼저 본인 비밀번호 관리자에 보관하세요. 맥의 로컬 관리자는 별도의 `.dev.vars` 값을 읽으므로, 로컬 코드도 바꾸려면 이 값을 갱신한 뒤 로컬 관리자를 다시 켜세요. 이어 올리기용 초안과 파일은 로그아웃 후에도 그 브라우저에 남을 수 있으므로, 작품 등록은 본인 기기에서 진행하세요.

**연결 직후 직접 확인하기** — 시크릿 창에서 관리자 주소를 열어 로그인 화면이 표시되는지 보세요. 같은 창에서 관리자 주소의 `/admin`을 `/api/catalog`로 바꾸면 로그인 필요 응답이 나옵니다. 방문자 주소에서는 공개한 작품 하나를 열어보세요. 공개했던 사진을 나중에 숨겨도 이전 배포 주소와 이미 내려받은 사본은 별도로 남을 수 있습니다.

## 8. 소개와 연락처부터 입력하기

1. 관리자 상단의 **사이트 설정**을 누릅니다.
2. 사이트 이름을 입력합니다. 국문·영문 이름을 다르게 표시할 수 있습니다. 저장에 성공하면 로그인한 관리자 상단과 브라우저 탭에도 반영됩니다.
3. About의 **국문 소개**, **영문 소개**를 각각 입력합니다. 소개 페이지는 두 언어를 함께 보여주며, 선택한 언어가 왼쪽에 표시됩니다. 이미지는 선택 사항입니다.
4. Contact의 국문·영문 안내를 각각 입력합니다. 방문자 화면에는 입력한 두 안내가 함께 보이고, 선택한 언어가 먼저 나옵니다. 이메일과 인스타그램 계정은 한 번씩만 입력하세요. 인스타그램 칸에 `studio.name` 또는 `@studio.name`을 저장하면 방문자가 `@studio.name`을 눌러 프로필을 열 수 있습니다. 기존 프로필 주소도 사용할 수 있습니다. 국문·영문 안내 문장 안에 쓴 `@계정명`도 해당 프로필로 연결됩니다.
5. **저장**을 누릅니다.
6. 공개 사이트에서 새로고침해 확인합니다. Cloudflare가 배포하는 동안 잠시 기다려야 할 수 있습니다.

기본 언어는 한글입니다. 상단 **(ENG)**를 누르면 메뉴·태그·연도 필터가 영어로 표시되고 버튼이 **(한글)**로 바뀝니다. 선택한 언어를 브라우저에 기억합니다. 영문을 입력하지 않은 작업 항목에는 국문 내용이 표시됩니다.

<a id="add-work"></a>

## 9. 책과 프로젝트 등록하기

**포스터 한 장으로 먼저 해보세요.**

1. 내 관리자 주소에서 **작업 관리 → 작업 추가 +**를 누릅니다.
2. **유형**은 **프로젝트**를 고르고 **국문 제목**에 작업 이름을 적습니다. 영문 페이지에서 다른 이름을 보여주고 싶다면 **영문 제목**도 입력합니다.
3. **연도**에 `2025`처럼 제작 연도를 네 자리로 적고, **프로젝트 태그**에서 **포스터**를 선택합니다. 사진 작업을 함께 했다면 **사진**도 선택할 수 있습니다.
4. 작업 이미지를 선택합니다. 연습할 때는 `dist/assets/examples`에 있는 `afterimage.webp`를 첫 번째로, `afterimage-detail.webp`를 두 번째로 넣어보세요. 첫 장이 목록의 썸네일이 되고, 상세 화면에는 두 장이 순서대로 보입니다. 가로 사진과 세로 포스터 모두 원래 비율로 넣으면 됩니다. 순서는 저장 전에 바꿀 수 있습니다.
5. **공개**에 체크하고 저장합니다. 배포가 끝나면 방문자 주소에서 **작업** 메뉴를 열고 **분류**에서 **포스터**를 골라 방금 올린 작업을 확인합니다. 이후에는 이 다섯 단계만 반복하면 됩니다.

<a id="prepare-files"></a>

### 책 파일 준비

책 한 권을 등록하려면 유형을 **책**으로 선택하고 아래 파일을 준비하세요. 파일 이름은 한글로 지어도 되며 책마다 크기와 비율이 달라도 됩니다.

| 책을 등록할 때 | 준비할 것 |
| --- | --- |
| 제목·소개 | 국문·영문을 각각 입력. 영문은 선택 항목 |
| 표1 | 재단선과 인쇄용 여백을 제외한 앞표지 JPG·PNG·WebP |
| 표4·책등 | 면마다 별도 이미지. 선택 항목 |
| 내지 | 읽는 순서의 암호 없는 PDF 한 파일 |
| 제본 방식 | 무선 제본·양장·중철·노출사철 중 선택 |
| 실제 크기 | 재단 가로·세로와 책등 두께를 mm로 입력. 선택 항목 |
| 프로젝트 이미지 | 제작 사진·펼침면 사진 등 추가 이미지. 선택 항목 |

표4는 표1과 같은 재단 비율로, 책등은 실제 책등 비율로 준비합니다. 일반 프로젝트·소개 이미지도 JPG·PNG·WebP를 사용합니다. 관리자에서 미리보기를 보고, 여러 이미지는 위·아래 버튼으로 순서를 정한 뒤 저장하세요.

인디자인에서 **파일 → 내보내기 → Adobe PDF(인쇄)**를 선택합니다. **일반 → 페이지(Pages)**로 내보내고, 별도 PDF 파일 만들기를 끕니다. 표시 및 도련에서 인쇄 표시를 끄고 도련을 사방 0 mm로 설정합니다. 한 PDF에 낱장이 순서대로 들어 있게 만든 뒤 관리자에서 **한 쪽씩**을 선택합니다. 원래 두 쪽이 붙어 있는 PDF는 **두 쪽 펼침면**을 선택합니다.

뷰어는 PDF의 첫 페이지부터 두 쪽씩 묶습니다. 처음 보여줄 펼침면의 왼쪽 페이지가 PDF의 첫 페이지가 되도록 준비합니다. 의도한 빈 쪽도 포함합니다.

일반 프로젝트는 유형을 **프로젝트**로 선택하고 이미지와 국문·영문 설명을 입력합니다. 첫 이미지가 Project 목록의 썸네일이 됩니다. 책은 앞표지를 썸네일로 사용합니다.

큰 앞표지나 프로젝트의 첫 이미지는 목록용 작은 미리보기를 자동으로 준비합니다. 상세에서는 큰 웹 이미지를 보여줍니다. 기존에 등록한 자료도 계속 사용할 수 있으며, 별도 썸네일 파일을 준비할 필요는 없습니다.

내지는 변환 후 책 한 권당 최대 **1,000쪽**, 일반 프로젝트는 최대 **1,000장**까지 등록합니다. 업로드용으로 변환된 이미지 한 장의 상한은 **10MiB**입니다. 큰 사진은 자동으로 크기와 용량을 조절하므로 우선 원래 비율의 파일로 준비하고, 오류가 표시되면 해당 파일을 확인하세요.

온라인 관리자에서 **저장**하면 파일이 GitHub에 저장되고 Cloudflare Pages가 공개 사이트를 자동 갱신합니다. 화면에 **이 컴퓨터에 저장**이 보이면 로컬 관리자를 사용 중이므로 이 컴퓨터의 미리보기에서 바로 결과를 확인하세요. [방문자 화면 안내](#visitor-guide)

### 태그와 연도 관리하기

- **작업 관리 → 수정**에서 각 작업의 **프로젝트 태그**를 여러 개 고르고 **연도**를 입력합니다. 연도 선택지는 공개한 작업의 값으로 자동 생성됩니다. 제목 아래 태그나 연도를 누르면 같은 작업을 모아 볼 수 있습니다.
- **사이트 설정 → 프로젝트 태그**에서 태그의 한글·영어 이름과 순서를 바꾸거나 새로 추가할 수 있습니다. 사용 중인 태그는 먼저 해당 작업에서 선택을 해제한 뒤 삭제하세요. 이름만 바꾸면 기존 작업에도 새 이름이 표시됩니다.
- **세부 분류 · 국문**과 **세부 분류 · 영문**은 ‘사진 에세이’처럼 상세 화면에 표시할 자유로운 설명입니다. 방문자가 누르는 필터는 **프로젝트 태그**에서 정합니다.
- 방문자는 **작업**에서 분야와 연도를 함께 고를 수 있습니다. 필터를 적용한 후에도 작업은 관리자가 지정한 순서대로 보입니다.

<a id="visitor-guide"></a>

## 방문자 화면과 필터 초기화

| 메뉴 | 방문자가 보는 내용 |
| --- | --- |
| 소개 / About | 국문·영문 소개를 함께 표시. 선택한 언어가 먼저 보입니다. |
| 작업 / Project | 책과 일반 프로젝트를 관리자가 정한 순서로 표시. **분류**와 **연도**를 함께 고를 수 있습니다. |
| 책장 / Book shelf | 등록한 책을 모아 표시. 책을 고르면 표지를 돌려보고 **읽기**로 들어갑니다. |
| 연락처 / Contact | 국문·영문 안내를 함께 표시. 이메일, 인스타그램 계정, 추가 링크는 두 언어에서 공유합니다. |

작업 목록의 책 표지는 3D 책 상세로, 일반 프로젝트는 이미지와 설명이 있는 상세로 연결됩니다. 컴퓨터에서는 내지를 두 쪽 펼침면으로 봅니다. 모바일에서는 왼쪽 페이지부터 읽고 다음 페이지로 이동합니다. 옆 페이지의 일부도 함께 보입니다.

**전체 작업으로 돌아가려면** 분류와 연도를 모두 **전체**로 고르거나, 상단 **작업 / Project** 또는 좌상단 로고를 누릅니다. 상세 화면의 **목록으로 돌아가기**를 누르면 들어가기 전에 골랐던 분류·연도로 돌아갑니다. 상세의 태그는 같은 분류를, 연도는 같은 제작 연도를 모아 보여줍니다.

목록에서 작업이 보이지 않으면 먼저 두 필터 값을 확인하세요. 언어 전환은 메뉴·제목·설명을 바꾸며, 선택한 분류와 연도는 유지합니다.

<a id="maintenance"></a>

## 평소 관리 방법

- **수정**으로 제목·소개·이미지 등을 바꿉니다. 텍스트만 수정하면 기존 파일을 재사용합니다.
- 목록의 **위로·아래로** 버튼으로 공개 순서를 정합니다.
- **공개** 체크를 해제하고 저장하면 다음 배포부터 해당 작품의 정보와 전용 이미지가 방문자용 사이트에서 빠집니다. 다른 공개 작업이 함께 사용하는 이미지는 유지됩니다. GitHub 원본과 과거 배포, 이미 내려받은 사본은 별도로 남습니다.
- 긴 PDF는 **일시 정지** 후 **이어서 저장**할 수 있습니다. 같은 브라우저·관리자 주소에서 새로고침하면 저장한 진행 상황을 불러옵니다. 원본 재선택 안내가 뜨면 같은 PDF나 이미지를 선택하세요.
- GitHub가 잠시 업로드를 제한하면 재개 시간을 표시합니다.
- 로그인 만료로 저장이 멈추면 **다시 로그인**한 뒤 임시 작업을 이어갑니다. 결과 확인이 필요한 저장은 **저장 확인** 버튼으로 다시 확인합니다.
- 프로그램을 업데이트할 때는 [새 ZIP 적용 방법](#update-program)에 따라 공개한 작품과 새 공용 파일을 함께 반영합니다.
- 접속 코드나 권한 키를 교체할 때도 Secrets를 갱신한 뒤 **Publish FOLIO admin**을 다시 실행합니다.

### 포트폴리오 서체

방문자 화면은 Adobe 웹 프로젝트 하나에서 **Noto Sans CJK KR**과 **ITC Avant Garde Gothic Pro**를 불러옵니다. 영문 제목은 **Bold (700)**, 부제와 작업 유형은 **Book Oblique (300)**입니다. 한글 글꼴은 페이지에 필요한 글자를 그때그때 불러옵니다. 관리자 화면은 기기에 설치된 기본 서체를 사용합니다. [Adobe의 한글 웹폰트 제공 방식](https://helpx.adobe.com/kr/fonts/web/web-design-and-development/dynamic-subsetting.html)

현재 Adobe 웹 프로젝트 ID는 `gwz2aiq`입니다. 같은 프로젝트에서 굵기를 추가하면 Adobe에서 변경 사항을 저장하는 것만으로 반영됩니다. 나중에 프로젝트 자체를 교체할 때는 새 JavaScript 주소를 `dist/index.html`, `dist/404.html`, `dist/_headers`에서 바꾸세요. 서체도 변경한다면 `dist/style.css`의 `--type`에 새 영문·국문 서체의 CSS 이름을 차례로 입력합니다. GitHub Desktop에서 **Commit to main → Push origin**을 누르면 Cloudflare Pages에 반영됩니다. [Adobe 웹 프로젝트 안내](https://helpx.adobe.com/kr/fonts/web/introduction/add-fonts-website.html)

<a id="update-program"></a>

### 공개 중인 사이트에 새 ZIP 적용하기

**기존 Pages에 한 번 적용할 설정입니다.** Cloudflare에서 **Workers & Pages → 내 Pages 프로젝트 → Settings → Build configuration**을 열고, Build command에 `node scripts/build-public.mjs`, Build output directory에 `public-site`를 입력해 저장하세요. Production과 Preview에 별도 설정이 있다면 같은 값을 지정하세요. 아래 파일을 올린 뒤 **Deployments**에서 새 배포 성공을 확인하세요. 이미 새 파일을 올린 경우에는 해당 커밋의 배포를 다시 실행하세요. 예전 `dist` 방식으로 배포한 주소에는 당시 파일이 남을 수 있으므로 미공개 자료가 있었으면 이전 배포와 저장소 공개 설정도 확인하세요. [Pages 빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/)

GitHub Desktop에서 먼저 **Fetch origin**을 누르고, **Pull origin**이 뜨면 눌러 관리자가 올린 최신 작업을 내 컴퓨터에도 받습니다. 새 ZIP의 `folio-github` 폴더와 기존 저장소 폴더를 나란히 열어 아래 표에 따라 파일을 복사합니다.

| 경로 | 적용 방법 |
| --- | --- |
| `dist/catalog.json` | 현재 저장소의 작업·소개·연락처 정보를 사용 |
| `dist/assets/books/`, `dist/assets/projects/`, `dist/assets/site/` | 현재 저장소에 올린 책·프로젝트·소개 이미지 폴더를 보관 |
| `dist/assets` 바로 아래의 공용 파일과 `dist/assets/examples/` | 새 ZIP의 파일을 추가하고, 같은 이름의 공용 파일은 새 파일로 교체 |
| 그 밖의 프로그램 파일 | 새 ZIP의 파일로 교체 |

예를 들어 새 ZIP에 `forest-cover.webp` 같은 공용 이미지가 추가됐다면 함께 복사합니다. GitHub Desktop의 **Changes**에서 본인이 등록한 작품 파일이 삭제되는 항목이 없는지 확인한 뒤 **Commit to main → Push origin**으로 올립니다. 관리자 프로그램도 바뀌었다면 **Publish FOLIO admin**을 다시 실행합니다.

<a id="troubleshooting"></a>

## 막혔을 때 확인하기

| 보이는 상태 | 확인할 곳 |
| --- | --- |
| Cloudflare 공개 배포 실패 | Pages 설정에서 Build command `node scripts/build-public.mjs`, Build output directory `public-site`, 환경 변수 두 개 확인 |
| Publish FOLIO admin에 빨간 표시 | 실패한 실행을 열어 네 개의 Secrets 이름과 값을 확인 |
| 관리자 코드가 맞지 않음 | `FOLIO_ADMIN_CODE` 확인 후 관리자 배포를 다시 실행 |
| 책 저장 권한 오류 | GitHub 토큰 유효기간, 저장소 선택, Contents Read and write 확인 |
| 저장했는데 공개 사이트에 아직 안 보임 | Cloudflare Pages의 Deployments에서 최신 배포 완료 확인 후 새로고침 |
| 저장한 작업 중 일부만 목록에 보임 | 관리자에서 **공개** 체크 확인. 방문자 화면의 분류·연도를 **전체**로 초기화 |
| 사이트 설정을 저장한 뒤 예시가 사라짐 | 첫 저장으로 예시 전시가 끝난 상태. [작업 등록](#add-work)에서 본인 자료 추가 |
| 새로고침 후 원본을 다시 고르라는 안내 | 같은 브라우저에서 이전과 같은 PDF·이미지 선택. 브라우저 저장 공간을 지웠다면 파일 재선택 필요 |
| 다른 창에서 수정했다는 안내 | 입력은 임시 저장되어 있습니다. 최신 목록을 불러온 뒤 다시 확인 |

<a id="free-operation"></a>

## 무료 범위와 백업

아래 수치는 2026년 11월 19일 공식 문서 확인 기준입니다. 기본 주소를 사용하면 도메인 구입비가 없습니다.

| 확인할 항목 | 무료 범위와 이 사이트의 동작 |
| --- | --- |
| 공개 사이트 파일 | Pages Free는 사이트당 **20,000개**, 파일당 **25MiB**. 이 프로젝트는 배포 전에 검사합니다. |
| 공개 사이트 갱신 | Pages Free는 **월 500회 빌드**. 한 번에 등록한 PDF는 최종 저장 뒤 한 번 배포됩니다. |
| 관리자 요청 | Workers Free는 계정당 **하루 100,000회**. 이 관리자에서는 로그인, 화면 파일, 미리보기와 저장 요청이 포함됩니다. |
| GitHub의 자동 검사·관리자 배포 | 비공개 저장소는 계정의 월 기본 제공 사용량에서 차감됩니다. 공개 저장소의 표준 실행 환경은 무료입니다. |

GitHub Free 개인 계정의 월 기본 제공 연산 사용량은 **미화 12달러 상당**입니다. 결제수단이 없으면 제공량을 다 쓴 뒤 추가 사용이 중단됩니다. 이미 결제수단을 등록했다면 GitHub **Settings → Billing & licensing → Budgets and alerts**에서 Actions 초과 사용을 차단하는 예산을 확인하세요. 일반 방문자가 사이트를 보는 동안에는 GitHub Actions가 실행되지 않습니다. [GitHub Actions 요금 및 초과 사용](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Pages 한도](https://developers.cloudflare.com/pages/platform/limits/) · [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/)

관리자는 참조 이미지 합계를 **19,000개**까지 허용해 프로그램 파일 공간을 남깁니다. 여기에 목록용 축소 미리보기도 포함됩니다. 방문자가 여는 공개 화면은 Pages에서 제공하고, 관리자가 사용하는 별도 주소는 Workers에서 처리합니다.

PDF는 관리자 브라우저에서 한 쪽씩 긴 변 **2,000px**의 읽기용 이미지로 변환합니다. 표지·사진은 긴 변 **2,200px** 안으로 조절하고, 큰 파일은 **2MiB** 정도를 목표로 압축합니다. 2MiB는 압축 목표이며 변환 후 파일 상한은 10MiB입니다. 원본 PDF·인디자인 파일은 본인 컴퓨터와 별도 백업에 보관하세요. 스캔 책은 한 권부터 등록해 휴대폰과 컴퓨터에서 작은 글자까지 읽히는지 확인하면 됩니다.

이어 올리기 자료는 해당 브라우저에 저장합니다. 인터넷에 등록한 작품은 GitHub에 남고, 브라우저 저장 공간을 지우면 진행 중인 임시 파일은 다시 선택해야 할 수 있습니다.

**책 원본을 모두 더해 1GB가 넘어도, 그 숫자만으로 유료 플랜이 필요해지지는 않습니다.** 여기서 공개되는 것은 페이지별 웹 이미지입니다. 300쪽짜리 책 네 권이라면 내지 이미지는 약 1,200개이고 표지·목록용 미리보기·프로젝트 사진이 추가됩니다. 무료 범위를 판단할 때는 변환 후 파일 수·개별 크기·저장 빈도를 함께 보세요. 스캔본을 자주 통째로 교체하면 GitHub에는 예전 이미지 이력도 쌓입니다. GitHub는 저장소의 압축 이력을 10GB 이내로 유지할 것을 권장합니다. [GitHub 저장소 안내](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)

[Cloudflare Pages 공식 연결 안내](https://developers.cloudflare.com/pages/get-started/git-integration/) · [Pages 무료 한도](https://developers.cloudflare.com/pages/platform/limits/) · [Workers 무료 한도](https://developers.cloudflare.com/workers/platform/limits/) · [GitHub Desktop 안내](https://docs.github.com/en/desktop/overview/creating-your-first-repository-using-github-desktop)

<a id="local-admin"></a>

<details>
<summary>내 컴퓨터에서 관리자와 미리보기 다시 실행하기</summary>

터미널에서 `folio-github` 폴더를 열어 아래 명령을 실행합니다. Node.js 24와 pnpm 11.25.0을 사용합니다. 첫 설치에는 `pnpm install --frozen-lockfile`이 필요합니다.

```sh
pnpm run dev:admin:local
```

이 터미널을 열어 둔 채 [로컬 관리자](http://127.0.0.1:8787/admin)에 접속합니다. 이 컴퓨터에는 접속 코드가 설정돼 있습니다. 다른 컴퓨터에서 처음 실행할 때는 프로젝트 폴더의 `.dev.vars` 파일에 `ADMIN_CODE=본인의접속코드` 형식으로 설정합니다. 영문·숫자·밑줄·하이픈으로 된 43~128자 코드를 사용하세요. 이 파일은 본인 컴퓨터에 보관합니다.

분리된 두 저장소를 사용하면 [분리형 로컬 실행 및 미리보기](SPLIT-HOSTING.md)를 따라주세요. 아래 설명은 통합 폴더를 기준으로 합니다. 같은 사이트 폴더에는 로컬 관리자 서버를 하나만 실행하세요. 저장한 작품은 `dist`에 보관되고, 이어 올리기에 필요한 임시 파일은 `.wrangler/local-admin`에 남습니다. 디스크를 정리할 때는 진행 중인 작업을 모두 저장하거나 취소하고 서버를 종료한 뒤 이 임시 폴더를 비울 수 있습니다.

미리보기도 다시 켜야 한다면 같은 폴더에서 터미널 창을 하나 더 열고 아래 명령을 실행한 뒤 [포트폴리오](http://127.0.0.1:8896/)를 엽니다.

```sh
python3 -m http.server 8896 --bind 127.0.0.1 --directory dist
```

GitHub 저장을 개발 환경에서 시험하려면 `pnpm run dev:admin`을 사용합니다. 이 모드는 `.dev.vars`에 `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH`를 별도로 설정하면 해당 저장소에 실제로 저장합니다.

</details>
