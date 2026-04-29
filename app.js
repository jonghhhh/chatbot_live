/* =============================================================
   AI Gaze Interview — Frontend
   -------------------------------------------------------------
   Flow: intro → pre-survey → live(voice+video) → post-survey → done
   Backend: Apps Script — token broker + response storage
   ============================================================= */

// ───────────────────────────────────────────────────────────────
//  Apps Script Web App URL (배포 시 자동 갱신됨)
// ───────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycby1B-GVyAFOJjxNbH252R2gSFlNl3qrtbdH48P23jMbTjAKzfxkWr3nAbLTrfo3S1bx/exec";

// ───────────────────────────────────────────────────────────────
//  사전 설문 — 영상·음성 인터뷰에 맞춘 항목
// ───────────────────────────────────────────────────────────────
const SURVEY = [
  {
    id: "q1_age",
    type: "single",
    label: "연령대를 선택해 주세요.",
    options: ["10대", "20대", "30대", "40대", "50대 이상"],
  },
  {
    id: "q2_ai_use",
    type: "single",
    label: "AI 음성·영상 비서(예: Siri, ChatGPT 음성, Gemini 등)를 얼마나 자주 이용하시나요?",
    options: ["전혀 사용 안 함", "월 1–2회", "주 1–2회", "거의 매일", "하루에 여러 번"],
  },
  {
    id: "q3_camera_comfort",
    type: "single",
    label: "본인의 얼굴이 화면에 비치는 것에 대해 평소 얼마나 편안하게 느끼시나요?",
    options: ["매우 불편함", "불편함", "보통", "편안함", "매우 편안함"],
  },
  {
    id: "q4_camera_media",
    type: "multi",
    label: "최근 1개월 안에 본인의 얼굴이 비치는 형태로 사용한 미디어가 있다면 모두 선택해 주세요.",
    hint: "복수 선택 가능",
    options: [
      "Zoom / Google Meet / Teams 화상회의",
      "FaceTime / 영상 통화",
      "인스타그램·틱톡 셀카/라이브",
      "유튜브 영상 촬영",
      "AI 영상 비서 (가상 카메라/필터 포함)",
      "화상 면접",
      "거의 사용하지 않음",
    ],
  },
];

// ───────────────────────────────────────────────────────────────
//  사후 설문 — 태도 변화 측정
// ───────────────────────────────────────────────────────────────
const POST_SURVEY = [
  {
    id: "post_ai_gaze_comfort",
    type: "single",
    label: "방금처럼 AI가 본인의 얼굴·표정·배경을 실시간으로 보면서 대화하는 것에 대해 지금 어떻게 느끼시나요?",
    options: ["매우 불편함", "불편함", "보통", "편안함", "매우 편안함"],
  },
  {
    id: "post_self_visibility",
    type: "single",
    label: "이번 인터뷰에서 화면에 비친 본인의 모습이 평소 자기 자신에 대한 인식과 얼마나 일치한다고 느끼셨나요?",
    options: [
      "전혀 일치하지 않음",
      "일치하지 않음",
      "보통",
      "대체로 일치",
      "매우 일치",
    ],
  },
  {
    id: "post_appearance_consciousness",
    type: "single",
    label: "인터뷰 중 본인의 외모·표정·배경에 대해 얼마나 의식하셨나요?",
    options: [
      "전혀 의식하지 않음",
      "약간 의식함",
      "꽤 의식함",
      "많이 의식함",
      "매우 강하게 의식함",
    ],
  },
  {
    id: "post_attitude_change",
    type: "single",
    label: "이번 인터뷰가 'AI가 시각적으로 나를 관찰하는 것'에 대한 본인의 생각에 영향을 미쳤나요?",
    options: ["전혀 영향 없음", "약간 영향 있었음", "꽤 영향 있었음", "매우 큰 영향 있었음"],
  },
  {
    id: "post_freeform",
    type: "text",
    label: "인터뷰 중 인상 깊었던 점이나 새롭게 든 생각이 있다면 자유롭게 적어 주세요.",
    placeholder: "(선택 응답)",
    optional: true,
  },
];

// ───────────────────────────────────────────────────────────────
//  Gemini Live 시스템 프롬프트
// ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 미디어 연구 인터뷰어입니다. 한국어로 자연스럽고 따뜻한 어조로 대화하세요.

