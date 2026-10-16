// Garchomple — Cynthia's team from cynthia-team.txt.
//
// The text file (Showdown-style, see the notes at its top) is the one place to change her team. It is:
//   * parsed here into game IDs (species, moves, items, ability slot) using data/dex/,
//   * written into the game's own trainer data for Cynthia (trainer #456) when the battle page starts,
//     by patching a copy of the ROM in memory (patchRom; your ROM file is never changed),
//   * shown on the home page (displayTeam), so the preview always matches the real battle.
//
// What Black 2/White 2's trainer format can store: species, form, level, gender, ability slot (1st or 2nd
// regular ability), held item, 4 moves, one IV value for all stats, and up to 4 bag items for her.
// It has no natures or EVs: the game derives those itself, so they can't be set here.

import { loadDex } from "./teamgen.js";
import { fetchRetry } from "./net.js";

export const TRAINER_ID = 456;
const TEAM_FILE = "cynthia-team.txt";
const MAX_MOVE = 559, MAX_SPECIES = 649;

const slug = s => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/♀/g, "-f").replace(/♂/g, "-m").replace(/[.'’:]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

let itemIndex = null;
async function loadItems() {
  itemIndex ||= fetchRetry("data/dex/item-index.json").then(r => r.json());
  return itemIndex;
}

export async function loadTeamText() {
  const r = await fetchRetry(TEAM_FILE, { cache: "no-store" });
  if (!r.ok) throw new Error(`Couldn't load ${TEAM_FILE}`);
  return r.text();
}

/**
 * Parse the team file. Returns {bag:[{index,display}], mons:[...], errors:[string]}.
 * Each mon: {species, display, types, form, level, gender, ability, abilitySlot, item, moves:[{id,...}], ivs}.
 */
export async function parseTeam(text) {
  const dex = await loadDex();
  const items = await loadItems();
  const bySpecies = new Map(dex.index.map(s => [s.name, s]));
  const errors = [], mons = [];
  let bag = [], cur = null;
  const err = (n, msg) => errors.push(`Line ${n}: ${msg}`);
  const findItem = (name, n) => {
    const it = items[slug(name)];
    if (!it) { err(n, `unknown item "${name}"`); return null; }
    return { index: it.index, display: it.display, name: slug(name) };
  };
  const finish = () => { if (cur) mons.push(cur); cur = null; };

  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    if (/^\s*#/.test(raw)) return;                      // a note line never ends a Pokémon block
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) { finish(); return; }
    let m;
    if ((m = line.match(/^bag\s*:\s*(.*)$/i))) {
      bag = m[1].split(",").map(s => s.trim()).filter(Boolean).map(s => findItem(s, n)).filter(Boolean);
      if (bag.length > 4) { err(n, "Cynthia can carry at most 4 bag items"); bag = bag.slice(0, 4); }
      return;
    }
    if (!cur) {
      // "Garchomp (F) @ Sitrus Berry"   (gender and item optional)
      m = line.match(/^(.+?)\s*(?:\((M|F)\))?\s*(?:@\s*(.+))?$/i);
      const name = slug(m[1]);
      const sp = bySpecies.get(name) || [...bySpecies.values()].find(s => slug(s.display) === name);
      if (!sp) { err(n, `unknown Pokémon "${m[1]}" (Gen 1–5 only)`); cur = { bad: true, moves: [] }; return; }
      cur = { species: sp.id, display: sp.display, types: sp.types, abilities: sp.abilities, form: 0, level: 76,
              gender: m[2] ? (m[2].toUpperCase() === "M" ? 1 : 2) : 0, ability: null, abilitySlot: 0,
              item: m[3] ? findItem(m[3], n) : null, moves: [], ivs: 31, line: n };
      return;
    }
    if (cur.bad) return;
    if ((m = line.match(/^-\s*(.+)$/))) {
      const mv = dex.movesByName[slug(m[1])];
      if (!mv || mv.id > MAX_MOVE) err(n, `unknown move "${m[1]}" (Gen 1–5 moves only)`);
      else if (cur.moves.length >= 4) err(n, `${cur.display} already has 4 moves`);
      else cur.moves.push({ id: mv.id, name: mv.display, type: mv.type, class: mv.class, power: mv.power });
      return;
    }
    if ((m = line.match(/^ability\s*:\s*(.+)$/i))) {
      const want = slug(m[1]);
      const a = cur.abilities.find(x => x.name === want);
      if (!a) err(n, `${cur.display} can't have ${m[1]} (its abilities: ${cur.abilities.filter(x => !x.hidden).map(x => dex.abilities[x.name]?.display || x.name).join(", ")})`);
      else if (a.hidden) err(n, `${m[1]} is ${cur.display}'s hidden ability; Black 2/White 2 trainers can only use regular abilities`);
      else { cur.ability = dex.abilities[a.name]?.display || m[1]; cur.abilitySlot = a.slot === 2 ? 2 : 1; }
      return;
    }
    if ((m = line.match(/^level\s*:\s*(\d+)$/i))) {
      const lv = Number(m[1]);
      if (lv < 1 || lv > 100) err(n, "level must be 1–100"); else cur.level = lv;
      return;
    }
    if ((m = line.match(/^ivs?\s*:\s*(\d+)/i))) {
      const iv = Number(m[1]);
      if (iv > 31) err(n, "IVs must be 0–31"); else cur.ivs = iv;
      return;
    }
    if ((m = line.match(/^form\s*:\s*(\d+)$/i))) { cur.form = Number(m[1]); return; }
    if (/^(evs?|nature|.+ nature|tera|shiny|happiness)\b/i.test(line)) {
      err(n, `"${line}" can't be set: Black 2/White 2 trainer data has no natures, EVs or shininess (remove the line)`);
      return;
    }
    err(n, `don't understand "${line}"`);
  });
  finish();

  const good = mons.filter(x => !x.bad);
  if (!good.length) errors.push("The team is empty: list at least one Pokémon.");
  if (good.length > 6) errors.push("Cynthia can have at most 6 Pokémon.");
  good.forEach(x => { if (!x.moves.length) errors.push(`Line ${x.line}: ${x.display} needs at least one move`); });
  for (const x of good) if (x.species > MAX_SPECIES) errors.push(`Line ${x.line}: ${x.display} isn't in Gen 5`);
  return { bag, mons: good.slice(0, 6), errors };
}

