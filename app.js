import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, setDoc, getDoc,
  onSnapshot, arrayUnion,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC6qoTjXhR0EYr91O5m5ZBa2q5UaY6MYeA",
  authDomain: "bloom-88.firebaseapp.com",
  projectId: "bloom-88",
  storageBucket: "bloom-88.firebasestorage.app",
  messagingSenderId: "958962681805",
  appId: "1:958962681805:web:4c073e3034b1c304a8a684",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------------- Health engine ---------------- */

const TYPE_POINTS = { message: 5, call: 12, video: 18 };
const DECAY_PER_DAY = 2;
const DAY_MS = 86400000;

function qualityMultiplier(q) { return 0.6 + (q - 1) * 0.2; }
function pointsForContact(type, quality) {
  return Math.round(TYPE_POINTS[type] * qualityMultiplier(quality));
}
function currentHealth(friend) {
  const now = Date.now();
  const last = friend.lastEventAt || friend.createdAt || now;
  const days = Math.max(0, (now - last) / DAY_MS);
  const decayed = (friend.healthScore ?? 0) - DECAY_PER_DAY * days;
  return Math.max(0, Math.min(100, Math.round(decayed)));
}
function stateForScore(score) {
  if (score >= 80) return "blooming";
  if (score >= 50) return "healthy";
  if (score >= 25) return "wilting";
  if (score >= 1) return "dying";
  return "dormant";
}
const STATE_LABEL = {
  blooming: "Blooming", healthy: "Healthy", wilting: "Wilting",
  dying: "Dying", dormant: "Dormant",
};

/* ---------------- Flower rendering ---------------- */

const STATE_COLORS = {
  blooming: { bg: "#EAF3E1", petal: "#9FC474", center: "#6f9a3f", ink: "#6f9a3f" },
  healthy: { bg: "#F1F6EC", petal: "#B7CE93", center: "#7fa855", ink: "#7fa855" },
  wilting: { bg: "#FBEFE0", petal: "#E3B579", center: "#c98f45", ink: "#c98f45" },
  dying: { bg: "#F1EFEC", petal: "#BDB6AC", center: "#8f8880", ink: "#8f8880" },
  dormant: { bg: "#ECEAE6", petal: "#C9C2B8", center: "#C9C2B8", ink: "#a49c8f" },
};

const STATE_PETALS = {
  blooming: { count: 5, r: 11, opacity: [1, 1, 1, 1, 1], fallen: 0 },
  healthy: { count: 5, r: 10, opacity: [0.85, 0.85, 0.85, 0.85, 0.85], fallen: 0 },
  wilting: { count: 4, r: 9.5, opacity: [1, 1, 1, 0.4], fallen: 2 },
  dying: { count: 2, r: 8.5, opacity: [0.5, 0.3], fallen: 4 },
  dormant: { count: 0, r: 0, opacity: [], fallen: 0 },
};

function flowerSVG(state, cssSize) {
  const colors = STATE_COLORS[state];
  const cfg = STATE_PETALS[state];
  const cx = 32, cy = 32, centerR = state === "dormant" ? 0 : Math.max(6, cfg.r * 0.8);
  let petals = "";
  for (let i = 0; i < cfg.count; i++) {
    const angle = (Math.PI * 2 * i) / cfg.count - Math.PI / 2;
    const px = cx + 15 * Math.cos(angle);
    const py = cy + 15 * Math.sin(angle);
    petals += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${cfg.r}" fill="${colors.petal}" opacity="${cfg.opacity[i]}"/>`;
  }
  const center = state === "dormant" ? "" :
    `<circle cx="${cx}" cy="${cy}" r="${centerR}" fill="${colors.center}"/>`;
  let stem = "";
  let fallen = "";
  if (state === "dormant") {
    stem = `<path d="M32 22 C 30 40, 34 55, 32 74" stroke="${colors.petal}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>`;
  } else if (cfg.fallen > 0) {
    const seeds = [[10, 62, 4], [30, 74, 3], [46, 66, 4], [38, 78, 3], [16, 72, 3]];
    for (let i = 0; i < cfg.fallen; i++) {
      const [fx, fy, fr] = seeds[i % seeds.length];
      fallen += `<circle cx="${fx}" cy="${fy}" r="${fr}" fill="${colors.petal}" opacity="${0.5 - i * 0.06}"/>`;
    }
  }
  return `<svg viewBox="0 0 64 84" width="${cssSize}" height="${cssSize * 1.3125}" aria-hidden="true">${stem}${petals}${center}${fallen}</svg>`;
}

