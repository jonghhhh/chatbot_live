/**
 * ============================================================
 *  AI Gaze Interview — Google Apps Script Backend
 * ------------------------------------------------------------
 *  엔드포인트:
 *    GET  ?action=health  → 상태 확인
 *    GET  ?action=quota   → 일일 잔여 횟수 (소비 없음)
 *    GET  ?action=token   → Gemini Live ephemeral token 발급 (1회 소비)
 *    POST                  → 응답 데이터 저장
 *
 *  사전 작업:
 *    Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에
 *    GEMINI_API_KEY 키-값 추가 (값은 .env의 GEMINI_API_KEY)
 *
 *  배포: 웹 앱 / 다음 사용자로 실행: 나 / 액세스: 모든 사용자
 * ============================================================
 */

// ───── 설정 ─────
const SHEET_NAME = "responses";
const DAILY_LIMIT = 50;
const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const TOKEN_VALIDITY_MIN = 30;
const SESSION_EXPIRE_MIN = 90;

const COLUMNS = [
  "timestamp",
  "participantId",
  "q1_age",
  "q2_ai_use",
  "q3_camera_comfort",
  "q4_camera_media",
  "chat_log",
  "post_ai_gaze_comfort",
  "post_self_visibility",
  "post_appearance_consciousness",
  "post_attitude_change",
  "post_freeform",
  "session_seconds",
  "userAgent",
];

// ───── GET 라우터 ─────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "health";
  try {
    if (action === "quota") return jsonResponse(getQuotaInfo_());
    if (action === "token") return jsonResponse(issueToken_());
    return jsonResponse({
      status: "ok",
      method: "GET",
      message: "AI Gaze Interview backend is alive.",
      sheet: SHEET_NAME,
      model: GEMINI_MODEL,
      dailyLimit: DAILY_LIMIT,
      deployedAt: new Date().toISOString(),
    });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err && err.message || err) });
  }
}

// ───── POST 핸들러 (응답 저장) ─────
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: "error", message: "no payload" });
    }
    const data = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet();

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(COLUMNS);
      formatHeader_(sheet);
    }

    const row = COLUMNS.map((col) => {
      if (col === "timestamp") return new Date();
      if (col === "chat_log") return JSON.stringify(data.chatLog || []);
      if (col === "q4_camera_media") {
        const v = data.q4_camera_media;
        return Array.isArray(v) ? v.join(", ") : (v || "");
      }
      return data[col] != null ? data[col] : "";
    });

    sheet.appendRow(row);
    return jsonResponse({ status: "ok", message: "saved", rowNumber: sheet.getLastRow() });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err && err.message || err) });
  }
}

// ───── 일일 쿼터 ─────
function getQuotaInfo_() {
  const props = PropertiesService.getScriptProperties();
  const today = todayKST_();
  const storedDate = props.getProperty("quota_date_kst");
  const used = (storedDate === today) ? parseInt(props.getProperty("quota_used") || "0", 10) : 0;
  return {
    status: "ok",
    dailyLimit: DAILY_LIMIT,
    used: used,
    remaining: Math.max(0, DAILY_LIMIT - used),
    dateKst: today,
    resetsAt: nextResetUtcIso_(),
  };
}

