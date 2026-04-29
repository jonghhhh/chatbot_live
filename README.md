# AI 시선 인터뷰 — 음성·영상 챗봇 데모
*Vanilla JS · GitHub Pages · Google Apps Script · Gemini Live API*

스마트폰 또는 PC 카메라로 참여자의 얼굴과 배경을 보면서 AI가 한국어 음성으로 인터뷰하는 정적 웹 앱.
사전·사후 설문 결과와 인터뷰 트랜스크립트를 Google 스프레드시트에 누적 저장한다.
연구·교육 시연용 데모로, 일일 50명 인원 제한이 내장되어 있다.

---

## 1. 아키텍처

```
[모바일 브라우저]
   │  ① 설문 응답 + 카메라/마이크 권한
   │  ② Apps Script 호출 — 일일 쿼터 차감 + 단명 토큰 발급 요청
   ▼
[Apps Script (Code.gs)] ─── ③ Gemini API에 ephemeral token 발급
   │       (Properties Service에 GEMINI_API_KEY 보관)
   │  ④ 토큰 + 잔여 횟수 반환
   ▼
[브라우저] ─── ⑤ 토큰으로 Gemini Live WebSocket 직접 연결
                  (마이크 PCM 16kHz / 카메라 1Hz JPEG / 음성 24kHz 출력)
   │  ⑥ 인터뷰 종료 후 트랜스크립트 + 설문 POST
   ▼
[Apps Script] ─── ⑦ Google Sheets `responses` 시트에 행 추가
```

| 계층 | 도구 | 역할 |
|---|---|---|
| 프론트엔드 | Vanilla JS · WebAudio · WebSocket | 설문 UI, 라이브 인터뷰, 마이크/카메라 캡처 |
| 배포 | GitHub Pages | 정적 자산 (HTTPS 자동) |
| 백엔드 | Google Apps Script | 토큰 브로커 + 쿼터 관리 + 응답 저장 |
| LLM | Gemini Live API | 실시간 음성·영상 양방향 |
| 저장소 | Google Sheets | 트랜스크립트·설문 응답 누적 |

**보안 원칙**: GEMINI_API_KEY는 Apps Script Properties에만 보관되고, 클라이언트는 30분 단명 토큰만 받는다. 음성·영상 raw는 어디에도 저장되지 않으며 Gemini 처리 후 즉시 폐기.

---

## 2. 폴더 구조

```
chatbot_exp_jsapp/
├── index.html         ← 5단계 UI (intro/survey/live/post/done)
├── style.css          ← 스타일
├── app.js             ← 흐름 제어 + Gemini Live 클라이언트
├── Code.gs            ← Apps Script 백엔드 (토큰/쿼터/저장)
├── appsscript.json    ← Apps Script 매니페스트
├── package.json       ← clasp 스크립트 단축키
├── .env.example       ← 키 템플릿 (실제 .env는 gitignore)
├── .claspignore
├── .gitignore
└── README.md
```

---

## 3. 구축 순서

### 3-1. clasp 설치 및 인증 (1회)

```bash
npm install
npx clasp login        # WSL 경우 그냥 login. --no-localhost 사용 시 OOB 차단됨
```

> Apps Script API: https://script.google.com/home/usersettings 에서 ON

### 3-2. 시트 + Apps Script 프로젝트 생성

```bash
npm run create         # clasp create --type sheets ...
npm run push           # Code.gs / appsscript.json 푸시
```

### 3-3. Gemini API 키 등록

> **GEMINI_API_KEY는 Apps Script의 Script Properties에만 저장**한다. `.env` 파일은 *로컬 참고용*이며 GitHub Pages 정적 페이지는 `.env`를 읽지 못한다.

