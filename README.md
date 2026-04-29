# chatbot_live — AI Gaze Interview

> 카메라·마이크가 있는 모바일/PC 브라우저에서 **AI가 사용자 얼굴·표정·배경을 보면서 한국어 음성으로 인터뷰**하는 정적 웹 앱.
> 사전·사후 설문 + 라이브 트랜스크립트를 Google Sheets에 누적 저장한다.
> 일일 50명 인원 제한 내장. 미디어학·HCI·디지털 자아 연구 시연용.

**Stack**: Vanilla JS · WebSocket · WebAudio · Google Apps Script · Google Sheets · Gemini Live API (`gemini-3.1-flash-live-preview`)

---

## 1. 작동 흐름 (End-to-End)

```
[모바일/PC 브라우저]
    │
    ├─ ① 인트로 화면 → Apps Script ?action=quota → "오늘 남은 인원 N/50"
    │
    ├─ ② 사전 설문 4문항 (연령·AI 비서 사용·얼굴 노출 편안함·카메라 미디어)
    │
    ├─ ③ 라이브 단계
    │     a) "인터뷰 시작" 버튼 클릭 (사용자 제스처 — 모바일 오디오 자동재생 정책 통과)
    │     b) Apps Script ?action=token → 일일 쿼터 1회 차감 + Gemini API 키 반환
    │     c) getUserMedia() → 카메라(640×480) + 마이크(16kHz mono) 스트림 획득
    │     d) WebSocket 연결: wss://generativelanguage.googleapis.com/.../v1beta.GenerativeService.BidiGenerateContent
    │     e) setup 메시지 — 모델·언어(ko-KR)·시스템 프롬프트·입출력 transcription 활성
    │     f) 마이크 → AudioWorklet → PCM 16kHz Int16 → realtimeInput.audio (실시간 송신)
    │     g) 비디오 캔버스 캡처 → 1Hz JPEG 480px → realtimeInput.video
    │     h) 모델 응답 PCM 24kHz → AudioBuffer 큐에 시간순 재생 + 화면에 트랜스크립트 누적
    │     i) AI 마무리 멘트 → 사용자 "대화 종료" 클릭
    │
    ├─ ④ 사후 설문 5문항 (AI 시선 편안함·자기 일치도·외모 의식·태도 변화·자유응답)
    │
    └─ ⑤ POST /exec → 트랜스크립트(JSON) + 설문 + session_seconds → Sheets `responses`
```

```
[Google Apps Script (Code.gs)]
    │
    ├─ doGet  ?action=health  → 상태 확인
    ├─ doGet  ?action=quota   → 잔여 횟수 (소비 없음)
    ├─ doGet  ?action=token   → 키 반환 + LockService로 쿼터 1회 차감
    │                            (KST 자정 자동 초기화)
    └─ doPost                  → 응답 데이터 저장 (14컬럼 헤더 자동 생성)

[Properties Service]
    └─ GEMINI_API_KEY (Apps Script Project Settings → Script Properties)

[Google Sheets]
    └─ responses 시트 — 14개 열로 응답 누적
```

---

## 2. 폴더 구조 (저장소에 포함되는 파일만)

```
chatbot_live/
├── index.html         ← 5단계 SPA UI (intro / survey / live / post / done)
├── style.css          ← 밝은 톤 + 모바일 적응형
├── app.js             ← 흐름 제어 + Gemini Live WebSocket 클라이언트
├── Code.gs            ← Apps Script 백엔드 (clasp로 푸시)
├── appsscript.json    ← Apps Script 매니페스트 (oauthScopes 명시)
├── package.json       ← clasp 스크립트 단축키
├── .claspignore       ← Apps Script 푸시 제외 목록
├── .env.example       ← 키 템플릿 (실제 .env는 gitignore)
├── .gitignore
└── README.md
```

저장소 외부(개인 환경): `.env`, `.clasp.json`, `.clasprc.json`, `node_modules`, `package-lock.json`은 gitignore.

---

## 3. 구성 방법 (처음부터 끝까지)

### 3-1. 사전 준비

```bash
git clone https://github.com/jonghhhh/chatbot_live.git
cd chatbot_live
npm install                                  # @google/clasp 설치
```

- Node.js 18+ 필요
- Apps Script API 활성화: https://script.google.com/home/usersettings 에서 **Google Apps Script API** ON
- Gemini API 키 발급: https://aistudio.google.com/apikey 에서 새 키 생성