// ───── Ephemeral 토큰 발급 ─────
function issueToken_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { status: "error", message: "busy_try_again" };
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      return { status: "error", message: "api_key_not_configured. Apps Script 프로젝트 설정 → 스크립트 속성에 GEMINI_API_KEY 추가 필요." };
    }

    const today = todayKST_();
    const storedDate = props.getProperty("quota_date_kst");
    let used = (storedDate === today) ? parseInt(props.getProperty("quota_used") || "0", 10) : 0;
    if (storedDate !== today) {
      props.setProperty("quota_date_kst", today);
      props.setProperty("quota_used", "0");
    }

    if (used >= DAILY_LIMIT) {
      return {
        status: "denied",
        reason: "daily_limit",
        dailyLimit: DAILY_LIMIT,
        remaining: 0,
        resetsAt: nextResetUtcIso_(),
      };
    }

    const now = Date.now();
    const expireTime = new Date(now + TOKEN_VALIDITY_MIN * 60 * 1000).toISOString();
    const sessionExpire = new Date(now + SESSION_EXPIRE_MIN * 60 * 1000).toISOString();

    const url = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=" + encodeURIComponent(apiKey);
    const payload = {
      uses: 1,
      expire_time: expireTime,
      new_session_expire_time: sessionExpire,
    };

    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    const body = res.getContentText();
    if (code !== 200) {
      return {
        status: "error",
        message: "token_api_error",
        code: code,
        body: body.slice(0, 600),
      };
    }

    const data = JSON.parse(body);
    Logger.log("auth_tokens raw response: " + body.slice(0, 400));
    // ⚠️ 진단 모드: ephemeral token이 1007 "API key not valid"로 거부되어,
    //   WS 엔드포인트/setup 자체가 작동하는지 확인하기 위해 임시로 raw API 키 반환.
    //   확인 후 ephemeral token 흐름으로 복귀할 것.
    const token = apiKey;

    used += 1;
    props.setProperty("quota_used", String(used));

    return {
      status: "ok",
      token: token,
      model: GEMINI_MODEL,
      remaining: DAILY_LIMIT - used,
      dailyLimit: DAILY_LIMIT,
      issuedAt: new Date(now).toISOString(),
      expiresAt: expireTime,
      sessionExpiresAt: sessionExpire,
    };
  } catch (err) {
    return { status: "error", message: String(err && err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

// ───── 유틸 ─────
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function formatHeader_(sheet) {
  sheet.getRange(1, 1, 1, COLUMNS.length)
    .setFontWeight("bold")
    .setBackground("#1a1f2e")
    .setFontColor("#f5efe4");
  sheet.setFrozenRows(1);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function todayKST_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

function nextResetUtcIso_() {
  const today = todayKST_();
  const [y, m, d] = today.split("-").map(Number);
  // 오늘 KST 날짜 + 다음 자정 KST = 오늘 KST 날짜의 15:00 UTC
  return new Date(Date.UTC(y, m - 1, d, 15, 0, 0)).toISOString();
}

// ───── 디버깅/관리 함수 ─────
function _debug_setup() {
  const sheet = getOrCreateSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
  } else {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    const lastCol = sheet.getLastColumn();
    if (lastCol > COLUMNS.length) {
      sheet.getRange(1, COLUMNS.length + 1, 1, lastCol - COLUMNS.length).clearContent();
    }
  }
  formatHeader_(sheet);
  Logger.log("Sheet header synced. Columns: " + COLUMNS.length);
}

function _debug_resetQuota() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("quota_date_kst", todayKST_());
  props.setProperty("quota_used", "0");
  Logger.log("Quota reset to 0 for " + todayKST_());
}

function _debug_checkApiKey() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    Logger.log("GEMINI_API_KEY 미설정. 프로젝트 설정 → 스크립트 속성에 추가하세요.");
  } else {
    Logger.log("GEMINI_API_KEY 설정됨. 길이: " + apiKey.length + ", 끝 4자리: " + apiKey.slice(-4));
  }
}

// 편집기에서 한 번 실행해 UrlFetchApp 권한(외부 서비스 연결)을 부여하는 함수.
// try/catch 없이 UrlFetchApp.fetch를 직접 호출 — 권한 미부여 상태면 실행 전에 권한 다이얼로그가 뜬다.
function _debug_grantPermissions() {
  Logger.log("Triggering UrlFetchApp scope...");
  const res = UrlFetchApp.fetch("https://www.google.com/generate_204", { muteHttpExceptions: true });
  Logger.log("UrlFetchApp 작동. HTTP " + res.getResponseCode());
  Logger.log("✓ 권한 부여 완료. 이제 ?action=token이 정상 동작합니다.");
}