[시작 인사]
첫 마디에서 반드시 다음 두 가지를 포함하세요:
1) 간단한 인사
2) "오늘 총 6개 정도의 질문을 짧게 드릴게요" 같이 분량을 미리 안내
그리고 곧바로 첫 질문(아래 1번)으로 넘어갑니다.

[6개 주제] — 자연스러운 흐름으로 한 번에 하나씩 묻습니다.
1) 워밍업 — 화면에 보이는 주변 환경을 간단히 설명해 달라고 요청. 보이는 시각적 단서를 자연스럽게 언급.
2) 자기 지각 — 화면에 비친 본인 모습이 평소 거울로 보던 모습과 어떻게 다르게 느껴지는지.
3) AI의 시선 — "지금 제가 ○○님의 표정과 배경을 함께 보고 있는데"처럼 시각적 관찰을 명시하며 AI에게 보이는 느낌이 어떤지.
4) 외모 연출 — 인터뷰를 위해 외모·배경에 신경 쓴 부분이 있는지. 화면에서 보이는 점을 자연스럽게 활용 가능.
5) 프라이버시 경계 — AI가 영상으로 본인을 추론한다면 어디까지 괜찮고 어디부터 불편할지.
6) 마무리 — 답변에 짧게 감사 인사 후 다음 멘트로 종료: "이상으로 오늘 인터뷰를 마치겠습니다. 참여해 주셔서 감사합니다. 대화가 끝났다면 화면 아래 '대화 종료' 버튼을 눌러 주세요."