/* ---------------- Utilities ---------------- */

function relativeTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const mins = diff / 60000, hrs = mins / 60, days = hrs / 24;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)} min ago`;
  if (hrs < 24) return `${Math.floor(hrs)} hour${Math.floor(hrs) === 1 ? "" : "s"} ago`;
  if (days < 7) return `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? "" : "s"} ago`;
  return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? "" : "s"} ago`;
}
const TYPE_META = {
  message: { icon: "\u{1F4AC}", label: "Message" },
  call: { icon: "\u{1F4DE}", label: "Call" },
  video: { icon: "\u{1F3A5}", label: "Video call" },
};
const EVENT_TYPE_META = {
  birthday: { icon: "\u{1F382}", label: "Birthday" },
  anniversary: { icon: "\u{1F48D}", label: "Anniversary" },
  wedding: { icon: "\u{1F48D}", label: "Wedding" },
  moving: { icon: "\u{1F4E6}", label: "Moving" },
  workshop: { icon: "\u{1F6E0}\u{FE0F}", label: "Workshop" },
  other: { icon: "\u{1F4CC}", label: "Event" },
};
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------------- Events / calendar export ---------------- */

function nextOccurrence(ev) {
  const [y, m, d] = ev.date.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  if (!ev.recurring) return base;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let candidate = new Date(now.getFullYear(), m - 1, d);
  if (candidate < todayMid) candidate = new Date(now.getFullYear() + 1, m - 1, d);
  return candidate;
}
function formatEventDate(ev) {
  const occ = nextOccurrence(ev);
  const str = occ.toLocaleDateString(undefined, { month: "long", day: "numeric", year: ev.recurring ? undefined : "numeric" });
  return ev.recurring ? `${str} · yearly` : str;
}
function pad2(n) { return String(n).padStart(2, "0"); }
function toICSDate(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }
function toICSDateTime(d) { return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"; }
function escapeICS(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}
function buildICS(friendName, ev) {
  const meta = EVENT_TYPE_META[ev.type];
  const title = ev.label ? ev.label : `${friendName} — ${meta.label}`;
  const start = nextOccurrence(ev);
  const end = new Date(start); end.setDate(start.getDate() + 1);
  const uid = `${ev.id}@bloom-88.web.app`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bloom//Friendship Tracker//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toICSDateTime(new Date())}`,
    `DTSTART;VALUE=DATE:${toICSDate(start)}`,
    `DTEND;VALUE=DATE:${toICSDate(end)}`,
  ];
  if (ev.recurring) lines.push("RRULE:FREQ=YEARLY");
  lines.push(
    `SUMMARY:${escapeICS(`${meta.icon} ${title}`)}`,
    `DESCRIPTION:${escapeICS("Reminder from Bloom for " + friendName)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.join("\r\n");
}
function downloadICS(filename, content) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- State ---------------- */

let friends = [];
let rootData = {};
let unsubFriends = null;
let unsubRoot = null;
let currentFriendId = null;
let modalType = null;
let modalQuality = null;
let addNoteFriendId = null;
let addEventFriendId = null;
let currentFilter = "all";

/* ---------------- Router ---------------- */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("friend/")) return { view: "friend", id: h.slice(7) };
  return { view: "dashboard" };
}

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function render() {
  if (!auth.currentUser) { showView("view-signin"); return; }
  const route = parseHash();
  if (route.view === "friend" && friends.some((f) => f.id === route.id)) {
    currentFriendId = route.id;
    renderFriendDetail(route.id);
    showView("view-friend");
  } else {
    location.hash.startsWith("#/friend") && !friends.some((f) => f.id === route.id)
      ? (location.hash = "")
      : null;
    renderDashboard();
    showView("view-dashboard");
  }
}
window.addEventListener("hashchange", render);

/* ---------------- Dashboard ---------------- */

function pickPrompt(excludeFriendId) {
  const pool = excludeFriendId ? friends.filter((f) => f.id !== excludeFriendId) : friends;
  const candidates = pool.length > 0 ? pool : friends;
  if (candidates.length === 0) return null;
  const withNotes = candidates.filter((f) => (f.notes || []).length > 0);
  if (withNotes.length > 0) {
    const f = withNotes[Math.floor(Math.random() * withNotes.length)];
    const note = f.notes[Math.floor(Math.random() * f.notes.length)];
    const templates = {
      "☕": `Grab ${f.name} their usual — ${note.text}?`,
      "\u{1F382}": `${f.name}: ${note.text}. Worth planning something?`,
      "\u{1F97E}": `Ask ${f.name} about ${note.text.toLowerCase()}?`,
    };
    return { date: todayKey(), friendId: f.id, text: templates[note.emoji] || `Reach out to ${f.name} — ${note.text}` };
  }
  const sorted = [...candidates].sort((a, b) => currentHealth(a) - currentHealth(b));
  const f = sorted[0];
  return { date: todayKey(), friendId: f.id, text: `Ask ${f.name} what they're excited about this week.` };
}

function ensureDailyPrompt() {
  if (friends.length === 0) return null;
  if (rootData.dailyPrompt && rootData.dailyPrompt.date === todayKey()) {
    return friends.some((f) => f.id === rootData.dailyPrompt.friendId) ? rootData.dailyPrompt : null;
  }
  const prompt = pickPrompt(null);
  if (prompt) setDoc(doc(db, "users", auth.currentUser.uid), { dailyPrompt: prompt }, { merge: true });
  return prompt;
}

function refreshPromptIfLoggedToday(loggedFriendId) {
  if (!rootData.dailyPrompt || rootData.dailyPrompt.date !== todayKey()) return;
  if (rootData.dailyPrompt.friendId !== loggedFriendId) return;
  const next = pickPrompt(loggedFriendId);
  rootData.dailyPrompt = next;
  setDoc(doc(db, "users", auth.currentUser.uid), { dailyPrompt: next }, { merge: true });
}

function renderDashboard() {
  renderCategoryTabs();

  const banner = document.getElementById("prompt-banner");
  const prompt = ensureDailyPrompt();
  if (prompt) {
    banner.hidden = false;
    document.getElementById("prompt-copy").textContent = prompt.text;
    document.getElementById("prompt-cta").onclick = () => {
      location.hash = `#/friend/${prompt.friendId}`;
      openLogModal(prompt.friendId);
    };
  } else {
    banner.hidden = true;
  }

  const visible = currentFilter === "all"
    ? friends
    : friends.filter((f) => (f.category || "friend") === currentFilter);

  const grid = document.getElementById("friend-grid");
  grid.className = "friend-grid" + (visible.length >= 5 ? " cols-3" : "");
  grid.innerHTML = "";

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = friends.length === 0
      ? "No friends planted yet — add your first one below."
      : "No one in this tab yet.";
    grid.appendChild(empty);
  }

  const sorted = [...visible].sort((a, b) => currentHealth(a) - currentHealth(b));
  for (const f of sorted) {
    const score = currentHealth(f);
    const state = stateForScore(score);
    const colors = STATE_COLORS[state];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "friend-card";
    card.style.background = colors.bg;
    card.onclick = () => { location.hash = `#/friend/${f.id}`; };
    card.innerHTML = `
      ${flowerSVG(state, 40)}
      <div class="fc-name">${escapeHTML(f.name)}</div>
      <div class="fc-status" style="color:${colors.ink}">${STATE_LABEL[state]} — ${score}</div>
      <div class="fc-category">${escapeHTML(categoryLabel(f.category || "friend"))}</div>
      <div class="fc-log" style="color:${colors.ink};background:${state === "blooming" || state === "healthy" ? `rgba(0,0,0,.05)` : "rgba(0,0,0,.05)"}">Log</div>
    `;
    card.querySelector(".fc-log").addEventListener("click", (e) => {
      e.stopPropagation();
      openLogModal(f.id);
    });
    grid.appendChild(card);
  }

  const addTile = document.createElement("button");
  addTile.type = "button";
  addTile.className = "add-friend-tile";
  addTile.innerHTML = `<div class="plus">+</div><div class="label">Add friend</div>`;
  addTile.onclick = () => {
    populateCategorySelect(document.getElementById("add-friend-category"), currentFilter !== "all" ? currentFilter : "friend");
    document.getElementById("add-friend-new-category").hidden = true;
    document.getElementById("add-friend-new-category").value = "";
    document.getElementById("modal-add-friend").hidden = false;
  };
  grid.appendChild(addTile);
}

