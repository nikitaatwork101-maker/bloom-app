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

// Lightweight, code-level feature flags — no build step or backend needed to flip
// one off. Add new entries here rather than scattering ad-hoc conditionals; each
// flag should be checked at its call site the same way DEBUG_MODE is below, so
// disabling a feature later never requires touching the logic itself.
const FEATURE_FLAGS = {
  // Raw numeric Health Score is intentionally hidden from users — the color
  // shift IS the signal. Enable via ?debug=1 in the URL, or once, via
  // localStorage.setItem('bloomDebug','1'), to see the underlying number.
  debugMode: new URLSearchParams(location.search).has("debug") || localStorage.getItem("bloomDebug") === "1",
};

/* ---------------- Health engine ---------------- */

const TYPE_POINTS = { message: 5, call: 12, video: 18 };
const DAY_MS = 86400000;

// Decay is per-relationship, keyed by each Bloom's own cadence — a daily Bloom
// goes quiet "louder" than a custom-90-day one. Design doc §12.1 shape:
// Bloom.cadence = { type: "daily"|"weekly"|"biweekly"|"custom", customDays }.
// This replaced the earlier checkInCadence (flat string, weekly/biweekly/
// monthly/quarterly) entirely rather than extending it — no field with that
// exact shape existed before. Nothing is migrated in Firestore: old Blooms
// keep whatever they had. Two separate concerns, deliberately not merged:
// decayRateForFriend() preserves each legacy cadence's EXACT original rate
// (monthly/quarterly kept their old fixed numbers, not the new 21/days
// formula, which would have quietly changed already-set Blooms' decay);
// normalizedCadence()/cadenceLabel() translate legacy values into the new
// shape only for UI display and editing, never for scoring.
const CADENCE_META = {
  daily: { label: "Daily", decayPerDay: 5 },
  weekly: { label: "Weekly", decayPerDay: 3 },
  biweekly: { label: "Every 2 weeks", decayPerDay: 2 },
};
const DEFAULT_DECAY_PER_DAY = 2;
const LEGACY_CADENCE_DECAY = { weekly: 3, biweekly: 2, monthly: 1, quarterly: 0.4 };
const LEGACY_CADENCE_LABEL = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly" };
const LEGACY_CADENCE_DISPLAY_SHAPE = {
  weekly: { type: "weekly", customDays: null },
  biweekly: { type: "biweekly", customDays: null },
  monthly: { type: "custom", customDays: 30 },
  quarterly: { type: "custom", customDays: 90 },
};

function decayRateForFriend(friend) {
  if (friend.cadence && friend.cadence.type) {
    if (friend.cadence.type === "custom") {
      const days = friend.cadence.customDays > 0 ? friend.cadence.customDays : 30;
      return 21 / days;
    }
    const meta = CADENCE_META[friend.cadence.type];
    return meta ? meta.decayPerDay : DEFAULT_DECAY_PER_DAY;
  }
  if (friend.checkInCadence && LEGACY_CADENCE_DECAY[friend.checkInCadence] != null) {
    return LEGACY_CADENCE_DECAY[friend.checkInCadence];
  }
  return DEFAULT_DECAY_PER_DAY;
}

// Display-only: for the UI, translate whatever's on the Bloom into the new
// { type, customDays } shape so the dropdown can pre-select something sensible.
function normalizedCadence(friend) {
  if (friend.cadence && friend.cadence.type) return friend.cadence;
  if (friend.checkInCadence && LEGACY_CADENCE_DISPLAY_SHAPE[friend.checkInCadence]) {
    return LEGACY_CADENCE_DISPLAY_SHAPE[friend.checkInCadence];
  }
  return null;
}
function cadenceLabel(friend) {
  if (!friend.cadence && friend.checkInCadence && LEGACY_CADENCE_LABEL[friend.checkInCadence]) {
    return LEGACY_CADENCE_LABEL[friend.checkInCadence];
  }
  const cadence = normalizedCadence(friend);
  if (!cadence) return "Not set";
  if (cadence.type === "custom") return cadence.customDays ? `Every ${cadence.customDays} days` : "Custom";
  return CADENCE_META[cadence.type]?.label || "Not set";
}

function qualityMultiplier(q) { return 0.6 + (q - 1) * 0.2; }
function pointsForContact(type, quality) {
  return Math.round(TYPE_POINTS[type] * qualityMultiplier(quality));
}
function clampScore(n) { return Math.max(0, Math.min(100, n)); }
function daysBetween(a, b) { return Math.max(0, (b - a) / DAY_MS); }

// Health Score is computed from the friend's raw contact-event history on every
// read, not stored as a mutable running total — so editing/deleting a past log
// retroactively changes the score with no separate recalculation step. Each step
// mirrors exactly what the old incremental (decay -> round -> clamp -> add points
// -> clamp) update used to do, so friends with unedited history compute to the
// same score they always have. Changing a friend's cadence recalculates their
// whole history under the new rate, same principle — one current setting, not a
// time-varying one.
function currentHealth(friend, asOf = Date.now()) {
  const decayPerDay = decayRateForFriend(friend);
  const events = [...(friend.contacts || [])].sort((a, b) => a.timestamp - b.timestamp);
  let score = 60;
  let cursor = friend.createdAt ?? asOf;
  for (const ev of events) {
    const decayed = clampScore(Math.round(score - decayPerDay * daysBetween(cursor, ev.timestamp)));
    score = clampScore(decayed + pointsForContact(ev.type, ev.quality));
    cursor = ev.timestamp;
  }
  return clampScore(Math.round(score - decayPerDay * daysBetween(cursor, asOf)));
}
/* ---------------- Bloom tiers (customizable, Settings) ---------------- */

// Approved vibrant-green-to-grey palette — the color shift is the primary
// signal (no score shown by default), so each tier needs to read as clearly
// distinct at a glance. Anyone who already saved a tier list to Firestore
// keeps their own colors until they hit "Reset to defaults" in Settings.
const DEFAULT_TIERS = [
  { id: "dormant", tierName: "Dormant", minScore: 0, maxScore: 0, colorHex: "#9B9B9B" },
  { id: "dying", tierName: "Dying", minScore: 1, maxScore: 24, colorHex: "#F26B3A" },
  { id: "wilting", tierName: "Wilting", minScore: 25, maxScore: 49, colorHex: "#F2B705" },
  { id: "healthy", tierName: "Healthy", minScore: 50, maxScore: 79, colorHex: "#A8D848" },
  { id: "blooming", tierName: "Blooming", minScore: 80, maxScore: 100, colorHex: "#4CAF50" },
];

