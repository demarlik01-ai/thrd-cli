# 아키텍처

## 개요

thrd-cli는 Meta의 Threads API (`graph.threads.net`)를 터미널에서 사용할 수 있도록 래핑한 TypeScript CLI 애플리케이션입니다. [twx-cli](https://github.com/user/twx-cli)와 유사한 모듈형 아키텍처를 따르며, 도메인별로 분리된 클라이언트 모듈을 가집니다.

### twx-cli와의 주요 차이점

| 항목 | twx-cli (X/Twitter) | thrd-cli (Threads) |
|------|---------------------|---------------------|
| 인증 | OAuth 1.0a (4개 크레덴셜, HMAC 서명) | OAuth 2.0 (단기 → 장기 토큰) |
| 포스트 생성 | 단일 POST 요청 | 2단계: 컨테이너 생성 → 퍼블리시 |
| 미디어 업로드 | 업로드 엔드포인트 | 외부 URL 참조 (업로드 없음) |
| 토큰 관리 | 정적 (만료 없음) | 60일 장기 토큰, 갱신 필요 |
| API 베이스 | `api.x.com/2/` | `graph.threads.net/v1.0/` |

## 프로젝트 구조

```
thrd-cli/
├── src/
│   ├── cli.ts              # 진입점, 커맨드 정의 (commander)
│   ├── config.ts            # 토큰 로딩, 검증, 갱신 로직
│   ├── auth.ts              # OAuth 2.0 플로우 (로컬 HTTP 서버로 콜백 처리)
│   └── client/
│       ├── index.ts         # ThreadsClient 베이스 — 토큰 인증, fetch, 레이트 리밋
│       ├── types.ts         # 공유 타입 정의
│       ├── posts.ts         # 포스트 생성 (컨테이너 + 퍼블리시), 삭제, 타임라인
│       ├── replies.ts       # 답글 관리 (목록, 숨기기/해제, 응답)
│       ├── profiles.ts      # 사용자 프로필 조회
│       └── insights.ts      # 미디어 및 계정 수준 인사이트
├── docs/
│   ├── ARCHITECTURE.md
│   └── ARCHITECTURE-ko.md
├── package.json
├── tsconfig.json
└── README.md
```

## 모듈 다이어그램

```
                    ┌──────────────┐
                    │   cli.ts     │
                    │  - 커맨드    │
                    │  - 출력      │
                    │  - 라우팅    │
                    └──────┬───────┘
                           │
         ┌─────────┬───────┼──────────┐
         ▼         ▼       ▼          ▼
  ┌──────────┐ ┌───────┐ ┌─────┐ ┌────────┐
  │config.ts │ │auth.ts│ │chalk│ │client/ │
  │ (토큰)   │ │(OAuth)│ │     │ ├────────┤
  └──────────┘ └───┬───┘ └─────┘ │index.ts│
                   │              │posts.ts│
                   │              │replies │
                   │              │profiles│
                   │              │insights│
                   │              └───┬────┘
                   │                  │
                   ▼                  ▼
            ┌────────────┐   ┌──────────────────┐
            │ 로컬 HTTP  │   │ graph.threads.net │
            │ (콜백 서버)│   │   (REST API)      │
            └────────────┘   └──────────────────┘
```

## 모듈

### `cli.ts` — 진입점 & 커맨드

commander를 사용하여 CLI 구조를 정의합니다.

**서브커맨드:**

| 커맨드 | 설명 |
|--------|------|
| `auth` | 대화형 OAuth 2.0 플로우 (브라우저 오픈, 로컬 콜백 서버 시작) |
| `refresh` | 장기 액세스 토큰 갱신 |
| `me` | 인증된 사용자 프로필 표시 |
| `post <text>` | 텍스트 포스트 생성 (컨테이너 → 퍼블리시) |
| `post --image <url> [text]` | 이미지 포스트 생성 |
| `post --video <url> [text]` | 비디오 포스트 생성 |
| `carousel <text> --media <urls...>` | 캐러셀 포스트 생성 (최대 10개) |
| `reply <thread-id> <text>` | 스레드에 답글 달기 |
| `delete <id>` | ID로 포스트 삭제 |
| `timeline` | 최근 스레드 표시 (페이지네이션 지원) |
| `replies <thread-id>` | 스레드의 답글 목록 |
| `hide <reply-id>` | 답글 숨기기 |
| `unhide <reply-id>` | 답글 숨기기 해제 |
| `insights [thread-id]` | 인사이트 표시 (미디어 또는 계정 수준) |

### `auth.ts` — OAuth 2.0 플로우

OAuth 2.0 인증 코드 플로우 전체를 처리합니다:

1. 설정 가능한 포트(기본: 3000)에서 임시 로컬 HTTP 서버 시작
2. 브라우저에서 `https://threads.net/oauth/authorize` 오픈:
   - `client_id` — Meta 개발자 대시보드의 앱 ID
   - `redirect_uri` — 로컬 콜백 URL
   - `scope` — 요청할 권한
   - `response_type=code`
3. 콜백에서 인증 코드 수신
4. `POST https://graph.threads.net/oauth/access_token`으로 단기 토큰 교환
5. `GET https://graph.threads.net/access_token?grant_type=th_exchange_token`으로 장기 토큰(60일) 교환
6. 장기 토큰과 만료 시간을 설정 파일에 저장

**스코프:**
- `threads_basic` — 프로필 정보 읽기
- `threads_content_publish` — 포스트 생성 및 삭제
- `threads_read_replies` — 답글 읽기
- `threads_manage_replies` — 답글 숨기기/해제
- `threads_manage_insights` — 인사이트 데이터 읽기

### `config.ts` — 토큰 관리

**토큰 저장:** `~/.config/thrd-cli/config.json`

```json
{
  "app_id": "...",
  "app_secret": "...",
  "access_token": "...",
  "user_id": "...",
  "expires_at": "2025-08-15T00:00:00Z"
}
```

**크레덴셜 해석 우선순위:**
1. 환경 변수 (`THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_ACCESS_TOKEN`)
2. 설정 파일 (`~/.config/thrd-cli/config.json`)

**토큰 갱신:** 장기 토큰은 60일 유효. 1일 후~만료 전까지 갱신 가능. CLI는 만료 7일 전에 경고합니다.

### `client/index.ts` — 베이스 클라이언트

`ThreadsClient`는 Bearer 토큰 인증으로 Node.js 네이티브 `fetch`를 래핑합니다.

**책임:**
- Bearer 토큰 Authorization 헤더
- 베이스 URL 관리 (`https://graph.threads.net/v1.0/`)
- 레이트 리밋 처리 (사용자당 시간당 250회, 앱당 48시간당 1,000회)
- JSON 응답 파싱 및 에러 핸들링
- 레이트 리밋 시 자동 재시도 (429) + 백오프

### `client/posts.ts` — 포스트 작업

Threads API는 **2단계 퍼블리싱 플로우**를 사용합니다:

1. **컨테이너 생성** — `POST /{user-id}/threads` (media_type + 콘텐츠)
2. **상태 확인** (선택) — `GET /{container-id}?fields=status` (미디어 포스트에 권장)
3. **퍼블리시** — `POST /{user-id}/threads_publish` (`creation_id={container-id}`)

**지원 미디어 타입:**
- `TEXT` — 텍스트 전용 포스트
- `IMAGE` — 단일 이미지 (JPEG, PNG; URL로 참조)
- `VIDEO` — 단일 비디오 (MP4, MOV; URL로 참조)
- `CAROUSEL` — 단일 포스트에 최대 10개 이미지/비디오

### `client/replies.ts` — 답글 관리

답글 제어는 포스트 생성 시 설정 가능:
- `everyone` (기본값)
- `accounts_you_follow`
- `mentioned_only`

### `client/insights.ts` — 인사이트

**미디어 수준 지표:** views, likes, replies, reposts, quotes

**계정 수준 지표:** views, likes, replies, reposts, quotes, followers_count, follower_demographics

## 인증 플로우

```
┌──────┐         ┌───────────┐        ┌──────────────┐
│ 사용자│         │ thrd-cli  │        │ Threads API  │
└──┬───┘         └─────┬─────┘        └──────┬───────┘
   │  thrd auth        │                     │
   │──────────────────>│                     │
   │                   │ 로컬 서버 시작      │
   │                   │ 브라우저 오픈 →     │
   │   브라우저 열림   │ /oauth/authorize    │
   │<──────────────────│                     │
   │                   │                     │
   │  사용자 인가      │                     │
   │──────────────────────────────────────-->│
   │                   │                     │
   │                   │  콜백 + code 수신   │
   │                   │<────────────────────│
   │                   │                     │
   │                   │  단기 토큰 교환     │
   │                   │────────────────────>│
   │                   │                     │
   │                   │  장기 토큰 교환     │
   │                   │────────────────────>│
   │                   │                     │
   │                   │  설정 파일 저장     │
   │  인증 완료!       │                     │
   │<──────────────────│                     │
```

## 레이트 리밋

| 제한 | 값 |
|------|-----|
| 사용자당 시간당 | 250 API 호출 |
| 앱당 48시간당 | 1,000 API 호출 (개발 단계) |
| 포스트 생성 | 24시간당 250개 |
| 답글 생성 | 24시간당 1,000개 |

## 의존성

| 패키지 | 용도 |
|--------|------|
| `commander` | CLI 인자 파싱 |
| `chalk` | 터미널 컬러 출력 |
| `open` | OAuth 플로우용 브라우저 오픈 |

**Node.js 내장 모듈:**
- `http` — OAuth용 로컬 콜백 서버
- `fetch` — HTTP 요청 (Node >= 18)
- `fs`, `path` — 설정 파일 관리
- `crypto` — OAuth state 파라미터 생성

## 설계 결정 사항

- **2단계 퍼블리싱 추상화**: `createPost()`가 컨테이너 생성, 상태 폴링, 퍼블리시를 단일 호출로 오케스트레이션 — API 복잡성을 CLI 레이어에서 숨김
- **별도의 `auth.ts` 모듈**: OAuth 2.0 플로우가 충분히 복잡하여 (로컬 서버, 브라우저, 토큰 교환) 독립 모듈로 분리 — 정적 OAuth 1.0a 크레덴셜을 쓰는 twx-cli와 다른 점
- **토큰 만료 추적**: 설정에 `expires_at`을 저장하여 토큰 만료 전 경고/자동 갱신 가능
- **함수형 모듈 패턴**: twx-cli와 동일 — 도메인 함수가 클라이언트를 첫 번째 인자로 받음
- **네이티브 fetch**: HTTP 라이브러리 의존성 없음 — Node >= 18
- **미디어 포스트 상태 폴링**: 이미지/비디오 컨테이너는 처리 시간이 필요할 수 있으므로, 퍼블리시 전에 상태를 폴링 (타임아웃 설정 가능)
- **캐러셀 전용 커맨드**: Threads에서 다중 미디어 포스트가 흔하므로 별도 서브커맨드로 지원
- **업로드 엔드포인트 없음**: Threads API는 미디어가 공개 URL에 호스팅되어야 함 — CLI가 이를 명확히 문서화하며 업로드 기능은 제공하지 않음