/** Shape the home page uses (same as the old data/cynthia.json). */
export function displayTeam(t) {
  return {
    trainer: "Champion Cynthia",
    bagItems: t.bag.map(b => b.display),
    team: t.mons.map(x => ({ species: x.species, display: x.display, types: x.types, level: x.level,
                             item: x.item && x.item.display, ability: x.ability, moves: x.moves })),
  };
}

// ---------------------------------------------------------------- ROM patching

const u16 = (b, o) => b[o] | b[o + 1] << 8;
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const w16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = v >> 8 & 255; };
const w32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = v >> 8 & 255; b[o + 2] = v >> 16 & 255; b[o + 3] = v >>> 24 & 255; };

async function bytes(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }

/** NDS file system: path → file id, plus the FAT. */
async function romFiles(blob) {
  const head = await bytes(blob, 0, 0x60);
  const fntOff = u32(head, 0x40), fntLen = u32(head, 0x44), fatOff = u32(head, 0x48), fatLen = u32(head, 0x4C);
  const fnt = await bytes(blob, fntOff, fntOff + fntLen);
  const fat = await bytes(blob, fatOff, fatOff + fatLen);
  const files = {};
  const walk = (dirId, path) => {
    const o = (dirId & 0xFFF) * 8;
    let p = u32(fnt, o), fid = u16(fnt, o + 4);
    for (;;) {
      const b = fnt[p++];
      if (!b) break;
      const len = b & 0x7F, name = String.fromCharCode(...fnt.subarray(p, p + len));
      p += len;
      if (b & 0x80) { const sub = u16(fnt, p); p += 2; walk(sub, path + name + "/"); }
      else files[path + name] = fid++;
    }
  };
  walk(0xF000, "");
  return { files, fat, fatOff, range: id => [u32(fat, id * 8), u32(fat, id * 8 + 4)] };
}

function narcLayout(d) {
  if (String.fromCharCode(...d.subarray(0, 4)) !== "NARC") throw new Error("not a NARC");
  const btaf = 16, count = u16(d, btaf + 8);
  const btnf = btaf + u32(d, btaf + 4), gmif = btnf + u32(d, btnf + 4);
  return { btaf, count, gmif, data: gmif + 8, entry: i => [u32(d, btaf + 12 + i * 8), u32(d, btaf + 16 + i * 8)] };
}

/**
 * Returns a new Blob: the ROM with Cynthia's trainer data replaced by `team` (from parseTeam).
 * Only her two records change (plus a few size fields if held items need the longer format).
 */