function getTiers() {
  const tiers = rootData.tiers && rootData.tiers.length > 0 ? rootData.tiers : DEFAULT_TIERS;
  return [...tiers].sort((a, b) => a.minScore - b.minScore);
}
function tierIndexForScore(score, tiers) {
  const idx = tiers.findIndex((t) => score >= t.minScore && score <= t.maxScore);
  return idx === -1 ? tiers.length - 1 : idx;
}
// The tier color is the signal, not a number — score only shows in debug mode.
function tierStatusText(tierName, score) {
  return FEATURE_FLAGS.debugMode ? `${tierName} — ${score}` : tierName;
}
function validateTiers(tiers) {
  if (tiers.length === 0) return "You need at least one tier.";
  const sorted = [...tiers].sort((a, b) => a.minScore - b.minScore);
  if (sorted[0].minScore !== 0) return `"${sorted[0].tierName}" must start at 0.`;
  if (sorted[sorted.length - 1].maxScore !== 100) return `"${sorted[sorted.length - 1].tierName}" must end at 100.`;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (!t.tierName.trim()) return "Every tier needs a name.";
    if (!Number.isInteger(t.minScore) || !Number.isInteger(t.maxScore)) return `"${t.tierName}" needs whole-number bounds.`;
    if (t.minScore > t.maxScore) return `"${t.tierName}"'s min is greater than its max.`;
    if (i > 0 && t.minScore !== sorted[i - 1].maxScore + 1) {
      return `Gap or overlap between "${sorted[i - 1].tierName}" and "${t.tierName}" — ranges must be contiguous.`;
    }
  }
  return null;
}

/* ---------------- Color derivation (single tier color -> full palette) ---------------- */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function tintHex(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}
function shadeHex(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}
function tierPalette(tier) {
  return {
    bg: tintHex(tier.colorHex, 0.82),
    petal: tier.colorHex,
    center: shadeHex(tier.colorHex, 0.32),
    ink: shadeHex(tier.colorHex, 0.32),
  };
}

/* ---------------- Flower rendering ---------------- */

// Petal geometry is derived from a tier's RANK among all tiers (lowest score
// range = bare stem, highest = full 5-petal bloom), not looked up by name, so
// it generalizes to any user-defined tier list. When the list is untouched
// (still exactly 5 tiers), these constants reproduce the original hand-tuned
// look exactly rather than the generic formula's approximation.
const DEFAULT_PETAL_CONFIGS = [
  { count: 0, r: 0, opacity: [], fallen: 0, bare: true },
  { count: 2, r: 8.5, opacity: [0.5, 0.3], fallen: 4 },
  { count: 4, r: 9.5, opacity: [1, 1, 1, 0.4], fallen: 2 },
  { count: 5, r: 10, opacity: [0.85, 0.85, 0.85, 0.85, 0.85], fallen: 0 },
  { count: 5, r: 11, opacity: [1, 1, 1, 1, 1], fallen: 0 },
];
function petalConfigForRank(idx, n) {
  if (n === 5) return DEFAULT_PETAL_CONFIGS[idx];
  if (idx === 0) return { count: 0, r: 0, opacity: [], fallen: 0, bare: true };
  const rank = n <= 1 ? 1 : idx / (n - 1);
  const count = Math.max(2, Math.min(5, Math.round(2 + rank * 3)));
  const baseOpacity = Math.min(1, 0.4 + rank * 0.6);
  const opacity = Array(count).fill(baseOpacity);
  if (rank < 1) opacity[count - 1] = Math.max(0.3, baseOpacity - 0.4);
  return { count, r: 8 + rank * 3, opacity, fallen: Math.round((1 - rank) * 4) };
}

// Shape (petal count/opacity/bare-stem) and color are deliberately decoupled:
// tier rank always drives shape, but the caller decides what palette to paint
// it with — friend-detail keeps tier color (unchanged), the dashboard grid
// uses tag color instead (design doc §12.4).
function flowerSVG(colors, tierIdx, tierCount, cssSize) {
  const cfg = petalConfigForRank(tierIdx, tierCount);
  const cx = 32, cy = 32, centerR = cfg.bare ? 0 : Math.max(6, cfg.r * 0.8);
  let petals = "";
  for (let i = 0; i < cfg.count; i++) {
    const angle = (Math.PI * 2 * i) / cfg.count - Math.PI / 2;
    const px = cx + 15 * Math.cos(angle);
    const py = cy + 15 * Math.sin(angle);
    petals += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${cfg.r}" fill="${colors.petal}" opacity="${cfg.opacity[i]}"/>`;
  }
  const center = cfg.bare ? "" :
    `<circle cx="${cx}" cy="${cy}" r="${centerR}" fill="${colors.center}"/>`;
  let stem = "";
  let fallen = "";
  if (cfg.bare) {
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
let groupByMode = "tags"; // "tags" | "cadence"
let editingContactId = null;
let editingNoteId = null;
let editingEventId = null;

/* ---------------- Array field helpers (contacts / notes / events CRUD) ---------------- */

async function replaceArrayField(friendId, fieldName, newArray) {
  const uid = auth.currentUser.uid;
  await updateDoc(doc(db, "users", uid, "friends", friendId), { [fieldName]: newArray });
}

// One-time, idempotent self-heal: older contact entries were written before edit/delete
// existed and have no id, so they can't be targeted individually. Backfill silently on
// load; each friend only needs this once, after which the condition is always false.
function backfillContactIds() {
  for (const f of friends) {
    const contacts = f.contacts || [];
    if (contacts.length === 0 || contacts.every((c) => c.id)) continue;
    const patched = contacts.map((c) => (c.id ? c : { ...c, id: crypto.randomUUID() }));
    replaceArrayField(f.id, "contacts", patched);
  }
}

/* ---------------- Router ---------------- */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("friend/")) return { view: "friend", id: h.slice(7) };
  if (h === "settings") return { view: "settings" };
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
  } else if (route.view === "settings") {
    renderSettings();
    showView("view-settings");
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

// Cancelling a friend's prompt repeatedly demotes them (not excludes them) from
// selection, rather than a manual snooze: each cancel adds a penalty to their
// effective rank, so genuinely-lower-scored friends win the slot instead. The
// penalty clears the next time contact is actually logged with them.
const PROMPT_CANCEL_PENALTY = 20;

// Design doc §12.3: branch the prompt's suggested action on same-city vs.
// long-distance. A blank Bloom.city defaults to long-distance (doc's explicit
// "safer assumption than guessing same-city"). Case/whitespace-insensitive
// compare, since both fields are free-typed manual entry.
function isSameCity(friend) {
  const userCity = rootData.location && rootData.location.city;
  if (!userCity || !friend.city) return false;
  return userCity.trim().toLowerCase() === friend.city.trim().toLowerCase();
}

function promptText(f) {
  if ((f.notes || []).length > 0) {
    const note = f.notes[Math.floor(Math.random() * f.notes.length)];
    const templates = {
      "☕": `Grab ${f.name} their usual — ${note.text}?`,
      "\u{1F382}": `${f.name}: ${note.text}. Worth planning something?`,
      "\u{1F97E}": `Ask ${f.name} about ${note.text.toLowerCase()}?`,
    };
    return templates[note.emoji] || `Reach out to ${f.name} — ${note.text}`;
  }
  return isSameCity(f)
    ? `See ${f.name} in person this week?`
    : `Call or text ${f.name} — or start planning your next visit?`;
}
function promptRank(f) {
  return currentHealth(f) + (f.promptCancelCount || 0) * PROMPT_CANCEL_PENALTY;
}
function pickPrompt(excludeFriendId) {
  const pool = excludeFriendId ? friends.filter((f) => f.id !== excludeFriendId) : friends;
  const candidates = pool.length > 0 ? pool : friends;
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const diff = promptRank(a) - promptRank(b);
    return diff !== 0 ? diff : (a.promptLastShownAt || 0) - (b.promptLastShownAt || 0);
  });
  const f = sorted[0];
  return { date: todayKey(), friendId: f.id, text: promptText(f) };
}
function setDailyPrompt(prompt) {
  const uid = auth.currentUser.uid;
  rootData.dailyPrompt = prompt;
  setDoc(doc(db, "users", uid), { dailyPrompt: prompt }, { merge: true });
  if (prompt && prompt.friendId) {
    updateDoc(doc(db, "users", uid, "friends", prompt.friendId), { promptLastShownAt: Date.now() });
  }
}

