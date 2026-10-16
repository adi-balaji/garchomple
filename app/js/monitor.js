// Garchomple — watch the battle and report the result automatically.
//
// The emulated DS memory lives inside the emulator's WebAssembly heap. We find it by searching
// for bytes we planted ourselves in today's save:
//   * the game keeps the whole save (incl. event flags) in RAM  → Cynthia's "battled today" flags
//   * the live party lives in RAM in the same encrypted format  → current HP of each Pokémon
// Win  = flag 2745 (rematch) or var 0x400F = 1 (first battle) gets set by her script.
// Loss = every party Pokémon at 0 HP (read before the game heals you at a Pokémon Center).

import { CYNTHIA } from "./gen5save.js";
import { fingerprint, classify } from "./autopilot.js";
import { REFS } from "./autopilot_refs.js";

const PARTY_OFS = 0x18E08, EVENT_OFS = 0x1FF00, FLAG_OFS = EVENT_OFS + 0x1AF * 2, SLOT = 220;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findAll(H, pat, max = 16) {
  const hits = [], first = pat[0], n = H.length - pat.length;
  let i = H.indexOf(first, 0);
  while (i !== -1 && i < n && hits.length < max) {
    let ok = true;
    for (let j = 1; j < pat.length; j++) if (H[i + j] !== pat[j]) { ok = false; break; }
    if (ok) hits.push(i);
    i = H.indexOf(first, i + 1);
  }
  return hits;
}

/** The most varied 32-byte window inside a save block (zeros would match everywhere). */
function distinctiveWindow(save, start, len, w = 32) {
  let best = start, bestN = 0;
  for (let o = start; o + w <= start + len; o += 4) {
    const n = new Set(save.subarray(o, o + w)).size;
    if (n > bestN) { bestN = n; best = o; }
  }
  return best;
}

/** Locate the save images and the live party inside the emulator heap. */
export function locate(emu, save) {
  const H = emu.gameManager.Module.HEAPU8;
  const eo = distinctiveWindow(save, EVENT_OFS, 0x4E0);
  const images = findAll(H, save.subarray(eo, eo + 32)).map(h => h - eo);       // address of save offset 0
  const imageParty = new Set(images.map(b => b + PARTY_OFS));
  const live = findAll(H, save.subarray(PARTY_OFS, PARTY_OFS + 32)).filter(a => !imageParty.has(a));
  return { images, live };
}

function partyHp(H, addr) {
  const hps = [];
  for (let s = 0; s < 6; s++) {
    const o = addr + s * SLOT;
    const pid = (H[o] | H[o + 1] << 8 | H[o + 2] << 16 | H[o + 3] << 24) >>> 0;
    let seed = pid, word = 0;
    for (let k = 0; k < 4; k++) {                     // 0x88 status(2 words), 0x8C level, 0x8E current HP
      seed = (Math.imul(0x41C64E6D, seed) + 0x6073) >>> 0;
      const at = o + 0x88 + k * 2;
      word = (H[at] | H[at + 1] << 8) ^ (seed >>> 16);
    }
    hps.push(word);
  }
  return hps;
}

const flagAt = (H, base, n) => (H[base + FLAG_OFS + (n >> 3)] >> (n & 7)) & 1;
const workAt = (H, base, v) => H[base + EVENT_OFS + (v - 0x4000) * 2] | H[base + EVENT_OFS + (v - 0x4000) * 2 + 1] << 8;

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
/** Distance of the top screen from the villa view, ignoring the bottom 3 rows (where a text box may be). */
function villaDist(top) {
  const ref = REFS.villa && REFS.villa.top;
  if (!ref) return 99;
  let d = 0;
  for (let i = 0; i < 9 * 16; i++) d += Math.abs(top[i] - ref[i]);
  return d / (9 * 16);
}

/** Distance of the lower screen from the C-Gear, brightness-normalised (dialogue dims it). */
function cgearDist(bottom) {
  const ref = REFS.overworld && REFS.overworld.bottom;
  if (!ref) return 99;
  const k = mean(ref) / Math.max(1, mean(bottom));
  let d = 0;
  for (let i = 0; i < ref.length; i++) d += Math.abs(bottom[i] * k - ref[i]);
  return d / ref.length;
}