export async function patchRom(blob, team) {
  const fs = await romFiles(blob);
  const trId = fs.files["a/0/9/1"], tpId = fs.files["a/0/9/2"];
  if (trId === undefined || tpId === undefined) throw new Error("trainer data not found in this ROM");
  const [trS, trE] = fs.range(trId), [tpS, tpE] = fs.range(tpId);
  const trNarc = await bytes(blob, trS, trE), tpNarc = await bytes(blob, tpS, tpE);
  const trL = narcLayout(trNarc), tpL = narcLayout(tpNarc);

  // trainer record (20 bytes): format, class, battle type, count, 4 bag items, AI, healer, money, prize
  const [ra] = trL.entry(TRAINER_ID);
  const rec = trNarc.slice(trL.data + ra, trL.data + ra + 20);
  const withItems = team.mons.some(m => m.item);
  rec[0] = (rec[0] & ~2) | 1 | (withItems ? 2 : 0);          // bit0 moves, bit1 held items
  rec[3] = team.mons.length;
  for (let i = 0; i < 4; i++) w16(rec, 4 + i * 2, team.bag[i] ? team.bag[i].index : 0);

  // Pokémon records: difficulty(IVs), ability<<4|gender, level, species, form, [item], 4 moves; always 6 slots
  const size = withItems ? 18 : 16;
  const mons = new Uint8Array(6 * size);
  team.mons.forEach((m, i) => {
    const o = i * size;
    mons[o] = Math.round(m.ivs * 255 / 31);
    mons[o + 1] = (m.abilitySlot << 4) | m.gender;
    w16(mons, o + 2, m.level);
    w16(mons, o + 4, m.species);
    w16(mons, o + 6, m.form);
    let p = o + 8;
    if (withItems) { w16(mons, p, m.item ? m.item.index : 0); p += 2; }
    for (let k = 0; k < 4; k++) w16(mons, p + k * 2, m.moves[k] ? m.moves[k].id : 0);
  });

  // rebuild the Pokémon NARC with Cynthia's member resized (members after hers move along)
  const [pa, pb] = tpL.entry(TRAINER_ID);
  const delta = mons.length - (pb - pa);
  const out = new Uint8Array(tpNarc.length + delta);
  out.set(tpNarc.subarray(0, tpL.data + pa));
  out.set(mons, tpL.data + pa);
  out.set(tpNarc.subarray(tpL.data + pb), tpL.data + pa + mons.length);
  if (delta) {
    w32(out, 8, u32(out, 8) + delta);                             // NARC total size
    w32(out, tpL.gmif + 4, u32(out, tpL.gmif + 4) + delta);       // GMIF size
    for (let i = TRAINER_ID; i < tpL.count; i++) {
      const o = tpL.btaf + 12 + i * 8;
      if (i > TRAINER_ID) w32(out, o, u32(out, o) + delta);
      w32(out, o + 4, u32(out, o + 4) + delta);
    }
    // the file must still fit before the next file in the ROM
    let next = Infinity;
    for (let i = 0; i < fs.fat.length / 8; i++) { const s = u32(fs.fat, i * 8); if (s >= tpE && s < next) next = s; }
    if (tpS + out.length > next) throw new Error("no room in the ROM for held items on Cynthia's team");
  }
  const fatEntry = new Uint8Array(8);
  w32(fatEntry, 0, tpS);
  w32(fatEntry, 4, tpS + out.length);

  const patches = [
    [fs.fatOff + tpId * 8, fatEntry],
    [trS + trL.data + ra, rec],
    [tpS, out],
  ].sort((a, b) => a[0] - b[0]);
  const parts = [];
  let pos = 0;
  for (const [at, data] of patches) { parts.push(blob.slice(pos, at), data); pos = at + data.length; }
  parts.push(blob.slice(pos));
  return new Blob(parts);
}

/** Read Cynthia's team back out of a ROM (used to check a patch and by tools). */
export async function readRomTeam(blob) {
  const fs = await romFiles(blob);
  const [trS, trE] = fs.range(fs.files["a/0/9/1"]), [tpS, tpE] = fs.range(fs.files["a/0/9/2"]);
  const trNarc = await bytes(blob, trS, trE), tpNarc = await bytes(blob, tpS, tpE);
  const trL = narcLayout(trNarc), tpL = narcLayout(tpNarc);
  const [ra] = trL.entry(TRAINER_ID), [pa] = tpL.entry(TRAINER_ID);
  const rec = trNarc.subarray(trL.data + ra, trL.data + ra + 20);
  const size = 8 + (rec[0] & 2 ? 2 : 0) + (rec[0] & 1 ? 8 : 0);
  const out = { format: rec[0], bag: [0, 1, 2, 3].map(i => u16(rec, 4 + i * 2)).filter(Boolean), mons: [] };
  for (let i = 0; i < rec[3]; i++) {
    const o = tpL.data + pa + i * size;
    const m = { ivs: Math.floor(tpNarc[o] * 31 / 255), abilitySlot: tpNarc[o + 1] >> 4, gender: tpNarc[o + 1] & 15,
                level: u16(tpNarc, o + 2), species: u16(tpNarc, o + 4), form: u16(tpNarc, o + 6) };
    let p = o + 8;
    if (rec[0] & 2) { m.item = u16(tpNarc, p); p += 2; }
    if (rec[0] & 1) m.moves = [0, 1, 2, 3].map(k => u16(tpNarc, p + k * 2));
    out.mons.push(m);
  }
  return out;
}