// Design doc §12.5: notification center over "recent prompts and events."
// Only the day's initial prompt assignment gets logged to history (not every
// Change/Cancel override) — one entry per day, capped at 30, so the feed
// reads as a digest rather than a click log. Events are derived live from
// each Bloom's existing event data, no separate storage needed.
function logPromptToHistory(prompt) {
  const uid = auth.currentUser.uid;
  const entry = { date: prompt.date, friendId: prompt.friendId, text: prompt.text, timestamp: Date.now() };
  const history = [entry, ...(rootData.promptHistory || [])].slice(0, 30);
  rootData.promptHistory = history;
  setDoc(doc(db, "users", uid), { promptHistory: history }, { merge: true });
}

function ensureDailyPrompt() {
  if (friends.length === 0) return null;
  if (rootData.dailyPrompt && rootData.dailyPrompt.date === todayKey()) {
    if (rootData.dailyPrompt.friendId === null) return null; // cancelled today, no replacement
    return friends.some((f) => f.id === rootData.dailyPrompt.friendId) ? rootData.dailyPrompt : null;
  }
  const prompt = pickPrompt(null);
  if (prompt) {
    setDailyPrompt(prompt);
    logPromptToHistory(prompt);
  }
  return prompt;
}

function refreshPromptIfLoggedToday(loggedFriendId) {
  if (!rootData.dailyPrompt || rootData.dailyPrompt.date !== todayKey()) return;
  if (rootData.dailyPrompt.friendId !== loggedFriendId) return;
  setDailyPrompt(pickPrompt(loggedFriendId));
}

// Design doc §12.3: "re-evaluates whenever a Bloom's city is edited." Unlike
// refreshPromptIfLoggedToday, this keeps the same Bloom as today's subject —
// only the copy (same-city vs. long-distance variant) needs to change, not
// who's featured.
function refreshPromptTextIfCityEdited(editedFriend) {
  if (!rootData.dailyPrompt || rootData.dailyPrompt.date !== todayKey()) return;
  if (rootData.dailyPrompt.friendId !== editedFriend.id) return;
  setDailyPrompt({ ...rootData.dailyPrompt, text: promptText(editedFriend) });
}

function cancelDailyPrompt() {
  const uid = auth.currentUser.uid;
  const fid = rootData.dailyPrompt && rootData.dailyPrompt.friendId;
  const f = fid && friends.find((x) => x.id === fid);
  if (f) updateDoc(doc(db, "users", uid, "friends", fid), { promptCancelCount: (f.promptCancelCount || 0) + 1 });
  rootData.dailyPrompt = { date: todayKey(), friendId: null };
  setDoc(doc(db, "users", uid), { dailyPrompt: rootData.dailyPrompt }, { merge: true });
  renderDashboard();
}

function changeDailyPrompt(newFriendId) {
  const f = friends.find((x) => x.id === newFriendId);
  if (!f) return;
  setDailyPrompt({ date: todayKey(), friendId: f.id, text: promptText(f) });
  document.getElementById("modal-change-prompt").hidden = true;
  renderDashboard();
}

function openChangePromptModal(currentFriendIdForPrompt) {
  const list = document.getElementById("change-prompt-list");
  list.innerHTML = "";
  const others = friends.filter((f) => f.id !== currentFriendIdForPrompt);
  if (others.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No other Blooms to switch to today.";
    list.appendChild(empty);
  }
  for (const f of others) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "contact-type-row";
    btn.textContent = f.name;
    btn.onclick = () => changeDailyPrompt(f.id);
    list.appendChild(btn);
  }
  document.getElementById("modal-change-prompt").hidden = false;
}
document.getElementById("change-prompt-close").onclick = () => { document.getElementById("modal-change-prompt").hidden = true; };

function buildFriendCard(f, tiers) {
  const score = currentHealth(f);
  const tierIdx = tierIndexForScore(score, tiers);
  const tier = tiers[tierIdx];
  const tierColors = tierPalette(tier); // health signal: status text only
  const tagColors = primaryTagPalette(f); // relationship signal: card + flower (§12.4)
  const card = document.createElement("button");
  card.type = "button";
  card.className = "friend-card";
  card.style.background = tagColors.bg;
  card.onclick = () => { location.hash = `#/friend/${f.id}`; };
  card.innerHTML = `
    ${flowerSVG(tagColors, tierIdx, tiers.length, 40)}
    <div class="fc-name">${escapeHTML(f.name)}</div>
    <div class="fc-status" style="color:${tierColors.ink}">${escapeHTML(tierStatusText(tier.tierName, score))}</div>
    <div class="fc-category">${escapeHTML(normalizedTags(f).map(categoryLabel).join(", "))}</div>
    <div class="fc-log" style="color:${tierColors.ink};background:rgba(0,0,0,.05)">Log</div>
  `;
  card.querySelector(".fc-log").addEventListener("click", (e) => {
    e.stopPropagation();
    openLogModal(f.id);
  });
  return card;
}

