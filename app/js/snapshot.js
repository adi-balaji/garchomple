// Garchomple — fast start from a snapshot of the game standing in Undella Town.
//
// Booting the cartridge, clicking through the intro, Continue and the C-Gear questions takes most of a
// minute. Instead, the first run does that once, and the moment Undella Town is on screen it takes an
// emulator save state ("snapshot") and keeps it in this browser (IndexedDB), together with the save it
// was taken from. Every later run loads the snapshot straight away and writes the day's team over the
// party in the emulated RAM, so the game appears in Undella within a few seconds of the page loading.
//
// The snapshot is made on the player's own machine from their own ROM, so nothing copyrighted is shipped.
// For local development start.command may also leave one in ./local (undella.state + undella.sav + undella.json).

import { getFile, putFile, deleteFile } from "./store.js";

// bump when anything that ends up inside the snapshot changes (save patch, clock, capture point)
export const SNAP_VERSION = 2;
const PARTY_OFS = 0x18E08, SLOT = 220, PARTY_LEN = 6 * SLOT;
const EVENT_OFS = 0x1FF00;

const idbKey = romKey => `snap:${SNAP_VERSION}:${romKey}`;

/** {state:Uint8Array, save:Uint8Array} or null. */
export async function loadSnapshot(romKey) {
  try {
    const r = await getFile(idbKey(romKey));
    if (r && r.meta && r.meta.romKey === romKey) {
      const [state, save] = await Promise.all([r.blob.state.arrayBuffer(), r.blob.save.arrayBuffer()]);
      return { state: new Uint8Array(state), save: new Uint8Array(save), source: "browser" };
    }
  } catch { /* fall through */ }
  try {
    const meta = await (await fetch("local/undella.json", { cache: "no-store" })).json();
    if (meta.romKey !== romKey || meta.version !== SNAP_VERSION) return null;
    const [state, save] = await Promise.all(["local/undella.state", "local/undella.sav"].map(async u => {
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) throw new Error(u);
      return new Uint8Array(await res.arrayBuffer());
    }));
    return { state, save, source: "local" };
  } catch { return null; }
}

export async function storeSnapshot(romKey, state, save) {
  try {
    await putFile(idbKey(romKey), { state: new Blob([state]), save: new Blob([save]) }, { romKey, version: SNAP_VERSION });
    return true;
  } catch { return false; }
}

export async function dropSnapshot(romKey) {
  try { await deleteFile(idbKey(romKey)); } catch { /* nothing stored */ }
}

// ---------------------------------------------------------------- RAM search & patch

/** Every offset in H where pat occurs (aligned to 4: the game's buffers are word aligned). */
function findAll(H, pat, max = 64) {
  const hits = [];
  const w0 = (pat[0] | pat[1] << 8 | pat[2] << 16 | pat[3] << 24) >>> 0;
  const H32 = new Uint32Array(H.buffer, H.byteOffset, H.byteLength >> 2);
  for (let i = H32.indexOf(w0); i !== -1 && hits.length < max; i = H32.indexOf(w0, i + 1)) {
    const a = i << 2;
    let ok = true;
    for (let j = 4; j < pat.length; j++) if (H[a + j] !== pat[j]) { ok = false; break; }
    if (ok) hits.push(a);
  }
  return hits;
}

/** The most varied 32-byte window in a save region (a run of zeros would match everywhere). */
function distinctiveWindow(save, start, len, w = 32) {
  let best = start, bestN = 0;
  for (let o = start; o + w <= start + len; o += 4) {
    const n = new Set(save.subarray(o, o + w)).size;
    if (n > bestN) { bestN = n; best = o; }
  }
  return best;
}

/**
 * Replace the snapshot's party with today's everywhere it sits in emulated memory (the live party and the
 * game's in-RAM copy of the save). Returns {live, images} for the result watcher, or null if the
 * snapshot's party wasn't found (wrong or stale snapshot).
 */
export function swapParty(emu, fromSave, toSave) {
  const H = emu.gameManager.Module.HEAPU8;
  const from = fromSave.subarray(PARTY_OFS, PARTY_OFS + PARTY_LEN);
  const to = toSave.subarray(PARTY_OFS, PARTY_OFS + PARTY_LEN);
  const hits = findAll(H, from);
  if (!hits.length) return null;
  for (const a of hits) H.set(to, a);
  const eo = distinctiveWindow(fromSave, EVENT_OFS, 0x4E0);
  const images = findAll(H, fromSave.subarray(eo, eo + 32)).map(x => x - eo);
  const inImage = new Set(images.map(b => b + PARTY_OFS));
  return { live: hits.filter(a => !inImage.has(a)), images };
}
