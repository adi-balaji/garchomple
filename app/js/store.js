// Garchomple — persistence.
import { fetchRetry } from "./net.js";
// Big files (ROM, base save) live in IndexedDB and never leave the browser.
// Results/stats live in localStorage.

const DB_NAME = "cynthiale", STORE = "files";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putFile(key, blob, meta = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ blob, meta, savedAt: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getFile(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteFile(key) {
  const db = await openDB();
  return new Promise(resolve => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
  });
}

/** Local development: the start script links your ROM and save into ./local/. */
export async function localFile(path) {
  try {
    const head = await fetchRetry(path, { method: "HEAD", cache: "no-store" });
    if (!head.ok) return null;
    const size = Number(head.headers.get("content-length") || 0);
    return { url: path, size };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ results
const KEY = "cynthiale.v1";

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY)) || {};
    return { results: {}, started: {}, unlimited: [], ...v };
  } catch {
    return { results: {}, started: {}, unlimited: [] };
  }
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

// which reset of each day's team is current (from daily-resets.json, via daily.loadResets)
let resets = {};
export function setResets(map) { resets = map || {}; }
const current = (day, rec) => rec && ((typeof rec === "object" ? rec.reset : 0) | 0) === (resets[day] | 0);

export function getResult(day) { const r = load().results[day]; return current(day, r) ? r : null; }
export function wasStarted(day) { return current(day, load().started[day]); }
export function markStarted(day) { const s = load(); s.started[day] = { at: (window.__RealDate || Date).now(), reset: resets[day] | 0 }; save(s); }
export function setResult(day, result) { const s = load(); s.results[day] = { ...result, reset: resets[day] | 0, at: (window.__RealDate || Date).now() }; save(s); }
export function addUnlimited(seed, result) {
  const s = load();
  s.unlimited.push({ seed: seed >>> 0, ...result, at: (window.__RealDate || Date).now() });
  save(s);
}
export function unlimitedResult(seed) { return load().unlimited.filter(r => r.seed === seed >>> 0).pop() || null; }
export function unlimitedStats() {
  const list = load().unlimited, wins = list.filter(r => r.won);
  let run = 0, best = 0;
  for (const r of list) { run = r.won ? run + 1 : 0; best = Math.max(best, run); }
  return { played: list.length, wins: wins.length, winPct: list.length ? Math.round((wins.length / list.length) * 100) : 0,
           current: run, best, avgStanding: wins.length ? +(wins.reduce((a, r) => a + r.standing, 0) / wins.length).toFixed(1) : 0 };
}
export function clearResult(day) { const s = load(); delete s.results[day]; save(s); }

export function stats(dayKeys) {
  const { results } = load();
  const played = Object.keys(results).length;
  const wins = Object.values(results).filter(r => r.won).length;
  const dist = [0, 0, 0, 0, 0, 0, 0];                 // wins by Pokémon still standing (1..6)
  Object.values(results).forEach(r => { if (r.won) dist[r.standing] = (dist[r.standing] || 0) + 1; });
  // streaks over consecutive calendar days
  let current = 0, best = 0, run = 0;
  for (const d of dayKeys) {               // chronological
    const r = results[d];
    if (r && r.won) { run++; best = Math.max(best, run); } else if (r) { run = 0; } else { run = 0; }
  }
  // current streak: walk back from the latest day that has a result
  for (let i = dayKeys.length - 1; i >= 0; i--) {
    const r = results[dayKeys[i]];
    if (!r) { if (i === dayKeys.length - 1) continue; break; }
    if (!r.won) break;
    current++;
  }
  return { played, wins, winPct: played ? Math.round((wins / played) * 100) : 0, current, best, dist };
}