let addFriendSelectedTags = new Set();

function buildAddFriendTile(defaultCategory) {
  const addTile = document.createElement("button");
  addTile.type = "button";
  addTile.className = "add-friend-tile";
  addTile.innerHTML = `<div class="plus">+</div><div class="label">Add Bloom</div>`;
  addTile.onclick = () => {
    addFriendSelectedTags = new Set([defaultCategory || "friend"]);
    const picker = document.getElementById("add-friend-tag-picker");
    renderTagPicker(picker, addFriendSelectedTags, () => {});
    document.getElementById("add-friend-new-tag-btn").onclick = () => {
      addCategoryOnCreate = (cat) => {
        addFriendSelectedTags.add(cat.id);
        renderTagPicker(picker, addFriendSelectedTags, () => {});
      };
      document.getElementById("add-category-name").value = "";
      document.getElementById("modal-add-category").hidden = false;
    };
    document.getElementById("add-friend-cadence").value = "weekly";
    document.getElementById("add-friend-cadence-custom-days").hidden = true;
    document.getElementById("add-friend-cadence-custom-days").value = "";
    document.getElementById("modal-add-friend").hidden = false;
  };
  return addTile;
}

function cadenceObjectFromInputs(typeSelect, customDaysInput) {
  const type = typeSelect.value;
  if (type === "custom") {
    const days = parseInt(customDaysInput.value, 10);
    return { type: "custom", customDays: days > 0 ? days : 30 };
  }
  return { type, customDays: null };
}

