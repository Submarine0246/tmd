/* ---------- Utils ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const fmtTime = (d = new Date()) =>
  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

/* ---------- App State ---------- */
const state = {
  freeSeconds: storage.get("freeSeconds", 10 * 60), // 10분 체험
  presence: "온라인",
  mode: "라이트 상담",
  mood: "안정",
  avatarStatus: "준비됨",
  currentChar: storage.get("currentChar", { id: "shima", name: "shima", tag: "기본" }),
  customize: storage.get("customize", {
    hairColor: "#6b7cff", eyeColor: "#2b2b2b", outfit: "casual", tone: "gentle", interests: ""
  }),
  voiceEnabled: false,

  // 키워드 응답 맵(캐시)
  replies: {
    char: [],   // 현재 캐릭터용 [ {re:RegExp, text:string}, ... ]
    common: []  // default용
  }
};

/* ---------- Bindings Renderer ---------- */
function renderBindings() {
  $$("[data-bind]").forEach(el => {
    const key = el.getAttribute("data-bind");
    if (key === "freeMinutes") el.textContent = Math.max(0, Math.ceil(state.freeSeconds / 60));
    else if (key === "avatarMood") el.textContent = moodToLabel(state.mood);
    else if (key === "modeLabel") el.textContent = state.mode;
    else if (key === "presence") el.textContent = state.presence;
    else if (key === "chatWithName") el.textContent = `${state.currentChar.name}(${state.currentChar.tag})`;
    else if (key === "year") el.textContent = new Date().getFullYear();
    else if (key === "avatarStatusText") el.textContent = state.avatarStatus;
  });
}

/* ---------- Chat ---------- */
const logEl = $("#chatLog");
const tplAI = $("#tplMsgAI");
const tplUser = $("#tplMsgUser");
const form = $("#chatForm");
const textarea = $("#chatText");

function appendMessage(type, text) {
  const tpl = type === "ai" ? tplAI : tplUser;
  const node = tpl.content.firstElementChild.cloneNode(true);
  $("p", node).textContent = text;
  $(".msg__time", node).textContent = fmtTime();
  logEl.appendChild(node);
  stickScroll();
}
function stickScroll() {
  logEl.scrollTo({ top: logEl.scrollHeight, behavior: "smooth" });
}

/* ---------- 키워드 응답 로딩 ---------- */
/**
 * HTML의 <script type="application/json" id="..."> 내용을 읽어서
 * { "키워드1|키워드2": "응답", ... } 형태를 [{re: RegExp, text: string}, ...]로 변환
 */
function loadReplySetById(id) {
  const node = document.getElementById(id);
  if (!node) return [];
  let obj = {};
  try {
    obj = JSON.parse(node.textContent.trim() || "{}");
  } catch {
    console.warn(`[HEARt] replies JSON 파싱 실패: #${id}`);
    return [];
  }
  const entries = Object.entries(obj);
  // 입력 순서 보존을 위해 map → 배열
  return entries.map(([pattern, text]) => {
    // 패턴을 부분일치/대소문자 무시로 처리
    // 예: "안녕|hello|hi" → /(안녕|hello|hi)/i
    const re = new RegExp(`(${pattern})`, "i");
    return { re, text };
  });
}

/**
 * 현재 캐릭터의 응답세트와 default 세트를 state.replies에 적재
 */
function reloadRepliesFor(charId) {
  state.replies.char = loadReplySetById(`replies-${charId}`);
  state.replies.common = loadReplySetById("replies-default");
}

/**
 * 텍스트에서 첫 매칭되는 응답을 캐릭터→공통 우선순위로 탐색
 */
function findKeywordReply(userText) {
  const t = userText.trim();
  if (!t) return null;

  const sets = [state.replies.char, state.replies.common];
  for (const set of sets) {
    for (const item of set) {
      if (item.re.test(t)) return item.text;
    }
  }
  return null;
}

