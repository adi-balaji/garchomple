// Garchomple — which day is it, and what's today's team?

export const LAUNCH = "2026-10-14";            // Garchomple #1

export function todayKey(d = new (window.__RealDate || Date)()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayNumber(key) {
  const a = Date.UTC(...LAUNCH.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  const b = Date.UTC(...key.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  return Math.round((b - a) / 86400000) + 1;
}

export function dayKeysUntil(key) {
  const out = [];
  const [y, m, d] = LAUNCH.split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  while (true) {
    const k = cur.toISOString().slice(0, 10);
    if (k > key) break;
    out.push(k);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function shortDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function prettyDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// daily-resets.json: {"2026-10-16": 1, …}. Listing a date (or raising its number) gives that day a fresh
// team for everyone; results recorded against the old team stop counting, so everyone can play the new one.
let resetsP = null;
export function loadResets() {
  resetsP ||= (async () => {
    let map = {};
    try {
      const { fetchRetry } = await import("./net.js");
      const r = await fetchRetry("daily-resets.json", { cache: "no-cache" }, 3);
      if (r.ok) map = await r.json();
    } catch { /* no resets */ }
    (await import("./store.js")).setResets(map);
    return map;
  })();
  return resetsP;
}

/** Today's (or any day's) shared team: generated live from the dex, seeded by the date (and its reset number). */
export async function teamFor(key) {
  const { generateTeam, hashSeed } = await import("./teamgen.js");
  const n = (await loadResets())[key] | 0;
  return generateTeam(hashSeed(n ? `cynthiale:daily:${key}:reset${n}` : `cynthiale:daily:${key}`));
}

// ------------------------------------------------------------ Unlimited mode
const UNL_KEY = "cynthiale.unlimitedSeed";
export function unlimitedSeed() {
  try { const v = localStorage.getItem(UNL_KEY); if (v) return Number(v) >>> 0; } catch { /* storage off */ }
  return newUnlimitedSeed();
}
export function newUnlimitedSeed() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  try { localStorage.setItem(UNL_KEY, String(b[0])); } catch { /* storage off */ }
  return b[0];
}
export async function unlimitedTeam(seed) {
  const { generateTeam } = await import("./teamgen.js");
  return generateTeam(seed >>> 0);
}
export const seedLabel = seed => (seed >>> 0).toString(36).toUpperCase().padStart(7, "0");

export async function cynthia() {
  // her team comes from cynthia-team.txt (the same file the battle page writes into the game)
  const { loadTeamText, parseTeam, displayTeam } = await import("./cynthiateam.js");
  const t = await parseTeam(await loadTeamText());
  return { ...displayTeam(t), errors: t.errors };
}

export function msUntilTomorrow() {
  const now = new (window.__RealDate || Date)();
  const next = new (window.__RealDate || Date)(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}

export const TYPE_COLORS = {
  normal: "#9a9a78", fighting: "#b8382e", flying: "#8f7fd6", poison: "#9441a0", ground: "#d6b75e",
  rock: "#b39c3c", bug: "#9aa82a", ghost: "#6b5893", steel: "#a9a9c4", fire: "#e8742e",
  water: "#5c86e6", grass: "#6db948", electric: "#e8c41e", psychic: "#ea5683", ice: "#86cfcf",
  dragon: "#6a3ef0", dark: "#6b5548",
};

export const sprite = id => `sprites/animated/${id}.gif`;

export function shareText(key, result, team, mode = "daily", seed = 0) {
  const yours = Array.from({ length: 6 }, (_, i) => (i < result.standing ? "🟩" : "⬛")).join("");
  const title = mode === "unlimited" ? `Garchomple Unlimited ${seedLabel(seed)}` : `Garchomple ${shortDate(key)}`;
  const head = result.won
    ? `${title}: beat Cynthia with ${result.standing}/6 standing${result.hpPct != null ? ` (${result.hpPct}% HP left)` : ""}`
    : `${title}: Cynthia won this time`;
  return `${head}\n${yours}`;
}