/* ---------------- Categories ---------------- */

const BUILTIN_CATEGORIES = [
  { id: "friend", label: "Friends" },
  { id: "family", label: "Family" },
];
function allCategories() {
  return [...BUILTIN_CATEGORIES, ...(rootData.customCategories || [])];
}
function categoryLabel(id) {
  const c = allCategories().find((x) => x.id === id);
  return c ? c.label : "Friends";
}
function populateCategorySelect(selectEl, selectedId) {
  selectEl.innerHTML = "";
  for (const c of allCategories()) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label;
    if (c.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  }
  const newOpt = document.createElement("option");
  newOpt.value = "__new__";
  newOpt.textContent = "+ New tab...";
  selectEl.appendChild(newOpt);
}
async function addCategory(label) {
  const uid = auth.currentUser.uid;
  const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cat = { id, label };
  await setDoc(doc(db, "users", uid), { customCategories: arrayUnion(cat) }, { merge: true });
  return cat;
}
function renderCategoryTabs() {
  const wrap = document.getElementById("category-tabs");
  wrap.innerHTML = "";
  const tabs = [{ id: "all", label: "All" }, ...allCategories()];
  for (const t of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab-pill" + (currentFilter === t.id ? " active" : "");
    btn.textContent = t.label;
    btn.onclick = () => { currentFilter = t.id; renderDashboard(); };
    wrap.appendChild(btn);
  }
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tab-pill-add";
  addBtn.textContent = "+ New tab";
  addBtn.onclick = () => {
    document.getElementById("add-category-name").value = "";
    document.getElementById("modal-add-category").hidden = false;
  };
  wrap.appendChild(addBtn);
}