### 3-2. clasp 인증 + 시트·Apps Script 프로젝트 생성

```bash
npx clasp login                              # 브라우저 OAuth (WSL이면 --no-localhost 빼고)
npm run create                               # 시트 + 바인딩된 Apps Script 자동 생성
                                              # → .clasp.json 자동 생성 (gitignore)
npm run push                                 # Code.gs / appsscript.json 업로드
```

### 3-3. Gemini API 키를 Apps Script Properties에 등록

> 정적 호스팅(GitHub Pages)은 `.env`를 클라이언트에서 읽을 수 없다.
> 키는 **Apps Script Properties Service**(서버 측)에만 저장되고, 클라이언트는 백엔드를 통해 간접 사용한다.

1. `npm run open` → Apps Script 편집기 열림
2. 좌측 **⚙ 프로젝트 설정** → **스크립트 속성** → **속성 추가**
3. 속성 이름: `GEMINI_API_KEY`, 값: AI Studio에서 발급받은 키
4. **저장** 클릭
5. (선택) 로컬 `.env` 에도 동일한 키를 복사해 둔다 — 향후 자동화·기록용 (gitignore됨)
6. 함수 드롭다운에서 `_debug_checkApiKey` 실행 → 로그에 `GEMINI_API_KEY 설정됨` 확인

### 3-4. 권한 부여 (1회, UrlFetchApp 스코프)

Apps Script가 외부(generativelanguage.googleapis.com)를 호출하려면 사용자가 OAuth 동의해야 함.

1. 편집기에서 함수 드롭다운 → `_debug_grantPermissions` 실행
2. **권한 검토** 다이얼로그 → 본인 계정 → **고급 → 안전하지 않은 페이지로 이동 → 허용**
3. 권한 목록에 다음 포함 확인:
   - 외부 서비스에 연결 (`script.external_request`) — UrlFetchApp용
   - 스프레드시트 액세스 — 응답 저장용
4. 실행 로그에 `UrlFetchApp 작동. HTTP 204` + `✓ 권한 부여 완료` 확인
5. 이어서 `_debug_setup` 실행 → 시트 헤더가 14컬럼으로 동기화

### 3-5. 웹 앱 배포

```bash
npm run deploy                               # 새 배포 ID 발급
npm run deployments                          # /exec URL 확인
```

**첫 배포 1회만 (브라우저에서)**:
- 편집기 우측 상단 **배포 → 배포 관리** → 연필 아이콘
- **버전: 새 버전**, **다음 사용자로 실행: 나**, **액세스 권한이 있는 사용자: 모든 사용자**
- 저장 (URL 동일 유지)

발급된 `https://script.google.com/macros/s/.../exec` URL을 복사해 `app.js` 상단:
```js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/<당신의_배포_ID>/exec";
```

### 3-6. 백엔드 검증

```bash
# 1. 헬스체크
curl -sL "<APPS_SCRIPT_URL>"
# → {"status":"ok","method":"GET","model":"gemini-3.1-flash-live-preview","dailyLimit":50,...}

# 2. 쿼터 조회 (소비 없음)
curl -sL "<APPS_SCRIPT_URL>?action=quota"
# → {"status":"ok","dailyLimit":50,"used":0,"remaining":50,"dateKst":"2026-04-29",...}

# 3. 토큰 발급 (1회 차감)
curl -sL "<APPS_SCRIPT_URL>?action=token"
# → {"status":"ok","token":"AIza...","model":"...","remaining":49,...}
```

### 3-7. 로컬 테스트 (데스크톱)

```bash
python3 -m http.server 8000                  # 또는 npx serve
```

`http://localhost:8000` 접속. localhost는 브라우저가 secure context로 취급해 카메라·마이크 권한 동작.

### 3-8. GitHub Pages 배포

1. 이 저장소를 GitHub에 push (또는 fork)
2. 저장소 **Settings → Pages → Source: Deploy from a branch / main / root**
3. 1–2분 후 `https://<user>.github.io/chatbot_live/` 발급
4. **모바일 검증**: HTTPS 환경이라 `getUserMedia` 작동, 실기기(iOS Safari/Android Chrome)에서 끝-단 테스트

---

## 4. 데이터 스키마 (Sheet `responses`)