/* ---------- 간단 감정/의도 분석(키워드 미매칭 시 백업 응답) ---------- */
function analyze(text) {
  const neg = /(외롭|lonely|힘들|sad|불안|우울|허전)/i.test(text);
  const pos = /(행복|좋아|기쁨|고마|설렘|괜찮)/i.test(text);
  const ask = /[?？]$/.test(text) || /(어떻게|될까|해도 될|무엇을)/.test(text);
  let mood = state.mood;
  if (neg) mood = "우려";
  else if (pos) mood = "밝음";
  return { neg, pos, ask, mood };
}
function fallbackByTone(userText) {
  const { neg, pos, ask, mood } = analyze(userText);
  state.mood = mood;
  const tone = state.customize.tone;
  const style = {
    gentle: ["천천히 말해줘도 괜찮아.", "네가 느끼는 감정은 중요한 신호야."],
    cheerful: ["내가 옆에서 응원할게!", "작게라도 잘한 점을 하나 찾아보자!"],
    calm: ["상황을 하나씩 정리해보자.", "호흡을 고르고 생각을 정리해보자."]
  }[tone] || [];

  if (neg) return `그렇게 느낄 수 있어. ${style[0] ?? ""} 지금 가장 마음을 눌러버리는 생각이 뭐였는지 한 문장으로만 적어줄래?`;
  if (pos) return `그 기분 좋다! ${style[1] ?? ""} 오늘 그 감정을 만든 요인을 기억해두면 다음에도 도움 될 거야.`;
  if (ask) return `내가 생각하는 선택지는 몇 가지가 있어. ① 지금 할 수 있는 아주 작은 행동 ② 도움을 요청할 사람 ③ 잠깐의 휴식. 어떤 것부터 시도해볼까?`;
  return `응, 계속 들어줄게. 장소·사람·감정(0~10) 중 하나만 먼저 말해줘도 좋아.`;
}

/* ---------- AI Reply ---------- */
function aiReply(userText) {
  // 1) 캐릭터 우선 → 공통 세트에서 키워드 검색
  const matched = findKeywordReply(userText);

  // 2) 상태/표정 업데이트
  state.avatarStatus = "생각 중…";
  renderBindings();
  drawAvatar();

  // 3) 응답 결정
  const reply = matched ?? fallbackByTone(userText);

  // 4) 출력
  setTimeout(() => {
    state.avatarStatus = "응답 중";
    renderBindings();
    appendMessage("ai", reply);
    state.avatarStatus = "대화 중";
    renderBindings();
    drawAvatar();
  }, 400 + Math.random() * 300);
}

/* ---------- Submit ---------- */
const chatForm = $("#chatForm");
const chatText = $("#chatText");

chatForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.freeSeconds <= 0) { openUpsell(); return; }
  const text = chatText.value.trim();
  if (!text) return;
  appendMessage("user", text);
  chatText.value = "";
  autoGrow(chatText);
  aiReply(text);
});

/* 텍스트 영역 자동 높이 */
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}
chatText?.addEventListener("input", () => autoGrow(chatText));

/* ---------- Free time countdown ---------- */
let timerId = null;
function startTimer() {
  if (timerId) return;
  timerId = setInterval(() => {
    if (document.hidden) return; // 비가시성 상태에서는 멈춤
    decrementTime(1);
  }, 2000);
}
function decrementTime(sec) {
  state.freeSeconds = Math.max(0, state.freeSeconds - sec);
  storage.set("freeSeconds", state.freeSeconds);
  renderBindings();
  if (state.freeSeconds <= 0) {
    $("#chatText").setAttribute("disabled", "true");
    $(".session-toolbar").innerHTML =
      `<span>무료 시간이 종료되었습니다.</span><button class="btn btn--primary" data-action="open-upsell">업그레이드</button>`;
  }
}

/* ---------- Dialogs / Actions ---------- */
const modalCharacters = $("#modalCharacters");
const modalCustomize = $("#modalCustomize");
const modalUpsell = $("#modalUpsell");
const modalSafety = $("#modalSafety");