document.getElementById("add-category-close").onclick = () => { document.getElementById("modal-add-category").hidden = true; };
document.getElementById("add-category-save").addEventListener("click", async () => {
  const label = document.getElementById("add-category-name").value.trim();
  if (!label) return;
  const cat = await addCategory(label);
  document.getElementById("modal-add-category").hidden = true;
  currentFilter = cat.id;
  toast(`Created "${label}" tab`);
  renderDashboard();
});

document.getElementById("add-friend-category").addEventListener("change", (e) => {
  document.getElementById("add-friend-new-category").hidden = e.target.value !== "__new__";
});

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ---------------- Friend detail ---------------- */

function renderFriendDetail(id) {
  const f = friends.find((x) => x.id === id);
  if (!f) return;
  const score = currentHealth(f);
  const state = stateForScore(score);
  const colors = STATE_COLORS[state];

  const header = document.getElementById("friend-header");
  header.style.background = colors.bg;
  document.getElementById("friend-header-flower").innerHTML = flowerSVG(state, 64);
  document.getElementById("friend-name").textContent = f.name;
  document.getElementById("friend-status").textContent =
    state === "dormant" ? "Dormant — ready when you are" : `${STATE_LABEL[state]} — health ${score}`;
  document.getElementById("friend-status").style.color = colors.ink;

  const catSelect = document.getElementById("friend-category-select");
  populateCategorySelect(catSelect, f.category || "friend");
  catSelect.querySelector('option[value="__new__"]')?.remove();
  catSelect.onchange = async () => {
    const uid = auth.currentUser.uid;
    await updateDoc(doc(db, "users", uid, "friends", f.id), { category: catSelect.value });
  };

  const logBtn = document.getElementById("log-contact-btn");
  logBtn.textContent = state === "dormant" ? "\u{1F331} Revive this friendship" : "+ Log contact";
  logBtn.onclick = () => openLogModal(f.id);

  const locCard = document.getElementById("location-card");
  if (f.location) {
    locCard.hidden = false;
    locCard.textContent = `\u{1F4CD} ${f.location} — reminders are timed to your overlap hours`;
  } else {
    locCard.hidden = true;
  }

  const notesRow = document.getElementById("notes-row");
  notesRow.innerHTML = "";
  for (const n of f.notes || []) {
    const pill = document.createElement("div");
    pill.className = "note-pill";
    pill.textContent = `${n.emoji} ${n.text}`;
    notesRow.appendChild(pill);
  }
  const addNote = document.createElement("button");
  addNote.type = "button";
  addNote.className = "add-note-pill";
  addNote.textContent = "+ Add note";
  addNote.onclick = () => {
    addNoteFriendId = f.id;
    document.getElementById("add-note-text").value = "";
    document.getElementById("modal-add-note").hidden = false;
  };
  notesRow.appendChild(addNote);

  const eventsList = document.getElementById("events-list");
  eventsList.innerHTML = "";
  const events = [...(f.events || [])].sort((a, b) => nextOccurrence(a) - nextOccurrence(b));
  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No events yet.";
    eventsList.appendChild(empty);
  }
  for (const ev of events) {
    const meta = EVENT_TYPE_META[ev.type];
    const row = document.createElement("div");
    row.className = "event-row";
    const label = ev.label ? ev.label : `${f.name} — ${meta.label}`;
    row.innerHTML = `
      <div class="event-row-text">
        <div>${meta.icon} ${escapeHTML(label)}</div>
        <div class="event-row-date">${formatEventDate(ev)}</div>
      </div>
    `;
    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "event-export-btn";
    exportBtn.textContent = "\u{1F4C5} Add to calendar";
    exportBtn.onclick = () => {
      downloadICS(`${f.name}-${ev.type}.ics`, buildICS(f.name, ev));
      toast("Calendar file downloaded");
    };
    row.appendChild(exportBtn);
    eventsList.appendChild(row);
  }

  document.getElementById("add-event-btn").onclick = () => {
    addEventFriendId = f.id;
    document.getElementById("add-event-type").value = "birthday";
    document.getElementById("add-event-label").value = "";
    document.getElementById("add-event-date").value = "";
    document.getElementById("add-event-recurring").checked = true;
    document.getElementById("modal-add-event").hidden = false;
  };

  const historyList = document.getElementById("history-list");
  historyList.innerHTML = "";
  const contacts = [...(f.contacts || [])].sort((a, b) => b.timestamp - a.timestamp);
  if (contacts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No contact logged yet.";
    historyList.appendChild(empty);
  }
  for (const c of contacts) {
    const row = document.createElement("div");
    row.className = "history-row";
    const meta = TYPE_META[c.type];
    row.textContent = `${meta.icon} ${meta.label} — quality ${c.quality}/5 — ${relativeTime(c.timestamp)}`;
    historyList.appendChild(row);
  }
}