| 열 | 타입 | 설명 |
|---|---|---|
| `timestamp` | datetime | 서버 수신 시각 (KST) |
| `participantId` | string | 익명 ID `p_<base36>_<rand>` |
| `q1_age` | string | 연령대 |
| `q2_ai_use` | string | AI 음성·영상 비서 사용 빈도 |
| `q3_camera_comfort` | string | 평소 얼굴 노출 편안함 (5점) |
| `q4_camera_media` | string | 사용 미디어 (다중, 쉼표 구분) |
| `chat_log` | JSON | 라이브 트랜스크립트 `[{role, text, t, key}]` |
| `post_ai_gaze_comfort` | string | 사후 — AI 시각 관찰 편안함 (5점) |
| `post_self_visibility` | string | 사후 — 자기 인식 일치도 (5점) |
| `post_appearance_consciousness` | string | 사후 — 외모·배경 의식 (5점) |
| `post_attitude_change` | string | 사후 — 인터뷰 영향 (4점) |
| `post_freeform` | string | 사후 — 자유 응답 (선택) |
| `session_seconds` | number | 라이브 인터뷰 지속 시간 |
| `userAgent` | string | 브라우저 정보 |

**저장 안 하는 것**: 음성 raw, 비디오 프레임, 카메라 이미지. Gemini 처리 후 즉시 폐기.

---

## 5. 일일 쿼터 (50명 / 일)

- `Code.gs`의 `DAILY_LIMIT = 50` 상수로 조절
- KST 기준 자정 자동 리셋
- `LockService`로 동시 요청 안전 처리
- 인트로 화면에 실시간 잔여 표시
- 강제 리셋: 편집기에서 `_debug_resetQuota` 실행
- 쿼터 소진 시: 토큰 발급 거부 + `denied` 상태 반환 + 인트로 시작 버튼 비활성

---

## 6. 보안 모델 (현 상태 — 진단 모드)

> ⚠️ **현재 진단 모드에서 `Code.gs`의 `issueToken_`은 raw API 키를 클라이언트로 반환한다**. Gemini의 `auth_tokens` API의 v1beta 스키마가 아직 반영 못 되어 ephemeral token이 WS에서 거부되는 이슈를 우회한 임시 조치.

### 권장 보호 (배포 전 추가):

1. **GCP 콘솔에서 API 키 HTTP referrer 제한**:
   - https://console.cloud.google.com/apis/credentials
   - 해당 API 키 → **애플리케이션 제한사항 → HTTP 리퍼러**
   - `https://<user>.github.io/chatbot_live/*` 만 허용
2. **Apps Script 일일 쿼터 유지** — 50/일 한도가 키 도용 시 피해 한계로 작용
3. (장기) Gemini Live `auth_tokens` v1beta 스키마 정착 시 ephemeral token 흐름 복원

### 향후 ephemeral token 복원 방법

`Code.gs:issueToken_` 의 한 줄을 변경:
```js
const token = apiKey;                                    // ← 진단 모드 (현재)
// ↓ 복원
// const token = JSON.parse(body).name;                  // auth_tokens/XXX 풀네임
```

그리고 `payload`에 v1beta가 받는 정확한 constraint 필드 추가:
```js
const payload = { uses: 1, expire_time: ..., new_session_expire_time: ...,
                  /* 미정: live_connect_constraints / bidi_generate_content_setup */ };
```
(`live_connect_constraints`, `bidi_generate_content_setup` 모두 v1alpha 시기 필드명. v1beta에서는 다른 이름일 가능성)

---

## 7. 알려진 이슈 / 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `?action=token` → `api_key_not_configured` | Apps Script Properties에 `GEMINI_API_KEY` 미등록 — 3-3 절차 |
| `?action=token` → `code:401/403` | API 키 만료/철회. AI Studio에서 새로 발급 후 재등록 |
| `UrlFetchApp.fetch을(를) 호출할 수 있는 권한이 없습니다` | `_debug_grantPermissions` 미실행 — 3-4 절차 |
| WS 연결 시 `1007 API key not valid` | 배포가 갱신 안 됨. `npm run deploy -i <기존_배포ID>` 로 재배포 |
| WS 연결 시 `1007 realtime_input.media_chunks is deprecated` | `app.js`에서 `mediaChunks` 대신 `audio`/`video` 직접 필드 사용 (현재 적용됨) |
| WS 연결 시 `1006 abnormal closure` | WS 경로 잘못. `app.js:LIVE_WS_URL`의 v1beta 경로 확인 |
| 사후 설문으로 즉시 넘어감 | setup 미완료 상태에서 WS 종료. 콘솔의 `[WS close]` code/reason 확인 |
| iOS Safari 음성 안 들림 | `오디오 컨텍스트는 사용자 클릭 후 resume()` 필요. "인터뷰 시작" 버튼이 그 역할 |
| 카메라 권한 거부 | HTTPS(GitHub Pages) 또는 localhost 환경에서만 권한 요청 가능 |
| 토큰 발급은 되나 WS 1007 | 배포된 `Code.gs`가 구버전. `npm run deploy -i <ID>` 강제 재배포 |
| 인트로의 잔여 횟수가 `—` | Apps Script 권한 부여 안 됨 또는 CORS. 콘솔 fetch 에러 확인 |
| WSL `clasp login` 400 invalid_request | OOB OAuth 차단됨 — `--no-localhost` 빼고 시도 |