/**
 * Watch until the battle is decided. Resolves {won, standing, hpPct, knockedOut} or null if the
 * memory couldn't be located (then the page falls back to manual logging).
 *
 * The party's HP in RAM is only written back after the battle, so the end is read off the screen:
 * a battle ends with both screens fading to black. hooks.onEnding() is called right then (the page
 * locks the keyboard) and the outcome follows within a few seconds:
 *   win  → Cynthia's "battled today" flag / var gets set, or the villa comes back on the top screen
 *   loss → the screens stay black ("…scurried to a Pokémon Center…" waits for a button press that
 *          never comes, because the keyboard is locked), or a Pokémon Center appears
 * A single black frame mid-battle (switching Pokémon) is ignored: if the battle screen comes back,
 * hooks.onResume() gives the keyboard back.
 */
export async function watchBattle(emu, save, team, { log = () => {}, stopSignal = { stopped: false }, loc = null,
                                                    onEnding = () => {}, onResume = () => {} } = {}) {
  // loc comes from snapshot.js when the party was swapped in RAM; otherwise search for today's save
  for (let tries = 0; tries < 5 && !(loc && loc.images.length); tries++) {
    if (tries) await sleep(1500);
    loc = locate(emu, save);
    log("locate", JSON.stringify(loc));
  }
  if (!loc || !loc.images.length) return null;
  window.__cynLoc = loc;                             // for debugging from the console
  const maxHp = team.map(m => m.stats.hp);
  const plausible = v => v.every((x, i) => x <= maxHp[i]);
  // Several copies of the party can sit in memory (leftover buffers from loading a snapshot keep full HP
  // forever). The live one is the copy whose HP has changed; until one does, every copy reads full HP.
  const readAll = H => loc.live.map(a => partyHp(H, a)).filter(plausible);
  const pick = all => all.find(v => v.some((x, i) => x !== maxHp[i])) || all[0] || null;
  const wonFlag = H => loc.images.some(b => flagAt(H, b, CYNTHIA.FLAG_BATTLED_TODAY) || workAt(H, b, CYNTHIA.WORK_DAILY) === 1);
  const result = async won => {
    if (!won) return { won: false, standing: 0, hpPct: 0, knockedOut: null };
    await sleep(300);                                  // let the party copy settle after the battle
    const v = pick(readAll(emu.gameManager.Module.HEAPU8)) || maxHp;
    const standing = Math.max(1, v.filter(x => x > 0).length);
    const hpPct = Math.round((v.reduce((a, x) => a + x, 0) / maxHp.reduce((a, x) => a + x, 0)) * 100);
    return { won: true, standing, hpPct, knockedOut: 6 };
  };

  let blackRun = 0, endingAt = 0, livePrev = null;
  while (!stopSignal.stopped) {
    const H = emu.gameManager.Module.HEAPU8;          // re-read: the heap view can be replaced if memory grows
    if (wonFlag(H)) { log("end", "win flag"); if (!endingAt) onEnding(); return result(true); }
    const all = readAll(H);
    const hp = pick(all);
    if (hp && JSON.stringify(hp) !== livePrev) { log("hp", hp.join(",")); livePrev = JSON.stringify(hp); }
    if (all.some(v => v.every(x => x === 0))) { log("end", "party hp 0"); if (!endingAt) onEnding(); return result(false); }

    let fp = null;
    try { fp = await fingerprint(emu); } catch { /* canvas not ready */ }
    if (fp) {
      const top = mean(fp.top), bottom = mean(fp.bottom);
      const black = top < 14 && bottom < 14;
      if (!endingAt) {
        blackRun = black ? blackRun + 1 : 0;
        if (blackRun >= 2) { endingAt = performance.now(); log("end?", "screens went black"); onEnding(); }
      } else {
        const since = performance.now() - endingAt;
        const state = classify(fp).state;
        if (state === "battle") {                      // just a black frame inside the battle
          log("end?", "false alarm"); endingAt = 0; blackRun = 0; onResume();
        } else if (top > 60 && cgearDist(fp.bottom) < 10) {
          // back in the overworld (the C-Gear is on the lower screen, maybe dimmed behind a text box)
          const v = villaDist(fp.top);
          log("end", v < 20 ? "back in the villa" : "somewhere else (Pokémon Center)", Math.round(v));
          return result(v < 20);
        } else if (since > 4500 && top < 30) {
          log("end", "screens stayed dark"); return result(false);
        }
      }
    }
    await sleep(endingAt ? 150 : 250);
  }
  return null;
}