document.getElementById("back-to-garden").onclick = () => { location.hash = ""; };

/* ---------------- Log contact modal ---------------- */

function openLogModal(friendId) {
  const f = friends.find((x) => x.id === friendId);
  if (!f) return;
  currentFriendId = friendId;
  modalType = null;
  modalQuality = null;
  document.getElementById("log-modal-title").textContent = `Log contact with ${f.name}`;

  const reminder = document.getElementById("log-modal-reminder");
  if ((f.notes || []).length > 0) {
    reminder.hidden = false;
    reminder.textContent = "Remember: " + f.notes.map((n) => n.text).join(" · ");
  } else {
    reminder.hidden = true;
  }

  document.querySelectorAll(".contact-type-row").forEach((btn) => btn.classList.remove("selected"));
  buildCupRow();
  document.getElementById("log-save-btn").disabled = true;
  document.getElementById("modal-log-contact").hidden = false;
}

document.querySelectorAll(".contact-type-row").forEach((btn) => {
  btn.addEventListener("click", () => {
    modalType = btn.dataset.type;
    document.querySelectorAll(".contact-type-row").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    updateSaveEnabled();
  });
});

function buildCupRow() {
  const row = document.getElementById("cup-row");
  row.innerHTML = "";
  const fills = [10, 30, 60, 85, 100];
  fills.forEach((pct, i) => {
    const q = i + 1;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cup";
    btn.dataset.quality = String(q);
    btn.innerHTML = `<div class="cup-glyph"><div class="cup-fill" style="height:${pct}%"></div></div><div class="cup-dot"></div>`;
    btn.addEventListener("click", () => {
      modalQuality = q;
      row.querySelectorAll(".cup").forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      updateSaveEnabled();
    });
    row.appendChild(btn);
  });
}
function updateSaveEnabled() {
  document.getElementById("log-save-btn").disabled = !(modalType && modalQuality);
}