function renderGroupByToggle() {
  const wrap = document.getElementById("group-by-toggle");
  wrap.innerHTML = "";
  for (const mode of ["tags", "cadence"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = groupByMode === mode ? "active" : "";
    btn.textContent = mode === "tags" ? "Tags" : "Cadence";
    btn.onclick = () => { groupByMode = mode; renderDashboard(); };
    wrap.appendChild(btn);
  }
}

/* ---------------- Notification center ---------------- */

function daysUntilLabel(timestamp) {
  const days = Math.round((timestamp - Date.now()) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  if (days === -1) return "yesterday";
  return `${Math.abs(days)} days ago`;
}

// "Coming up": events within the next 14 days, soonest first — a reminder
// feed, so soonest-first is more useful here than strict reverse-chronological.
function upcomingEventNotifications() {
  const now = Date.now();
  const horizon = now + 14 * DAY_MS;
  const items = [];
  for (const f of friends) {
    for (const ev of f.events || []) {
      const occ = nextOccurrence(ev).getTime();
      if (occ >= now - DAY_MS && occ <= horizon) {
        const meta = EVENT_TYPE_META[ev.type];
        const label = ev.label || `${f.name} — ${meta.label}`;
        items.push({
          id: `event-${f.id}-${ev.id}-${new Date(occ).toDateString()}`,
          timestamp: occ,
          friendId: f.id,
          text: `${meta.icon} ${label} — ${daysUntilLabel(occ)}`,
        });
      }
    }
  }
  return items.sort((a, b) => a.timestamp - b.timestamp);
}

// "Recent": past daily-prompt assignments, most recent first — true
// reverse-chronological, per design doc §12.5.
function promptHistoryNotifications() {
  return (rootData.promptHistory || [])
    .map((p) => ({
      id: `prompt-${p.date}`,
      timestamp: p.timestamp,
      friendId: p.friendId,
      text: `Today's prompt: ${p.text}`,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

function allNotifications() {
  return [...upcomingEventNotifications(), ...promptHistoryNotifications()];
}

function renderNotifBadge() {
  const readIds = new Set(rootData.readNotificationIds || []);
  const unread = allNotifications().filter((n) => !readIds.has(n.id));
  const badge = document.getElementById("notif-badge");
  if (unread.length > 0) {
    badge.hidden = false;
    badge.textContent = unread.length > 9 ? "9+" : String(unread.length);
  } else {
    badge.hidden = true;
  }
}

function renderNotifSidebar() {
  const upcoming = upcomingEventNotifications();
  const history = promptHistoryNotifications();
  const readIds = new Set(rootData.readNotificationIds || []);
  const list = document.getElementById("notif-list");
  list.innerHTML = "";

  const addSection = (title, items) => {
    if (items.length === 0) return;
    const h = document.createElement("div");
    h.className = "notif-section-title";
    h.textContent = title;
    list.appendChild(h);
    for (const n of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "notif-item" + (!readIds.has(n.id) ? " unread" : "");
      btn.innerHTML = `<div class="notif-item-text">${escapeHTML(n.text)}</div>`;
      btn.onclick = () => {
        closeNotifSidebar();
        if (n.friendId) location.hash = `#/friend/${n.friendId}`;
      };
      list.appendChild(btn);
    }
  };
  addSection("Coming up", upcoming);
  addSection("Recent", history);

  if (upcoming.length === 0 && history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nothing here yet.";
    list.appendChild(empty);
  }
}

// Read state persists in Firestore (design doc §12.5), pruned to only ids
// still present in the current feed so it can't grow unbounded as events
// and prompt-history entries age out.
function markAllNotificationsRead() {
  const currentIds = new Set(allNotifications().map((n) => n.id));
  const readIds = new Set(rootData.readNotificationIds || []);
  for (const id of currentIds) readIds.add(id);
  const pruned = [...readIds].filter((id) => currentIds.has(id));
  const prevLen = (rootData.readNotificationIds || []).length;
  rootData.readNotificationIds = pruned;
  if (pruned.length !== prevLen) {
    const uid = auth.currentUser.uid;
    setDoc(doc(db, "users", uid), { readNotificationIds: pruned }, { merge: true });
  }
}

function openNotifSidebar() {
  renderNotifSidebar();
  document.getElementById("notif-sidebar").hidden = false;
  document.getElementById("notif-backdrop").hidden = false;
  markAllNotificationsRead();
  renderNotifBadge();
  renderNotifSidebar();
}
function closeNotifSidebar() {
  document.getElementById("notif-sidebar").hidden = true;
  document.getElementById("notif-backdrop").hidden = true;
}
document.getElementById("notif-bell-btn").addEventListener("click", openNotifSidebar);
document.getElementById("notif-sidebar-close").addEventListener("click", closeNotifSidebar);
document.getElementById("notif-backdrop").addEventListener("click", closeNotifSidebar);

function renderTagLegend() {
  const legend = document.getElementById("tag-legend");
  legend.innerHTML = "";
  for (const tag of allCategories()) {
    const item = document.createElement("div");
    item.className = "tag-legend-item";
    item.innerHTML = `<span class="tag-legend-dot" style="background:${tagColorHex(tag)}"></span>${escapeHTML(tag.label)}`;
    legend.appendChild(item);
  }
}

function renderDashboard() {
  renderGroupByToggle();
  renderTagLegend();

  const banner = document.getElementById("prompt-banner");
  const prompt = ensureDailyPrompt();
  if (prompt) {
    banner.hidden = false;
    document.getElementById("prompt-copy").textContent = prompt.text;
    document.getElementById("prompt-cta").onclick = () => {
      location.hash = `#/friend/${prompt.friendId}`;
      openLogModal(prompt.friendId);
    };
    document.getElementById("prompt-change").onclick = () => openChangePromptModal(prompt.friendId);
    document.getElementById("prompt-cancel").onclick = cancelDailyPrompt;
  } else {
    banner.hidden = true;
  }

  renderNotifBadge();

  const tabs = document.getElementById("category-tabs");
  const grid = document.getElementById("friend-grid");
  const groups = document.getElementById("cadence-groups");

  if (groupByMode === "cadence") {
    tabs.hidden = true;
    grid.hidden = true;
    groups.hidden = false;
    renderCadenceGroups();
    return;
  }

  tabs.hidden = false;
  grid.hidden = false;
  groups.hidden = true;
  renderCategoryTabs();

  const visible = currentFilter === "all"
    ? friends
    : friends.filter((f) => normalizedTags(f).includes(currentFilter));

  grid.className = "friend-grid" + (visible.length >= 5 ? " cols-3" : "");
  grid.innerHTML = "";

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = friends.length === 0
      ? "No Blooms planted yet — add your first one below."
      : "No one in this tab yet.";
    grid.appendChild(empty);
  }

  const tiers = getTiers();
  const sorted = [...visible].sort((a, b) => currentHealth(a) - currentHealth(b));
  for (const f of sorted) grid.appendChild(buildFriendCard(f, tiers));
  grid.appendChild(buildAddFriendTile(currentFilter !== "all" ? currentFilter : "friend"));
}

function renderCadenceGroups() {
  const container = document.getElementById("cadence-groups");
  container.innerHTML = "";

  if (friends.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No Blooms planted yet — add your first one below.";
    container.appendChild(empty);
    container.appendChild(buildAddFriendTile("friend"));
    return;
  }

  const tiers = getTiers();
  const order = ["daily", "weekly", "biweekly", "custom", null];
  const orderLabel = { daily: "Daily", weekly: "Weekly", biweekly: "Every 2 weeks", custom: "Custom", null: "Not set" };
  for (const key of order) {
    const bucket = friends.filter((f) => {
      const cadence = normalizedCadence(f);
      return (cadence ? cadence.type : null) === key;
    });
    if (bucket.length === 0) continue;
    const section = document.createElement("div");
    section.className = "cadence-section";
    const title = document.createElement("div");
    title.className = "cadence-section-title";
    title.innerHTML = `${orderLabel[key]} <span class="cadence-section-count">— ${bucket.length}</span>`;
    section.appendChild(title);
    const sectionGrid = document.createElement("div");
    sectionGrid.className = "friend-grid" + (bucket.length >= 5 ? " cols-3" : "");
    const sorted = [...bucket].sort((a, b) => currentHealth(a) - currentHealth(b));
    for (const f of sorted) sectionGrid.appendChild(buildFriendCard(f, tiers));
    section.appendChild(sectionGrid);
    container.appendChild(section);
  }
  container.appendChild(buildAddFriendTile("friend"));
}

/* ---------------- Settings: profile (location/timezone) ---------------- */

function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}

function renderProfileFields() {
  const loc = rootData.location || {};
  document.getElementById("profile-city").value = loc.city || "";
  document.getElementById("profile-timezone").value = loc.timezone || browserTimezone();
  document.getElementById("profile-error").hidden = true;
}

document.getElementById("save-profile-btn").addEventListener("click", async () => {
  const city = document.getElementById("profile-city").value.trim();
  const timezone = document.getElementById("profile-timezone").value.trim();
  const errEl = document.getElementById("profile-error");
  if (!city || !timezone) {
    errEl.textContent = "Both city and timezone are needed for same-city prompts and reminder timing.";
    errEl.hidden = false;
    return;
  }
  errEl.hidden = true;
  const uid = auth.currentUser.uid;
  await setDoc(doc(db, "users", uid), { location: { city, timezone } }, { merge: true });
  toast("Profile saved");
});

/* ---------------- Settings (Bloom tiers) ---------------- */

let draftTiers = null;

function renderSettings() {
  renderProfileFields();
  draftTiers = getTiers().map((t) => ({ ...t }));
  document.getElementById("tiers-error").hidden = true;
  renderTierRows();
}

function renderTierRows() {
  const list = document.getElementById("tiers-list");
  list.innerHTML = "";
  const sorted = [...draftTiers].sort((a, b) => a.minScore - b.minScore);
  for (const tier of sorted) {
    const row = document.createElement("div");
    row.className = "tier-row";
    row.innerHTML = `
      <input type="color" value="${tier.colorHex}" aria-label="Tier color" />
      <input type="text" value="${escapeHTML(tier.tierName)}" aria-label="Tier name" />
      <input type="number" value="${tier.minScore}" min="0" max="100" aria-label="Min score" />
      <div class="tier-row-dash">–</div>
      <input type="number" value="${tier.maxScore}" min="0" max="100" aria-label="Max score" />
      <button type="button" class="icon-btn danger" title="Delete tier">\u{1F5D1}️</button>
    `;
    const [colorInput, nameInput, minInput, maxInput] = row.querySelectorAll("input");
    const delBtn = row.querySelector("button");
    colorInput.addEventListener("input", () => { tier.colorHex = colorInput.value; });
    nameInput.addEventListener("input", () => { tier.tierName = nameInput.value; });
    minInput.addEventListener("input", () => { tier.minScore = Number(minInput.value); });
    maxInput.addEventListener("input", () => { tier.maxScore = Number(maxInput.value); });
    delBtn.addEventListener("click", () => {
      draftTiers = draftTiers.filter((t) => t.id !== tier.id);
      renderTierRows();
    });
    list.appendChild(row);
  }
}

document.getElementById("settings-btn").addEventListener("click", () => { location.hash = "#/settings"; });
document.getElementById("back-to-garden-from-settings").addEventListener("click", () => { location.hash = ""; });

document.getElementById("add-tier-btn").addEventListener("click", () => {
  draftTiers.push({ id: crypto.randomUUID(), tierName: "New tier", minScore: 0, maxScore: 0, colorHex: "#88B04B" });
  renderTierRows();
});

document.getElementById("reset-tiers-btn").addEventListener("click", () => {
  draftTiers = DEFAULT_TIERS.map((t) => ({ ...t }));
  renderTierRows();
});

document.getElementById("save-tiers-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("tiers-error");
  const err = validateTiers(draftTiers);
  if (err) {
    errEl.textContent = err;
    errEl.hidden = false;
    return;
  }
  errEl.hidden = true;
  const uid = auth.currentUser.uid;
  await setDoc(doc(db, "users", uid), { tiers: draftTiers }, { merge: true });
  toast("Tiers saved — your garden is updated \u{1F338}");
  location.hash = "";
});

/* ---------------- Categories / relationship tags ---------------- */

// relationshipTags (array) replaced the old single-value category field, per
// design doc §11.4 — a Bloom can carry multiple tags (e.g. Family + Coworker)
// and shows under every tab it's tagged with. No Firestore migration: legacy
// Blooms with only `category` set are translated on read via normalizedTags()
// into a single-element array, so filtering/display/coloring all keep working
// with zero visible change until a Bloom is actually re-tagged. The tag
// registry (BUILTIN_CATEGORIES + rootData.customCategories) is unchanged —
// only how tags are ASSIGNED to a Bloom changed, not how they're defined.
// Tag colors are a deliberately separate palette from tier colors (design doc
// §12.4) — different hue family so a garden card's color never gets mistaken
// for a health signal. Built-ins are fixed; custom tags auto-cycle through
// TAG_COLOR_PALETTE by creation order, no manual color picker in this pass.
const BUILTIN_CATEGORIES = [
  { id: "friend", label: "Friends", colorHex: "#7FA8D9" },
  { id: "family", label: "Family", colorHex: "#E8879C" },
];
const TAG_COLOR_PALETTE = ["#A78BC9", "#5FBFB3", "#E8B84B", "#8FBF6B", "#E8956B", "#6BA3BF"];
function allCategories() {
  return [...BUILTIN_CATEGORIES, ...(rootData.customCategories || [])];
}
function categoryLabel(id) {
  const c = allCategories().find((x) => x.id === id);
  return c ? c.label : "Friends";
}
function normalizedTags(friend) {
  if (Array.isArray(friend.relationshipTags) && friend.relationshipTags.length > 0) return friend.relationshipTags;
  if (friend.category) return [friend.category];
  return ["friend"];
}
// Custom tags created before colorHex existed on the record have none stored.
// Rather than a single fallback (which would collide every such tag onto the
// same color), hash the tag id into the palette for a stable-but-distinct pick.
function fallbackTagColor(tagId) {
  let hash = 0;
  for (let i = 0; i < tagId.length; i++) hash = (hash * 31 + tagId.charCodeAt(i)) >>> 0;
  return TAG_COLOR_PALETTE[hash % TAG_COLOR_PALETTE.length];
}
function tagColorHex(tag) {
  return (tag && tag.colorHex) || fallbackTagColor(tag ? tag.id : "friend");
}
function tagPalette(tagId) {
  const tag = allCategories().find((c) => c.id === tagId);
  const colorHex = tagColorHex(tag);
  return {
    bg: tintHex(colorHex, 0.82),
    petal: colorHex,
    center: shadeHex(colorHex, 0.32),
    ink: shadeHex(colorHex, 0.32),
  };
}
function primaryTagPalette(friend) {
  return tagPalette(normalizedTags(friend)[0]);
}
async function addCategory(label) {
  const uid = auth.currentUser.uid;
  const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const colorHex = TAG_COLOR_PALETTE[(rootData.customCategories || []).length % TAG_COLOR_PALETTE.length];
  const cat = { id, label, colorHex };
  await setDoc(doc(db, "users", uid), { customCategories: arrayUnion(cat) }, { merge: true });
  return cat;
}

// Reusable multi-select pill picker. selectedIds is a Set the caller owns;
// onToggle fires after every click so the caller can persist (or just hold)
// the change, then we re-render to reflect the new selection state.
function renderTagPicker(container, selectedIds, onToggle) {
  container.innerHTML = "";
  for (const tag of allCategories()) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "tab-pill" + (selectedIds.has(tag.id) ? " active" : "");
    pill.textContent = tag.label;
    pill.onclick = () => {
      if (selectedIds.has(tag.id)) selectedIds.delete(tag.id);
      else selectedIds.add(tag.id);
      onToggle([...selectedIds]);
      renderTagPicker(container, selectedIds, onToggle);
    };
    container.appendChild(pill);
  }
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
    addCategoryOnCreate = (cat) => { currentFilter = cat.id; toast(`Created "${cat.label}" tab`); renderDashboard(); };
    document.getElementById("add-category-name").value = "";
    document.getElementById("modal-add-category").hidden = false;
  };
  wrap.appendChild(addBtn);
}

// Set by whoever opens the "new tag" modal (dashboard tab bar, Add a Bloom
// form, or a Bloom's own tag picker) so Save can do the right thing per context.
let addCategoryOnCreate = null;

document.getElementById("add-category-close").onclick = () => { document.getElementById("modal-add-category").hidden = true; };
document.getElementById("add-category-save").addEventListener("click", async () => {
  const label = document.getElementById("add-category-name").value.trim();
  if (!label) return;
  const cat = await addCategory(label);
  document.getElementById("modal-add-category").hidden = true;
  addCategoryOnCreate?.(cat);
});

document.getElementById("add-friend-cadence").addEventListener("change", (e) => {
  document.getElementById("add-friend-cadence-custom-days").hidden = e.target.value !== "custom";
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
  const tiers = getTiers();
  const tierIdx = tierIndexForScore(score, tiers);
  const tier = tiers[tierIdx];
  const isLowestTier = tierIdx === 0;
  const colors = tierPalette(tier);

  const header = document.getElementById("friend-header");
  header.style.background = colors.bg;
  document.getElementById("friend-header-flower").innerHTML = flowerSVG(colors, tierIdx, tiers.length, 64);
  document.getElementById("friend-name").textContent = f.name;
  document.getElementById("friend-status").textContent = isLowestTier
    ? `${tier.tierName} — ready when you are`
    : tierStatusText(tier.tierName, score);
  document.getElementById("friend-status").style.color = colors.ink;

  const tagPickerEl = document.getElementById("friend-tag-picker");
  const selectedTags = new Set(normalizedTags(f));
  const saveTags = async (tags) => {
    const uid = auth.currentUser.uid;
    await updateDoc(doc(db, "users", uid, "friends", f.id), { relationshipTags: tags, category: null });
  };
  renderTagPicker(tagPickerEl, selectedTags, saveTags);
  document.getElementById("friend-new-tag-btn").onclick = () => {
    addCategoryOnCreate = (cat) => {
      selectedTags.add(cat.id);
      renderTagPicker(tagPickerEl, selectedTags, saveTags);
      saveTags([...selectedTags]);
    };
    document.getElementById("add-category-name").value = "";
    document.getElementById("modal-add-category").hidden = false;
  };

  const cadenceSelect = document.getElementById("friend-cadence-select");
  const customDaysInput = document.getElementById("friend-cadence-custom-days");
  const shownCadence = normalizedCadence(f);
  cadenceSelect.value = shownCadence ? shownCadence.type : "";
  customDaysInput.hidden = !shownCadence || shownCadence.type !== "custom";
  customDaysInput.value = shownCadence && shownCadence.type === "custom" ? shownCadence.customDays : "";
  cadenceSelect.onchange = async () => {
    customDaysInput.hidden = cadenceSelect.value !== "custom";
    if (!cadenceSelect.value) {
      const uid = auth.currentUser.uid;
      await updateDoc(doc(db, "users", uid, "friends", f.id), { cadence: null, checkInCadence: null });
      return;
    }
    if (cadenceSelect.value === "custom" && !customDaysInput.value) return; // wait for a day count
    const uid = auth.currentUser.uid;
    await updateDoc(doc(db, "users", uid, "friends", f.id), {
      cadence: cadenceObjectFromInputs(cadenceSelect, customDaysInput),
      checkInCadence: null,
    });
  };
  customDaysInput.onchange = async () => {
    if (cadenceSelect.value !== "custom" || !customDaysInput.value) return;
    const uid = auth.currentUser.uid;
    await updateDoc(doc(db, "users", uid, "friends", f.id), {
      cadence: cadenceObjectFromInputs(cadenceSelect, customDaysInput),
      checkInCadence: null,
    });
  };

  const cityInput = document.getElementById("friend-city-input");
  cityInput.value = f.city || "";
  cityInput.onchange = async () => {
    const uid = auth.currentUser.uid;
    const newCity = cityInput.value.trim() || null;
    await updateDoc(doc(db, "users", uid, "friends", f.id), { city: newCity });
    refreshPromptTextIfCityEdited({ ...f, city: newCity });
  };

  const logBtn = document.getElementById("log-contact-btn");
  logBtn.textContent = isLowestTier ? "\u{1F331} Revive this Bloom" : "+ Log contact";
  logBtn.onclick = () => openLogModal(f.id);

  const notesRow = document.getElementById("notes-row");
  notesRow.innerHTML = "";
  for (const n of f.notes || []) {
    const pill = document.createElement("div");
    pill.className = "note-pill";
    pill.innerHTML = `<span>${n.emoji} ${escapeHTML(n.text)}</span>`;
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.title = "Edit note";
    editBtn.textContent = "✏️";
    editBtn.onclick = () => openEditNoteModal(f.id, n.id);
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn danger";
    delBtn.title = "Delete note";
    delBtn.textContent = "\u{1F5D1}️";
    delBtn.onclick = () => {
      if (!confirm("Delete this note?")) return;
      replaceArrayField(f.id, "notes", (f.notes || []).filter((x) => x.id !== n.id));
    };
    pill.append(editBtn, delBtn);
    notesRow.appendChild(pill);
  }
  const addNote = document.createElement("button");
  addNote.type = "button";
  addNote.className = "add-note-pill";
  addNote.textContent = "+ Add note";
  addNote.onclick = () => {
    addNoteFriendId = f.id;
    editingNoteId = null;
    document.getElementById("add-note-modal-title").textContent = "Add a note";
    document.getElementById("add-note-save").textContent = "Save note";
    document.getElementById("add-note-emoji").value = "☕";
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
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "event-export-btn";
    exportBtn.textContent = "\u{1F4C5} Add to calendar";
    exportBtn.onclick = () => {
      downloadICS(`${f.name}-${ev.type}.ics`, buildICS(f.name, ev));
      toast("Calendar file downloaded");
    };
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.title = "Edit event";
    editBtn.textContent = "✏️";
    editBtn.onclick = () => openEditEventModal(f.id, ev.id);
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn danger";
    delBtn.title = "Delete event";
    delBtn.textContent = "\u{1F5D1}️";
    delBtn.onclick = () => {
      if (!confirm("Delete this event?")) return;
      replaceArrayField(f.id, "events", (f.events || []).filter((x) => x.id !== ev.id));
    };
    actions.append(exportBtn, editBtn, delBtn);
    row.appendChild(actions);
    eventsList.appendChild(row);
  }

  document.getElementById("add-event-btn").onclick = () => {
    addEventFriendId = f.id;
    editingEventId = null;
    document.getElementById("add-event-modal-title").textContent = "Add an event";
    document.getElementById("add-event-save").textContent = "Save event";
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
    row.innerHTML = `<div class="history-row-text">${meta.icon} ${meta.label} — quality ${c.quality}/5 — ${relativeTime(c.timestamp)}</div>`;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.title = "Edit";
    editBtn.textContent = "✏️";
    editBtn.onclick = () => openEditContactModal(f.id, c.id);
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn danger";
    delBtn.title = "Delete";
    delBtn.textContent = "\u{1F5D1}️";
    delBtn.onclick = () => {
      if (!confirm("Delete this contact log? This will recalculate the health score.")) return;
      replaceArrayField(f.id, "contacts", (f.contacts || []).filter((x) => x.id !== c.id));
    };
    actions.append(editBtn, delBtn);
    row.appendChild(actions);
    historyList.appendChild(row);
  }
}

document.getElementById("back-to-garden").onclick = () => { location.hash = ""; };

/* ---------------- Log contact modal ---------------- */

function dateInputValue(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function timestampFromDateInput(value) {
  return new Date(`${value}T12:00:00`).getTime();
}

function selectContactType(type) {
  modalType = type;
  document.querySelectorAll("#modal-log-contact .contact-type-row").forEach((b) => {
    b.classList.toggle("selected", b.dataset.type === type);
  });
  updateSaveEnabled();
}

function openLogModal(friendId) {
  const f = friends.find((x) => x.id === friendId);
  if (!f) return;
  currentFriendId = friendId;
  editingContactId = null;
  modalType = null;
  modalQuality = null;
  document.getElementById("log-modal-title").textContent = `Log contact with ${f.name}`;
  document.getElementById("log-save-btn").textContent = "Save";

  const reminder = document.getElementById("log-modal-reminder");
  if ((f.notes || []).length > 0) {
    reminder.hidden = false;
    reminder.textContent = "Remember: " + f.notes.map((n) => n.text).join(" · ");
  } else {
    reminder.hidden = true;
  }

  document.querySelectorAll(".contact-type-row").forEach((btn) => btn.classList.remove("selected"));
  buildCupRow(null);
  document.getElementById("log-contact-date").value = dateInputValue(Date.now());
  document.getElementById("log-save-btn").disabled = true;
  document.getElementById("modal-log-contact").hidden = false;
}

function openEditContactModal(friendId, contactId) {
  const f = friends.find((x) => x.id === friendId);
  const c = f && (f.contacts || []).find((x) => x.id === contactId);
  if (!f || !c) return;
  currentFriendId = friendId;
  editingContactId = contactId;
  document.getElementById("log-modal-title").textContent = `Edit contact with ${f.name}`;
  document.getElementById("log-save-btn").textContent = "Save changes";
  document.getElementById("log-modal-reminder").hidden = true;

  selectContactType(c.type);
  buildCupRow(c.quality);
  document.getElementById("log-contact-date").value = dateInputValue(c.timestamp);
  document.getElementById("log-save-btn").disabled = false;
  document.getElementById("modal-log-contact").hidden = false;
}

document.querySelectorAll(".contact-type-row").forEach((btn) => {
  btn.addEventListener("click", () => selectContactType(btn.dataset.type));
});

function buildCupRow(preselectQuality) {
  const row = document.getElementById("cup-row");
  row.innerHTML = "";
  modalQuality = preselectQuality || null;
  const fills = [10, 30, 60, 85, 100];
  fills.forEach((pct, i) => {
    const q = i + 1;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cup" + (q === preselectQuality ? " selected" : "");
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
  const timestamp = timestampFromDateInput(document.getElementById("log-contact-date").value);

  if (editingContactId) {
    const updated = (f.contacts || []).map((c) =>
      c.id === editingContactId ? { ...c, type: modalType, quality: modalQuality, timestamp } : c
    );
    await replaceArrayField(currentFriendId, "contacts", updated);
    toast("Contact log updated — health score recalculated \u{1F331}");
  } else {
    await replaceArrayField(currentFriendId, "contacts", [
      ...(f.contacts || []),
      { id: crypto.randomUUID(), type: modalType, quality: modalQuality, timestamp },
    ]);
    toast(`Logged your ${TYPE_META[modalType].label.toLowerCase()} with ${f.name} \u{1F331}`);
    if (f.promptCancelCount) {
      await updateDoc(doc(db, "users", auth.currentUser.uid, "friends", currentFriendId), { promptCancelCount: 0 });
    }
    refreshPromptIfLoggedToday(currentFriendId);
  }

  document.getElementById("modal-log-contact").hidden = true;
  if (parseHash().view !== "friend") location.hash = `#/friend/${currentFriendId}`;
});
document.getElementById("log-modal-close").onclick = () => { document.getElementById("modal-log-contact").hidden = true; };

/* ---------------- Add friend modal ---------------- */

document.getElementById("add-friend-close").onclick = () => { document.getElementById("modal-add-friend").hidden = true; };
document.getElementById("add-friend-save").addEventListener("click", async () => {
  const name = document.getElementById("add-friend-name").value.trim();
  if (!name) return;
  const uid = auth.currentUser.uid;
  const cadence = cadenceObjectFromInputs(
    document.getElementById("add-friend-cadence"),
    document.getElementById("add-friend-cadence-custom-days")
  );
  const city = document.getElementById("add-friend-city").value.trim() || null;
  const ref = await addDoc(collection(db, "users", uid, "friends"), {
    name, relationshipTags: [...addFriendSelectedTags], cadence, city,
    createdAt: Date.now(),
    notes: [], contacts: [], events: [],
  });
  document.getElementById("add-friend-name").value = "";
  document.getElementById("add-friend-city").value = "";
  document.getElementById("modal-add-friend").hidden = true;
  toast(`Planted a new Bloom for ${name} \u{1F33F}`);
  location.hash = `#/friend/${ref.id}`;
});

/* ---------------- Add note modal ---------------- */

function openEditNoteModal(friendId, noteId) {
  const f = friends.find((x) => x.id === friendId);
  const n = f && (f.notes || []).find((x) => x.id === noteId);
  if (!f || !n) return;
  addNoteFriendId = friendId;
  editingNoteId = noteId;
  document.getElementById("add-note-modal-title").textContent = "Edit note";
  document.getElementById("add-note-save").textContent = "Save changes";
  document.getElementById("add-note-emoji").value = n.emoji;
  document.getElementById("add-note-text").value = n.text;
  document.getElementById("modal-add-note").hidden = false;
}

document.getElementById("add-note-close").onclick = () => { document.getElementById("modal-add-note").hidden = true; };
document.getElementById("add-note-save").addEventListener("click", async () => {
  const text = document.getElementById("add-note-text").value.trim();
  const emoji = document.getElementById("add-note-emoji").value;
  if (!text || !addNoteFriendId) return;
  const f = friends.find((x) => x.id === addNoteFriendId);
  if (editingNoteId) {
    const updated = (f.notes || []).map((n) => (n.id === editingNoteId ? { ...n, emoji, text } : n));
    await replaceArrayField(addNoteFriendId, "notes", updated);
    toast("Note updated");
  } else {
    await replaceArrayField(addNoteFriendId, "notes", [...(f.notes || []), { id: crypto.randomUUID(), emoji, text }]);
    toast("Note saved");
  }
  document.getElementById("modal-add-note").hidden = true;
});

/* ---------------- Add event modal ---------------- */

function openEditEventModal(friendId, eventId) {
  const f = friends.find((x) => x.id === friendId);
  const ev = f && (f.events || []).find((x) => x.id === eventId);
  if (!f || !ev) return;
  addEventFriendId = friendId;
  editingEventId = eventId;
  document.getElementById("add-event-modal-title").textContent = "Edit event";
  document.getElementById("add-event-save").textContent = "Save changes";
  document.getElementById("add-event-type").value = ev.type;
  document.getElementById("add-event-label").value = ev.label || "";
  document.getElementById("add-event-date").value = ev.date;
  document.getElementById("add-event-recurring").checked = ev.recurring;
  document.getElementById("modal-add-event").hidden = false;
}

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
  const f = friends.find((x) => x.id === addEventFriendId);
  if (editingEventId) {
    const updated = (f.events || []).map((ev) =>
      ev.id === editingEventId ? { ...ev, type, label: label || null, date, recurring } : ev
    );
    await replaceArrayField(addEventFriendId, "events", updated);
    toast("Event updated");
  } else {
    await replaceArrayField(addEventFriendId, "events", [
      ...(f.events || []),
      { id: crypto.randomUUID(), type, label: label || null, date, recurring },
    ]);
    toast("Event saved");
  }
  document.getElementById("modal-add-event").hidden = true;
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
    backfillContactIds();
  });
});

render();