function openCharacters() { modalCharacters?.showModal(); }
function openCustomize() { 
  const f = $("#customizeForm");
  if (f) {
    f.hairColor.value = state.customize.hairColor;
    f.eyeColor.value = state.customize.eyeColor;
    f.outfit.value = state.customize.outfit;
    f.tone.value = state.customize.tone;
    f.interests.value = state.customize.interests;
  }
  modalCustomize?.showModal();
}
function openUpsell() { modalUpsell?.showModal(); }
function openSafety() { modalSafety?.showModal(); }

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");

  if (action === "open-characters") openCharacters();
  if (action === "open-customize") openCustomize();
  if (action === "open-upsell") openUpsell();
  if (action === "open-safety") openSafety();
  if (action === "start-now") { $("#chatText")?.focus(); }
  if (action === "choose-character") {
    const active = $(".char-card.is-active") || $(".char-card[data-char-id='shima']");
    if (active) {
      const id = active.getAttribute("data-char-id");
      const name = $(".char-card__name", active).textContent.trim();
      const tag = $(".char-card__tag", active).textContent.trim();
      state.currentChar = { id, name, tag };
      storage.set("currentChar", state.currentChar);

      // 캐릭터 전환 시 응답 세트 재로딩
      reloadRepliesFor(state.currentChar.id);
      renderBindings();
      drawAvatar(true);

      appendMessage("ai", `${state.currentChar.name}로 전환했어. 키워드 기반 응답을 사용할게!`);
    }
    modalCharacters.close();
  }
  if (action === "apply-customize") {
    const f = $("#customizeForm");
    state.customize = {
      hairColor: f.hairColor.value,
      eyeColor: f.eyeColor.value,
      outfit: f.outfit.value,
      tone: f.tone.value,
      interests: f.interests.value.trim()
    };
    storage.set("customize", state.customize);
    drawAvatar(true);
    modalCustomize.close();
  }
  if (action === "choose-plan") {
    const plan = btn.closest(".plan-card")?.getAttribute("data-plan") || "plus";
    appendMessage("ai", `선택해줘서 고마워! (${plan}) 결제 플로우는 프로토타입에서는 생략되어 있어.`);
    modalUpsell.close();
  }
  if (action === "refresh-session") {
    state.freeSeconds = 10 * 60; storage.set("freeSeconds", state.freeSeconds);
    $("#chatText")?.removeAttribute("disabled");
    renderBindings();
    appendMessage("ai", "세션을 새로고침했어. 다시 시작해볼까?");
  }
  if (action === "toggle-voice") {
    state.voiceEnabled = !state.voiceEnabled;
    appendMessage("ai", state.voiceEnabled ? "음성 모드를 켰어. 마이크 접근 권한은 데모에서 생략!" : "음성 모드를 껐어.");
  }
  if (action === "open-login") appendMessage("ai", "로그인 화면은 프로토타입에선 더미야. 계속 체험해봐!");
  if (action === "open-signup") appendMessage("ai", "회원가입 플로우는 추후 연결될 예정이야.");
  if (action === "open-privacy") appendMessage("ai", "개인정보처리방침(더미): 실제 배포 시 링크로 대체.");
  if (action === "open-terms") appendMessage("ai", "이용약관(더미): 실제 배포 시 링크로 대체.");
  if (action === "open-contact") appendMessage("ai", "문의: support@heart.example (더미)");
});

/* 캐릭터 카드 active 토글 */
$("#characterList")?.addEventListener("click", (e) => {
  const card = e.target.closest(".char-card");
  if (!card) return;

  // active 표시
  $$(".char-card").forEach(c => c.classList.remove("is-active"));
  card.classList.add("is-active");

  // 선택한 캐릭터 정보 읽기
  const id = card.getAttribute("data-char-id");
  const name = $(".char-card__name", card).textContent.trim();
  const tag = $(".char-card__tag", card).textContent.trim();
  state.currentChar = { id, name, tag };
  storage.set("currentChar", state.currentChar);

  // 응답 세트 다시 로드
  reloadRepliesFor(state.currentChar.id);
  renderBindings();
  drawAvatar(true);

  appendMessage("ai", `${state.currentChar.name}로 전환했어. 이제 키워드 응답이 달라질 거야!`);

  // 모달 닫기
  modalCharacters.close();
});

/* ---------- Avatar Canvas (간단 표정 렌더러) ---------- */
const canvas = $("#avatarCanvas");
const ctx = canvas?.getContext?.("2d");