document.getElementById("log-save-btn").addEventListener("click", async () => {
  if (!modalType || !modalQuality || !currentFriendId) return;
  const f = friends.find((x) => x.id === currentFriendId);
  const newHealth = Math.max(0, Math.min(100, currentHealth(f) + pointsForContact(modalType, modalQuality)));
  const uid = auth.currentUser.uid;
  await updateDoc(doc(db, "users", uid, "friends", currentFriendId), {
    healthScore: newHealth,
    lastEventAt: Date.now(),
    contacts: arrayUnion({ type: modalType, quality: modalQuality, timestamp: Date.now() }),
  });
  document.getElementById("modal-log-contact").hidden = true;
  toast(`Logged your ${TYPE_META[modalType].label.toLowerCase()} with ${f.name} \u{1F331}`);
  refreshPromptIfLoggedToday(currentFriendId);
  if (parseHash().view !== "friend") location.hash = `#/friend/${currentFriendId}`;
});
document.getElementById("log-modal-close").onclick = () => { document.getElementById("modal-log-contact").hidden = true; };

/* ---------------- Add friend modal ---------------- */

document.getElementById("add-friend-close").onclick = () => { document.getElementById("modal-add-friend").hidden = true; };
document.getElementById("add-friend-save").addEventListener("click", async () => {
  const name = document.getElementById("add-friend-name").value.trim();
  const location_ = document.getElementById("add-friend-location").value.trim();
  if (!name) return;
  const uid = auth.currentUser.uid;
  let category = document.getElementById("add-friend-category").value;
  if (category === "__new__") {
    const newLabel = document.getElementById("add-friend-new-category").value.trim();
    if (!newLabel) return;
    const cat = await addCategory(newLabel);
    category = cat.id;
  }
  const ref = await addDoc(collection(db, "users", uid, "friends"), {
    name, location: location_ || null, category,
    healthScore: 60, lastEventAt: Date.now(), createdAt: Date.now(),
    notes: [], contacts: [], events: [],
  });
  document.getElementById("add-friend-name").value = "";
  document.getElementById("add-friend-location").value = "";
  document.getElementById("modal-add-friend").hidden = true;
  toast(`Planted a new friendship with ${name} \u{1F33F}`);
  location.hash = `#/friend/${ref.id}`;
});

/* ---------------- Add note modal ---------------- */

document.getElementById("add-note-close").onclick = () => { document.getElementById("modal-add-note").hidden = true; };
document.getElementById("add-note-save").addEventListener("click", async () => {
  const text = document.getElementById("add-note-text").value.trim();
  const emoji = document.getElementById("add-note-emoji").value;
  if (!text || !addNoteFriendId) return;
  const uid = auth.currentUser.uid;
  await updateDoc(doc(db, "users", uid, "friends", addNoteFriendId), {
    notes: arrayUnion({ id: crypto.randomUUID(), emoji, text }),
  });
  document.getElementById("modal-add-note").hidden = true;
  toast("Note saved");
});