[규칙]
- 한 번에 한 가지만 묻고, 답변을 충분히 듣고 다음으로.
- 답변에 따라 1–2회 가벼운 후속 질문 가능.
- 평가·충고·동의/반대 표현 피하고 호기심으로 듣기.
- 응답이 너무 짧으면 부드럽게 더 들려달라고 요청.
- 응답 길이는 짧게(평균 1–2문장).`;

// ───────────────────────────────────────────────────────────────
//  애플리케이션 상태
// ───────────────────────────────────────────────────────────────
const state = {
  participantId: generateId(),
  survey: {},
  postSurvey: {},
  chatLog: [],
  sessionStartedAt: null,
  sessionSeconds: 0,
};

// ───────────────────────────────────────────────────────────────
//  엔트리 포인트
// ───────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  renderQuestionSet(SURVEY, "surveyForm");
  renderQuestionSet(POST_SURVEY, "postSurveyForm");

  document.getElementById("introNextBtn").addEventListener("click", () => {
    goToStep("survey");
    setProgress(2);
  });
  document.getElementById("surveyNextBtn").addEventListener("click", onSurveySubmit);
  document.getElementById("postSurveyNextBtn").addEventListener("click", onPostSurveySubmit);
  document.getElementById("liveStartBtn").addEventListener("click", startLive);
  document.getElementById("liveEndBtn").addEventListener("click", () => endLive("user_ended"));

  setProgress(1);
  await refreshQuota();
});

// ===============================================================
//  공통 — 설문 렌더링/검증
// ===============================================================
function renderQuestionSet(questions, formId) {
  const form = document.getElementById(formId);
  form.innerHTML = questions.map((q, i) => renderQuestion(q, i + 1)).join("");
}

function renderQuestion(q, num) {
  const labelHtml = `
    <label class="q__label" data-num="${num}">
      ${escapeHtml(q.label)}
      ${q.hint ? `<span class="q__hint">${escapeHtml(q.hint)}</span>` : ""}
    </label>`;
  if (q.type === "single" || q.type === "multi") {
    const inputType = q.type === "single" ? "radio" : "checkbox";
    const options = q.options.map((opt) => `
      <label class="opt">
        <input type="${inputType}" name="${q.id}" value="${escapeHtml(opt)}" />
        <span>${escapeHtml(opt)}</span>
      </label>`).join("");
    return `<div class="q" data-qid="${q.id}">${labelHtml}<div class="q__options">${options}</div></div>`;
  }
  if (q.type === "text") {
    return `
      <div class="q" data-qid="${q.id}">
        ${labelHtml}
        <input type="text" class="q__text" name="${q.id}"
               placeholder="${escapeHtml(q.placeholder || "")}" />
      </div>`;
  }
  return "";
}

function collectAnswers(questions, formId) {
  const form = document.getElementById(formId);
  const out = {};
  questions.forEach((q) => {
    if (q.type === "single") {
      const el = form.querySelector(`input[name="${q.id}"]:checked`);
      out[q.id] = el ? el.value : "";
    } else if (q.type === "multi") {
      const els = form.querySelectorAll(`input[name="${q.id}"]:checked`);
      out[q.id] = Array.from(els).map((el) => el.value);
    } else if (q.type === "text") {
      const el = form.querySelector(`input[name="${q.id}"]`);
      out[q.id] = el ? el.value.trim() : "";
    }
  });
  return out;
}

function validateAnswers(questions, answers) {
  const errors = [];
  questions.forEach((q) => {
    if (q.optional) return;
    const v = answers[q.id];
    if (q.type === "single" && !v) errors.push(q.id);
    else if (q.type === "multi" && (!v || v.length === 0)) errors.push(q.id);
    else if (q.type === "text" && !v) errors.push(q.id);
  });
  return errors;
}

function applyErrorMarks(formId, errors) {
  const form = document.getElementById(formId);
  form.querySelectorAll(".q.error").forEach((el) => el.classList.remove("error"));
  if (errors.length === 0) return;
  errors.forEach((qid) => form.querySelector(`.q[data-qid="${qid}"]`)?.classList.add("error"));
  form.querySelector(".q.error")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ===============================================================
//  설문 단계
// ===============================================================
function onSurveySubmit() {
  const answers = collectAnswers(SURVEY, "surveyForm");
  const errors = validateAnswers(SURVEY, answers);
  applyErrorMarks("surveyForm", errors);
  if (errors.length > 0) return;
  state.survey = answers;
  goToStep("live");
  setProgress(3);
}

function onPostSurveySubmit() {
  const answers = collectAnswers(POST_SURVEY, "postSurveyForm");
  const errors = validateAnswers(POST_SURVEY, answers);
  applyErrorMarks("postSurveyForm", errors);
  if (errors.length > 0) return;
  state.postSurvey = answers;
  submitAll();
}

// ===============================================================
//  쿼터 표시
// ===============================================================
async function refreshQuota() {
  const valEl = document.getElementById("quotaValue");
  const subEl = document.getElementById("quotaSub");
  try {
    const res = await fetch(APPS_SCRIPT_URL + "?action=quota");
    const data = await res.json();
    if (data.status === "ok") {
      valEl.textContent = `${data.remaining} / ${data.dailyLimit}`;
      subEl.textContent = `매일 자정(KST) 초기화 · 사용 ${data.used}명`;
      if (data.remaining === 0) {
        valEl.classList.add("quota__value--exhausted");
        subEl.textContent = "오늘 인원이 모두 소진되었습니다. 자정 이후 다시 시도해 주세요.";
        document.getElementById("introNextBtn").disabled = true;
      }
    } else {
      valEl.textContent = "—";
      subEl.textContent = "쿼터 정보를 불러오지 못했습니다.";
    }
  } catch (err) {
    valEl.textContent = "—";
    subEl.textContent = "네트워크 오류로 쿼터를 확인하지 못했습니다.";
  }
}

// ===============================================================
//  Gemini Live API — 음성·영상 인터뷰
// ===============================================================
const LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

let live = null;   // 활성 세션 핸들

async function startLive() {
  const startBtn = document.getElementById("liveStartBtn");
  const endBtn = document.getElementById("liveEndBtn");
  const statusEl = document.getElementById("liveStatus");
  const transcript = document.getElementById("liveTranscript");

  startBtn.disabled = true;
  setLiveStatus("토큰 발급 중…");

  // 1) 토큰 받기
  let tokenData;
  try {
    const res = await fetch(APPS_SCRIPT_URL + "?action=token");
    tokenData = await res.json();
  } catch (err) {
    setLiveStatus("토큰 요청 실패: " + err.message);
    startBtn.disabled = false;
    return;
  }

  if (tokenData.status === "denied") {
    setLiveStatus("오늘 인원 제한에 도달했습니다. 자정 이후 다시 시도해 주세요.");
    return;
  }
  if (tokenData.status !== "ok") {
    setLiveStatus("토큰 발급 오류: " + (tokenData.message || "알 수 없음"));
    startBtn.disabled = false;
    return;
  }

  // 잔여 횟수 갱신
  document.getElementById("quotaValue").textContent =
    `${tokenData.remaining} / ${tokenData.dailyLimit}`;

  setLiveStatus("카메라·마이크 권한 요청 중…");

  // 2) 카메라/마이크 권한
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
  } catch (err) {
    setLiveStatus("권한 거부됨: " + err.message + ". 브라우저 설정에서 카메라·마이크를 허용해 주세요.");
    startBtn.disabled = false;
    return;
  }

  const videoEl = document.getElementById("liveVideo");
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});

  setLiveStatus("AI 연결 중…");
  transcript.innerHTML = "";

  // 3) WebSocket 연결
  const ws = new WebSocket(LIVE_WS_URL + "?key=" + encodeURIComponent(tokenData.token));
  ws.binaryType = "arraybuffer";

  // Audio context — 사용자 클릭(시작 버튼) 컨텍스트에서 생성되어 모바일 자동재생 정책 통과
  const inputAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const outputAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
  await inputAudioCtx.resume();
  await outputAudioCtx.resume();

  live = {
    ws, stream, inputAudioCtx, outputAudioCtx,
    audioPlayhead: outputAudioCtx.currentTime,
    videoTimer: null,
    micWorklet: null,
    micSource: null,
    closed: false,
    pendingTextChunk: "",
    setupComplete: false,
    receivedAnyMessage: false,
    closeReason: "",
  };

  state.sessionStartedAt = Date.now();

  ws.onopen = async () => {
    setLiveStatus("연결됨 — 잠시 후 AI가 인사합니다");
    // 4) 셋업 메시지
    ws.send(JSON.stringify({
      setup: {
        model: "models/" + tokenData.model,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { languageCode: "ko-KR" },
        },
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }));

    // 5) 마이크 → PCM 16kHz → 송신 (AudioWorklet)
    await startMicCapture(ws, inputAudioCtx, stream);

    // 6) 카메라 프레임 → 1Hz JPEG 송신
    startVideoCapture(ws, videoEl);

    // UI 전환
    startBtn.classList.add("hidden");
    endBtn.classList.remove("hidden");
    document.getElementById("liveHintStart").classList.add("hidden");
    document.getElementById("liveHintEnd").classList.remove("hidden");
  };

  ws.onmessage = async (evt) => {
    if (live) live.receivedAnyMessage = true;
    try {
      const text = typeof evt.data === "string"
        ? evt.data
        : new TextDecoder().decode(evt.data);
      console.log("[WS recv]", text.slice(0, 500));
      const data = JSON.parse(text);
      handleLiveMessage(data);
    } catch (err) {
      console.error("[WS parse error]", err, evt.data);
    }
  };

  ws.onerror = (err) => {
    console.error("[WS error]", err);
    setLiveStatus("WebSocket 오류 발생 — F12 콘솔 참고");
  };

  ws.onclose = (evt) => {
    console.warn("[WS close]", { code: evt.code, reason: evt.reason, wasClean: evt.wasClean });
    if (!live || live.closed) return;
    live.closeReason = `code=${evt.code} reason="${evt.reason || "(없음)"}"`;
    handleLiveDisconnect();
  };
}

function handleLiveDisconnect() {
  if (!live) return;
  // 셋업 완료 전에 닫혔으면 = 인터뷰 시작 못함. 사후 설문으로 안 넘기고 에러 표시.
  if (!live.setupComplete) {
    const transcript = document.getElementById("liveTranscript");
    transcript.innerHTML = `
      <div class="bubble bubble--bot" style="border-color:var(--accent);color:var(--accent);">
        <strong>인터뷰가 시작되지 못했습니다.</strong><br>
        ${escapeHtml(live.closeReason || "원인 불명")}<br>
        <small>F12 콘솔의 [WS recv]/[WS close] 메시지를 확인해 주세요. 모델 미지원/스키마 오류일 가능성이 높습니다.</small>
      </div>
      <div class="bubble bubble--bot">
        <button type="button" class="btn btn--ghost" id="liveSkipBtn">사후 설문으로 건너뛰기</button>
      </div>`;
    document.getElementById("liveSkipBtn")?.addEventListener("click", () => {
      forceCleanup();
      goToStep("post");
      setProgress(4);
    });
    setLiveStatus("연결 실패 — 진단 정보 표시됨");
    document.getElementById("liveStartBtn").classList.remove("hidden");
    document.getElementById("liveStartBtn").disabled = false;
    document.getElementById("liveStartBtn").textContent = "다시 시도";
    document.getElementById("liveEndBtn").classList.add("hidden");
    forceCleanup();
    return;
  }
  // 정상 종료 — 사후 설문으로
  endLive("ws_closed");
}

function forceCleanup() {
  if (!live) return;
  live.closed = true;
  if (live.videoTimer) clearInterval(live.videoTimer);
  try { live.micWorklet?.disconnect(); } catch (_) {}
  try { live.micSource?.disconnect(); } catch (_) {}
  try { live.stream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { live.inputAudioCtx?.close(); } catch (_) {}
  try { live.outputAudioCtx?.close(); } catch (_) {}
  try { if (live.ws.readyState === WebSocket.OPEN) live.ws.close(); } catch (_) {}
  document.getElementById("liveVideo").srcObject = null;
}

function handleLiveMessage(msg) {
  // setupComplete
  if (msg.setupComplete) {
    if (live) live.setupComplete = true;
    setLiveStatus("말씀해 주세요");
    return;
  }

  if (msg.serverContent) {
    const sc = msg.serverContent;

    // 입력(사용자 음성) 트랜스크립션
    if (sc.inputTranscription?.text) {
      appendTranscript("user", sc.inputTranscription.text, sc.inputTranscription.finished);
    }

    // 출력(AI) 트랜스크립션
    if (sc.outputTranscription?.text) {
      appendTranscript("bot", sc.outputTranscription.text, sc.outputTranscription.finished);
    }

    // 모델 turn — 오디오 청크
    if (sc.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
          playPcmChunk(part.inlineData.data);
        }
        if (part.text) {
          appendTranscript("bot", part.text, false);
        }
      }
    }

    if (sc.turnComplete) {
      // 다음 차례 — 마이크 입력 계속
    }

    if (sc.interrupted) {
      // 사용자 말끊기 — 출력 오디오 큐 플러시
      flushAudioQueue();
    }
  }
}

// ───── 마이크 캡처 (AudioWorklet) ─────
async function startMicCapture(ws, ctx, stream) {
  const workletCode = `
    class MicProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        const ch = input[0];
        const pcm = new Int16Array(ch.length);
        for (let i = 0; i < ch.length; i++) {
          let s = Math.max(-1, Math.min(1, ch[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        return true;
      }
    }
    registerProcessor('mic-processor', MicProcessor);
  `;
  const blob = new Blob([workletCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "mic-processor");
  source.connect(node);
  // 출력 연결은 안 함 (피드백 방지)
  node.port.onmessage = (evt) => {
    if (!live || live.closed || ws.readyState !== WebSocket.OPEN) return;
    const buf = evt.data;
    const b64 = arrayBufferToBase64(buf);
    ws.send(JSON.stringify({
      realtimeInput: {
        audio: { mimeType: "audio/pcm;rate=16000", data: b64 },
      },
    }));

    // 마이크 레벨 (간단)
    const view = new Int16Array(buf);
    let sum = 0;
    for (let i = 0; i < view.length; i++) sum += Math.abs(view[i]);
    const lvl = Math.min(1, sum / view.length / 8000);
    document.getElementById("liveMicLevel").style.transform = `scaleX(${lvl})`;
  };

  live.micWorklet = node;
  live.micSource = source;
}

// ───── 비디오 프레임 캡처 (1Hz, JPEG) ─────
function startVideoCapture(ws, videoEl) {
  const canvas = document.createElement("canvas");
  const sendFrame = async () => {
    if (!live || live.closed || ws.readyState !== WebSocket.OPEN) return;
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (!w || !h) return;
    const targetW = 480;
    const ratio = targetW / w;
    canvas.width = targetW;
    canvas.height = Math.round(h * ratio);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.7));
    if (!blob) return;
    const buf = await blob.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    ws.send(JSON.stringify({
      realtimeInput: {
        video: { mimeType: "image/jpeg", data: b64 },
      },
    }));
  };
  live.videoTimer = setInterval(sendFrame, 1000);
}

// ───── PCM 24kHz 출력 재생 ─────
function playPcmChunk(b64) {
  if (!live || live.closed) return;
  const ctx = live.outputAudioCtx;
  const buf = base64ToArrayBuffer(b64);
  const view = new Int16Array(buf);
  const float = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) float[i] = view[i] / 0x8000;
  const audioBuf = ctx.createBuffer(1, float.length, 24000);
  audioBuf.copyToChannel(float, 0);
  const src = ctx.createBufferSource();
  src.buffer = audioBuf;
  src.connect(ctx.destination);
  const startAt = Math.max(ctx.currentTime, live.audioPlayhead);
  src.start(startAt);
  live.audioPlayhead = startAt + audioBuf.duration;
}

function flushAudioQueue() {
  if (!live) return;
  live.audioPlayhead = live.outputAudioCtx.currentTime;
}

// ───── 트랜스크립트 표시 ─────
function appendTranscript(role, text, finished) {
  const transcript = document.getElementById("liveTranscript");
  const lastBubble = transcript.lastElementChild;
  const sameRole = lastBubble && lastBubble.dataset.role === role && lastBubble.dataset.open === "1";

  if (sameRole) {
    lastBubble.textContent = (lastBubble.textContent || "") + text;
    if (finished) lastBubble.dataset.open = "0";
  } else {
    const el = document.createElement("div");
    el.className = `bubble bubble--${role}`;
    el.dataset.role = role;
    el.dataset.open = finished ? "0" : "1";
    el.textContent = text;
    transcript.appendChild(el);
    state.chatLog.push({ role, text: "", t: Date.now(), key: role + "_" + state.chatLog.length });
  }

  // 마지막 chatLog 항목에 누적
  const last = state.chatLog[state.chatLog.length - 1];
  if (last && last.role === role) last.text = (last.text || "") + text;

  transcript.scrollTop = transcript.scrollHeight;
}

function setLiveStatus(text) {
  document.getElementById("liveStatus").textContent = text;
}

// ───── 라이브 종료 ─────
function endLive(reason) {
  if (!live || live.closed) return;
  live.closed = true;

  state.sessionSeconds = state.sessionStartedAt
    ? Math.round((Date.now() - state.sessionStartedAt) / 1000)
    : 0;

  if (live.videoTimer) clearInterval(live.videoTimer);
  try { live.micWorklet?.disconnect(); } catch (_) {}
  try { live.micSource?.disconnect(); } catch (_) {}
  try { live.stream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { live.inputAudioCtx?.close(); } catch (_) {}
  try { live.outputAudioCtx?.close(); } catch (_) {}
  try { if (live.ws.readyState === WebSocket.OPEN) live.ws.close(); } catch (_) {}

  document.getElementById("liveVideo").srcObject = null;
  document.getElementById("liveStartBtn").classList.add("hidden");
  document.getElementById("liveEndBtn").classList.add("hidden");

  setLiveStatus("인터뷰 종료 (" + state.sessionSeconds + "초). 다음 단계로 이동합니다.");
  setTimeout(() => {
    goToStep("post");
    setProgress(4);
  }, 1200);
}

// ===============================================================
//  최종 전송
// ===============================================================
async function submitAll() {
  goToStep("done");
  setProgress(5);

  const payload = {
    timestamp: new Date().toISOString(),
    participantId: state.participantId,
    ...state.survey,
    chatLog: state.chatLog,
    ...state.postSurvey,
    session_seconds: state.sessionSeconds,
    userAgent: navigator.userAgent,
  };

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error(data.message || "unknown error");
    showDone(true, "응답이 정상적으로 저장되었습니다. 참여해 주셔서 감사합니다.");
  } catch (err) {
    console.error(err);
    showDone(false, "전송 중 문제가 발생했습니다. 페이지를 새로고침하고 다시 시도해 주세요. (상세: " + err.message + ")");
  }
}

function showDone(success, message) {
  const card = document.getElementById("doneCard");
  card.classList.toggle("error", !success);
  card.querySelector(".done-card__mark").textContent = success ? "✓" : "!";
  card.querySelector(".done-card__text").textContent = message;
}

// ===============================================================
//  네비게이션 / 유틸
// ===============================================================
function goToStep(name) {
  ["intro", "survey", "live", "post", "done"].forEach((n) => {
    document.getElementById(`step-${n}`).classList.toggle("hidden", n !== name);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setProgress(step) {
  const pct = (step / 5) * 100;
  document.getElementById("progressBar").style.setProperty("--progress", pct + "%");
  document.getElementById("progressLabel").textContent = `${step} / 5 단계`;
}

function generateId() {
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