1. Google AI Studio (https://aistudio.google.com/apikey) 에서 API 키 발급
2. 로컬 `.env` 에 저장 (선택):
   ```
   GEMINI_API_KEY=AIza...
   ```
3. Apps Script 편집기 열기:
   ```bash
   npm run open
   ```
4. 좌측 톱니바퀴 (**프로젝트 설정**) → **스크립트 속성** → **속성 추가**
   - 속성 이름: `GEMINI_API_KEY`
   - 값: 위에서 발급받은 키
   - **저장** 클릭
5. 편집기에서 `_debug_checkApiKey` 함수 실행 → 실행 로그에 `GEMINI_API_KEY 설정됨` 표시되면 성공

### 3-4. 웹 앱 배포

```bash
npm run deploy         # 새 배포 ID 발급
npm run deployments    # /exec URL 확인
```

발급된 URL을 `app.js` 상단 `APPS_SCRIPT_URL` 에 입력.

> **첫 배포 시 1회만**: 편집기에서 `배포 → 배포 관리`로 들어가 액세스 권한을 **모든 사용자**로 변경. clasp는 이 옵션을 자동 적용 못 한다 (구글 정책).
> 또 첫 실행 권한 동의를 위해 `_debug_setup` 함수를 한 번 실행해 SpreadsheetApp + UrlFetch 권한을 부여.

### 3-5. GitHub Pages 배포

1. public 저장소 푸시 (`.env`는 `.gitignore`로 자동 제외)
2. Settings → Pages → Source: `Deploy from a branch / main / root`
3. 1–2분 후 `https://<user>.github.io/<repo>/` 접속 가능

> GitHub Pages는 HTTPS 자동 적용 — 모바일 카메라/마이크 권한이 작동하려면 HTTPS 필수.

---

## 4. 데이터 스키마

| 열 | 설명 |
|---|---|
| `timestamp` | 서버 수신 시각 |
| `participantId` | 익명 ID |
| `q1_age` | 연령대 |
| `q2_ai_use` | AI 음성·영상 비서 사용 빈도 |
| `q3_camera_comfort` | 본인 얼굴이 화면에 비치는 것에 대한 평소 편안함 (5점) |
| `q4_camera_media` | 최근 1개월 사용한 카메라 미디어 (다중) |
| `chat_log` | Gemini Live 대화 트랜스크립트 (JSON) |
| `post_ai_gaze_comfort` | 사후 — AI 시각적 관찰에 대한 편안함 (5점) |
| `post_self_visibility` | 사후 — 화면 속 자신과 자기 인식 일치도 (5점) |
| `post_appearance_consciousness` | 사후 — 외모·표정·배경 의식 강도 (5점) |
| `post_attitude_change` | 사후 — 인터뷰가 AI 시선 인식에 미친 영향 (4점) |
| `post_freeform` | 사후 — 자유 응답 (선택) |
| `session_seconds` | 라이브 인터뷰 지속 시간 (초) |
| `userAgent` | 브라우저 정보 |

음성·영상 raw는 **저장하지 않음**. 트랜스크립트만 보관.

---

## 5. 일일 쿼터

- 하루 50명 (KST 자정 기준 자동 초기화)
- `Code.gs`의 `DAILY_LIMIT` 상수로 조절
- 초기화 강제: 편집기에서 `_debug_resetQuota` 실행
- 잔여 횟수는 인트로 화면에 실시간 표시
- `?action=quota` (소비 없음) / `?action=token` (1회 차감) 분리

---

## 6. 프라이버시·동의 고지

본 데모는 IRB 심의 통과 연구가 아니라 **수업 시연용**이다. 실제 연구에서는 다음을 추가하라:

- 동의서(consent form) 페이지 별도 배치
- 음성·영상 처리 사실 명시 + Gemini의 데이터 사용 정책 링크
- 미성년자/취약 대상 제외 안내
- 원하는 시점 철회 가능 안내

`index.html` 인트로 섹션의 `intro__notes`를 수정해 안내 문구를 자유롭게 보강.

---

## 7. 동작 점검 체크리스트

- [ ] `_debug_checkApiKey` → "GEMINI_API_KEY 설정됨" 출력
- [ ] `?action=quota` GET → `{status:"ok", remaining:50, ...}` 응답
- [ ] `?action=token` GET → `{status:"ok", token:"...", remaining:49}` 응답
- [ ] 인트로 화면에서 "오늘 남은 인원 50/50" 표시
- [ ] 사전 설문 → 라이브 → 권한 허용 후 AI 음성 인사 들림
- [ ] 사후 설문 제출 후 시트에 새 행 추가
- [ ] 모바일(iOS Safari / Android Chrome)에서 동일하게 작동

---

## 8. clasp 명령 요약

| 스크립트 | 명령 | 용도 |
|---|---|---|
| `npm run login` | `clasp login` | Google 인증 |
| `npm run create` | `clasp create --type sheets ...` | 시트+스크립트 생성 |
| `npm run push` | `clasp push` | Code.gs 업로드 |
| `npm run pull` | `clasp pull` | 편집기 변경분 다운로드 |
| `npm run deploy` | `clasp deploy --description v1` | 새 웹 앱 배포 |
| `npm run deployments` | `clasp deployments` | 배포 URL 확인 |
| `npm run open` | `clasp open` | 편집기 열기 |
| `npm run open:sheet` | `clasp open --addon` | 시트 열기 |
| `npm run logs` | `clasp logs` | 실행 로그 |

---

## 9. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 토큰 발급 시 `api_key_not_configured` | Apps Script Script Properties에 `GEMINI_API_KEY` 미등록 — 3-3 절차 |
| `token_api_error code:400` | 모델명 (`GEMINI_MODEL`)이 잘못되었거나 키가 만료/철회됨 |
| `denied / daily_limit` | 50명 소진 — 자정 대기 또는 `_debug_resetQuota` |
| 카메라 권한 거부 | HTTPS 환경(GitHub Pages)에서만 권한 요청 가능. `file://` 또는 `http://`는 차단 |
| iOS Safari 음성 안 들림 | `오디오 컨텍스트는 사용자 클릭 후 resume()` 필요 — 시작 버튼 누른 후에만 연결 |
| WSL에서 clasp login 400 오류 | OOB 플로우 차단됨 — `--no-localhost` 빼고 `clasp login` 사용 |