/* ---------------- Add event modal ---------------- */

document.getElementById("add-event-close").onclick = () => { document.getElementById("modal-add-event").hidden = true; };
document.getElementById("add-event-type").addEventListener("change", (e) => {
  document.getElementById("add-event-recurring").checked =
    e.target.value === "birthday" || e.target.value === "anniversary";
});
document.getElementById("add-event-save").addEventListener("click", async () => {
  const type = document.getElementById("add-event-type").value;
  const label = document.getElementById("add-event-label").value.trim();
  const date = document.getElementById("add-event-date").value;
  const recurring = document.getElementById("add-event-recurring").checked;
  if (!date || !addEventFriendId) return;
  const uid = auth.currentUser.uid;
  await updateDoc(doc(db, "users", uid, "friends", addEventFriendId), {
    events: arrayUnion({ id: crypto.randomUUID(), type, label: label || null, date, recurring }),
  });
  document.getElementById("modal-add-event").hidden = true;
  toast("Event saved");
});

/* ---------------- Auth ---------------- */

let isSignUp = false;
document.getElementById("auth-toggle").addEventListener("click", () => {
  isSignUp = !isSignUp;
  document.getElementById("signin-submit").textContent = isSignUp ? "Create account" : "Sign in";
  document.getElementById("auth-toggle-label").textContent = isSignUp ? "Already have an account?" : "New here?";
  document.getElementById("auth-toggle").textContent = isSignUp ? "Sign in" : "Create an account";
  document.getElementById("forgot-password").hidden = isSignUp;
  document.getElementById("signin-error").hidden = true;
  document.getElementById("signin-success").hidden = true;
});

document.getElementById("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;
  const errEl = document.getElementById("signin-error");
  const okEl = document.getElementById("signin-success");
  errEl.hidden = true;
  okEl.hidden = true;
  try {
    if (isSignUp) await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err.code);
    errEl.hidden = false;
  }
});
function friendlyAuthError(code) {
  const map = {
    "auth/invalid-email": "That email doesn't look right.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "No account with that email — try creating one.",
    "auth/email-already-in-use": "That email already has an account — try signing in.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts — please wait a bit and try again.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

document.getElementById("forgot-password").addEventListener("click", async () => {
  const email = document.getElementById("signin-email").value.trim();
  const errEl = document.getElementById("signin-error");
  const okEl = document.getElementById("signin-success");
  errEl.hidden = true;
  okEl.hidden = true;
  if (!email) {
    errEl.textContent = "Enter your email above first, then click “Forgot password?” again.";
    errEl.hidden = false;
    document.getElementById("signin-email").focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    okEl.textContent = "If an account exists for that email, a reset link is on its way.";
    okEl.hidden = false;
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      okEl.textContent = "If an account exists for that email, a reset link is on its way.";
      okEl.hidden = false;
    } else {
      errEl.textContent = friendlyAuthError(err.code);
      errEl.hidden = false;
    }
  }
});

document.getElementById("avatar-btn").addEventListener("click", () => {
  if (confirm("Sign out of Bloom?")) signOut(auth);
});

/* ---------------- Auth state / data subscriptions ---------------- */

onAuthStateChanged(auth, (user) => {
  document.getElementById("loading-screen").hidden = true;
  document.getElementById("app").hidden = false;

  if (unsubFriends) { unsubFriends(); unsubFriends = null; }
  if (unsubRoot) { unsubRoot(); unsubRoot = null; }

  if (!user) {
    friends = [];
    rootData = {};
    render();
    return;
  }

  const uid = user.uid;
  unsubRoot = onSnapshot(doc(db, "users", uid), (snap) => {
    rootData = snap.data() || {};
    render();
  });
  unsubFriends = onSnapshot(collection(db, "users", uid, "friends"), (snap) => {
    friends = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
});

render();