### 디버깅 함수 (Apps Script 편집기)

| 함수 | 용도 |
|---|---|
| `_debug_checkApiKey` | Properties에 키 등록 여부 확인 |
| `_debug_grantPermissions` | UrlFetchApp 스코프 부여 (1회) |
| `_debug_setup` | 시트 헤더를 현재 `COLUMNS`로 동기화 |
| `_debug_resetQuota` | 쿼터를 0/50으로 강제 리셋 |

---

## 8. 디자인 / UX

- **밝은 톤**: 종이 베이지(`#fcfaf5`) + 부드러운 벽돌색 액센트(`#b04848`)
- **세리프 헤더 + 산세리프 본문** (Noto Serif KR · IBM Plex Sans KR)
- **모바일 적응형**: ≤540px 단일 컬럼, 버튼 풀너비, 비디오 4:3 고정
- **5단계 진행바**: intro → survey → live → post → done
- **시작/종료 안내문**: 인터뷰 단계에 명시적 힌트 ("아래 버튼 누르세요")
- **시스템 프롬프트**: AI 첫 마디에 "총 6개 정도의 질문"을 미리 안내, 마지막에 "대화 종료 버튼" 안내

---

## 9. clasp 명령 요약

| npm 스크립트 | 명령 | 용도 |
|---|---|---|
| `npm run login` | `clasp login` | Google 인증 |
| `npm run create` | `clasp create --type sheets ...` | 시트+스크립트 생성 |
| `npm run push` | `clasp push` | Code.gs 업로드 |
| `npm run pull` | `clasp pull` | 편집기 변경분 다운로드 |
| `npm run deploy` | `clasp deploy --description v1` | 새 웹 앱 버전 배포 (URL 신규) |
| `npm run redeploy` | `clasp deploy` | (URL 유지하려면 `-i <기존_ID>` 추가) |
| `npm run deployments` | `clasp deployments` | 배포 URL 목록 |
| `npm run open` | `clasp open` | Apps Script 편집기 |
| `npm run open:sheet` | `clasp open --addon` | 응답 시트 |
| `npm run logs` | `clasp logs` | 실행 로그 |

---

## 10. 라이선스 / 윤리

- 본 데모는 **수업·시연용**. IRB 통과 연구 아님
- 실제 연구 적용 시 별도 동의서, 미성년자 보호, 데이터 보존 정책 첨부 필요
- Gemini API 사용은 Google의 [Generative AI Use Policies](https://ai.google.dev/gemini-api/terms) 준수 전제

---

## 11. 작동 검증 체크리스트 (Quickstart Verification)

- [ ] `_debug_checkApiKey` → "GEMINI_API_KEY 설정됨"
- [ ] `_debug_grantPermissions` → "UrlFetchApp 작동. HTTP 204"
- [ ] `_debug_setup` → "Sheet header synced. Columns: 14"
- [ ] `?action=quota` → `remaining:50`
- [ ] `?action=token` → `status:"ok"`
- [ ] 인트로 화면 — 잔여 50/50 표시
- [ ] 사전 설문 4개 → 다음 클릭 → 라이브 화면 전환
- [ ] 라이브 — 권한 허용 후 비디오 미리보기 + AI 한국어 인사 + "총 6개 질문" 안내
- [ ] 자유 대화 1–2분
- [ ] AI 마무리 멘트 후 "대화 종료" 버튼 클릭 → 사후 설문
- [ ] 사후 5개 응답 → 제출 → "응답이 정상적으로 저장되었습니다"
- [ ] 시트에 `chat_log` JSON + 14열 데이터 누적 확인