function drawAvatar(pulse = false) {
  if (!ctx) return;
  const { hairColor, eyeColor } = state.customize;
  const mood = state.mood;

  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // 배경 오라
  const grad = ctx.createRadialGradient(w*0.7, h*0.3, 10, w*0.7, h*0.3, w*0.9);
  grad.addColorStop(0, "rgba(107,124,255,0.25)");
  grad.addColorStop(1, "rgba(31,182,255,0.05)");
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);

  // 얼굴
  ctx.fillStyle = "#f2f5ff";
  ctx.strokeStyle = "rgba(0,0,0,.08)";
  ctx.lineWidth = 2;
  const faceR = 150;
  ctx.beginPath(); ctx.arc(w/2, h/2, faceR, 0, Math.PI*2); ctx.fill(); ctx.stroke();

  // 머리카락(상단 반원)
  ctx.fillStyle = hairColor;
  ctx.beginPath();
  ctx.arc(w/2, h/2 - 40, faceR+8, Math.PI, 0);
  ctx.lineTo(w/2 + faceR+8, h/2);
  ctx.arc(w/2, h/2, faceR+8, 0, Math.PI, true);
  ctx.closePath(); ctx.fill();

  // 눈
  ctx.fillStyle = eyeColor;
  const eyeY = h/2 - 10;
  const eyeDx = 52;
  const eyeR = 8;
  if (mood === "밝음") {
    ctx.lineWidth = 4; ctx.strokeStyle = eyeColor;
    ctx.beginPath(); ctx.arc(w/2 - eyeDx, eyeY, 10, 0, Math.PI, false); ctx.stroke();
    ctx.beginPath(); ctx.arc(w/2 + eyeDx, eyeY, 10, 0, Math.PI, false); ctx.stroke();
  } else if (mood === "우려") {
    ctx.fillRect(w/2 - eyeDx - 8, eyeY - 2, 16, 4);
    ctx.fillRect(w/2 + eyeDx - 8, eyeY - 2, 16, 4);
  } else {
    ctx.beginPath(); ctx.arc(w/2 - eyeDx, eyeY, eyeR, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(w/2 + eyeDx, eyeY, eyeR, 0, Math.PI*2); ctx.fill();
  }

  // 입
  ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.strokeStyle = "#e07ab6";
  ctx.beginPath();
  if (mood === "밝음") {
    ctx.arc(w/2, h/2 + 38, 20, 0, Math.PI, false);
  } else if (mood === "우려") {
    ctx.moveTo(w/2 - 18, h/2 + 48); ctx.lineTo(w/2 + 18, h/2 + 40);
  } else {
    ctx.moveTo(w/2 - 16, h/2 + 46); ctx.lineTo(w/2 + 16, h/2 + 46);
  }
  ctx.stroke();

  if (pulse) {
    let t = 0;
    const id = setInterval(() => {
      if (t > 8) return clearInterval(id);
      ctx.globalAlpha = 0.15;
      ctx.beginPath(); ctx.arc(w/2, h/2, faceR + 6 + t*8, 0, Math.PI*2); ctx.strokeStyle = hairColor; ctx.stroke();
      ctx.globalAlpha = 1;
      t++;
    }, 40);
  }
}

function moodToLabel(m) {
  return m === "밝음" ? "😄 밝음" : m === "우려" ? "😟 우려" : "🙂 안정";
}

/* ---------- Accessibility ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $$("dialog[open]").forEach(d => d.close());
  }
});

/* ---------- Init ---------- */
function init() {
  // 캐릭터/공통 키워드 세트 적재
  reloadRepliesFor(state.currentChar.id);

  renderBindings();
  drawAvatar(true);
  startTimer();
  autoGrow(chatText);

  // 최초 안내
  if (!storage.get("welcomed", false)) {
    setTimeout(() => {
      appendMessage("ai", "어서 와! 키워드(예: 외로워, 불안, 행복, 게임)를 넣으면 맞춤 응답이 나와. shima/nadesiko/aoi마다 응답이 달라!");
      storage.set("welcomed", true);
    }, 300);
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { renderBindings(); drawAvatar(); }
});

init();
