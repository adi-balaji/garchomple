// Garchomple — Pokémon Black 2 / White 2 save editor (runs in the browser and in Node).
// Builds encrypted PK5 party Pokémon, drops them into a .sav, teleports the player
// and fixes every CRC. Layout references: PKHeX (kwsch/PKHeX) and swan (ds-pokemon-hacking/swan).

export const SAVE_SIZE = 0x80000;
const MAIN_SIZE = 0x26000;          // general data; the game keeps a full backup right after it
const PARTY_OFS = 0x18E00;
const PLAYER_OFS = 0x19400;
export const PLAYER_NAME = "Nate";
const POSITION_OFS = 0x19500;
const INVENTORY_OFS = 0x18400;
const BOX_OFS = 0x400;
const STORED = 136, PARTY = 220;

// [offset, length, checksumOffset, checksumMirror] — SaveBlockAccessor5B2W2
const BLOCKS = [
  [0x00000,0x03e0,0x003E2,0x25F00],[0x00400,0x0ff0,0x013F2,0x25F02],[0x01400,0x0ff0,0x023F2,0x25F04],
  [0x02400,0x0ff0,0x033F2,0x25F06],[0x03400,0x0ff0,0x043F2,0x25F08],[0x04400,0x0ff0,0x053F2,0x25F0A],
  [0x05400,0x0ff0,0x063F2,0x25F0C],[0x06400,0x0ff0,0x073F2,0x25F0E],[0x07400,0x0ff0,0x083F2,0x25F10],
  [0x08400,0x0ff0,0x093F2,0x25F12],[0x09400,0x0ff0,0x0A3F2,0x25F14],[0x0A400,0x0ff0,0x0B3F2,0x25F16],
  [0x0B400,0x0ff0,0x0C3F2,0x25F18],[0x0C400,0x0ff0,0x0D3F2,0x25F1A],[0x0D400,0x0ff0,0x0E3F2,0x25F1C],
  [0x0E400,0x0ff0,0x0F3F2,0x25F1E],[0x0F400,0x0ff0,0x103F2,0x25F20],[0x10400,0x0ff0,0x113F2,0x25F22],
  [0x11400,0x0ff0,0x123F2,0x25F24],[0x12400,0x0ff0,0x133F2,0x25F26],[0x13400,0x0ff0,0x143F2,0x25F28],
  [0x14400,0x0ff0,0x153F2,0x25F2A],[0x15400,0x0ff0,0x163F2,0x25F2C],[0x16400,0x0ff0,0x173F2,0x25F2E],
  [0x17400,0x0ff0,0x183F2,0x25F30],[0x18400,0x09ec,0x18DEE,0x25F32],[0x18E00,0x0534,0x19336,0x25F34],
  [0x19400,0x00b0,0x194B2,0x25F36],[0x19500,0x00a8,0x195AA,0x25F38],[0x19600,0x1338,0x1A93A,0x25F3A],
  [0x1AA00,0x07c4,0x1B1C6,0x25F3C],[0x1B200,0x0d54,0x1BF56,0x25F3E],[0x1C000,0x0094,0x1C096,0x25F40],
  [0x1C100,0x0658,0x1C75A,0x25F42],[0x1C800,0x0a94,0x1D296,0x25F44],[0x1D300,0x01ac,0x1D4AE,0x25F46],
  [0x1D500,0x03ec,0x1D8EE,0x25F48],[0x1D900,0x005c,0x1D95E,0x25F4A],[0x1DA00,0x01e0,0x1DBE2,0x25F4C],
  [0x1DC00,0x00a8,0x1DCAA,0x25F4E],[0x1DD00,0x0460,0x1E162,0x25F50],[0x1E200,0x1400,0x1F602,0x25F52],
  [0x1F700,0x02a4,0x1F9A6,0x25F54],[0x1FA00,0x00e0,0x1FAE2,0x25F56],[0x1FB00,0x034c,0x1FE4E,0x25F58],
  [0x1FF00,0x04e0,0x203E2,0x25F5A],[0x20400,0x00f8,0x204FA,0x25F5C],[0x20500,0x02fc,0x207FE,0x25F5E],
  [0x20800,0x0094,0x20896,0x25F60],[0x20900,0x035c,0x20C5E,0x25F62],[0x20D00,0x01d4,0x20ED6,0x25F64],
  [0x20F00,0x01e0,0x210E2,0x25F66],[0x21100,0x00f0,0x211F2,0x25F68],[0x21200,0x01b4,0x213B6,0x25F6A],
  [0x21400,0x04dc,0x218DE,0x25F6C],[0x21900,0x0034,0x21936,0x25F6E],[0x21A00,0x003c,0x21A3E,0x25F70],
  [0x21B00,0x01ac,0x21CAE,0x25F72],[0x21D00,0x0b90,0x22892,0x25F74],[0x22900,0x00ac,0x229AE,0x25F76],
  [0x22A00,0x0850,0x23252,0x25F78],[0x23300,0x0284,0x23586,0x25F7A],[0x23600,0x0010,0x23612,0x25F7C],
  [0x23700,0x00a8,0x237AA,0x25F7E],[0x23800,0x016c,0x2396E,0x25F80],[0x23A00,0x0080,0x23A82,0x25F82],
  [0x23B00,0x00fc,0x23BFE,0x25F84],[0x23C00,0x16a8,0x252AA,0x25F86],[0x25300,0x0498,0x2579A,0x25F88],
  [0x25800,0x0060,0x25862,0x25F8A],[0x25900,0x00fc,0x259FE,0x25F8C],[0x25A00,0x03e4,0x25DE6,0x25F8E],
  [0x25E00,0x00f0,0x25EF2,0x25F90],[0x25F00,0x0094,0x25FA2,0x25FA2],
];

const BLOCK_POSITION = [
  0,1,2,3, 0,1,3,2, 0,2,1,3, 0,3,1,2, 0,2,3,1, 0,3,2,1, 1,0,2,3, 1,0,3,2,
  2,0,1,3, 3,0,1,2, 2,0,3,1, 3,0,2,1, 1,2,0,3, 1,3,0,2, 2,1,0,3, 3,1,0,2,
  2,3,0,1, 3,2,0,1, 1,2,3,0, 1,3,2,0, 2,1,3,0, 3,1,2,0, 2,3,1,0, 3,2,1,0,
];

// Where Cynthia lives in B2W2: zone 416 (Caitlin's villa) is entered from Undella Town (zone 412)
// through warp #4 at world (11928, -64, 4760) = tile (745, 297).
export const UNDELLA_SPAWN = { zone: 412, warp: 4, tileX: 745, tileZ: 298, y: -64, facing: "north" };
// We start on the doorstep (745, 298) facing north. Spawning inside the villa doesn't work: a save restores
// the NPCs of the map it was made on, so Cynthia would be missing. Walking in builds the room properly.

// ---------------------------------------------------------------- helpers
export function crc16(bytes, start = 0, len = bytes.length) {
  let c = 0xFFFF;
  for (let i = start; i < start + len; i++) {
    c ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
  }
  return c;
}

function cryptArray(buf, start, end, seed) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = start; i < end; i += 2) {
    seed = (Math.imul(0x41C64E6D, seed) + 0x6073) >>> 0;
    dv.setUint16(i, dv.getUint16(i, true) ^ (seed >>> 16), true);
  }
}

/** Shuffle + encrypt a decrypted 220-byte party PK5. */
export function encryptPK5(dec) {
  const out = new Uint8Array(dec.length);
  out.set(dec.subarray(0, 8));
  const dv = new DataView(dec.buffer, dec.byteOffset, dec.byteLength);
  const pid = dv.getUint32(0, true), chk = dv.getUint16(6, true);
  const sv = ((pid >>> 13) & 31) % 24;
  // decrypted block i lives at encrypted position BLOCK_POSITION[sv*4+i]
  for (let i = 0; i < 4; i++) {
    const pos = BLOCK_POSITION[sv * 4 + i];
    out.set(dec.subarray(8 + i * 32, 8 + i * 32 + 32), 8 + pos * 32);
  }
  if (dec.length > STORED) out.set(dec.subarray(STORED), STORED);
  cryptArray(out, 8, STORED, chk);
  if (dec.length > STORED) cryptArray(out, STORED, dec.length, pid);
  return out;
}

/** Inverse of encryptPK5 (used for reading the trainer's existing party and in tests). */
export function decryptPK5(enc) {
  const tmp = new Uint8Array(enc);
  const dv = new DataView(tmp.buffer);
  const pid = dv.getUint32(0, true), chk = dv.getUint16(6, true);
  cryptArray(tmp, 8, STORED, chk);
  if (tmp.length > STORED) cryptArray(tmp, STORED, tmp.length, pid);
  const out = new Uint8Array(tmp);
  const sv = ((pid >>> 13) & 31) % 24;
  for (let i = 0; i < 4; i++) {
    const pos = BLOCK_POSITION[sv * 4 + i];
    out.set(tmp.subarray(8 + pos * 32, 8 + pos * 32 + 32), 8 + i * 32);
  }
  return out;
}

const GENDER_GLYPHS = { "♂": 0x246D, "♀": 0x246E, "'": 0x2019, "é": 0x00E9 };

function writeString(buf, ofs, text, maxChars, totalBytes) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const chars = [...text].slice(0, maxChars).map(ch => GENDER_GLYPHS[ch] ?? ch.charCodeAt(0));
  for (let i = 0; i < totalBytes / 2; i++) dv.setUint16(ofs + i * 2, 0, true);
  chars.forEach((c, i) => dv.setUint16(ofs + i * 2, c, true));
  dv.setUint16(ofs + chars.length * 2, 0xFFFF, true);
  dv.setUint16(ofs + totalBytes - 2, 0xFFFF, true);
}

export function readString(buf, ofs, totalBytes) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  for (let i = 0; i < totalBytes; i += 2) {
    const c = dv.getUint16(ofs + i, true);
    if (c === 0xFFFF) break;
    s += c === 0x246D ? "♂" : c === 0x246E ? "♀" : String.fromCharCode(c);
  }
  return s;
}

export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gender thresholds for PokeAPI gender_rate (eighths female): female when (pid & 0xFF) < threshold
const GENDER_THRESHOLD = { 1: 0x1F, 2: 0x3F, 4: 0x7F, 6: 0xBF, 7: 0xE1 };

function makePID(rng, trainer, mon) {
  for (let tries = 0; tries < 100000; tries++) {
    const pid = (Math.floor(rng() * 0x10000) << 16 | Math.floor(rng() * 0x10000)) >>> 0;
    const shinyVal = (trainer.tid ^ trainer.sid ^ (pid >>> 16) ^ (pid & 0xFFFF));
    if (shinyVal < 8) continue;                                      // never accidentally shiny
    if (!mon.hiddenAbility && ((pid >>> 16) & 1) !== (mon.abilitySlot & 1)) continue;
    const t = GENDER_THRESHOLD[mon.genderRate];
    if (t !== undefined) {
      const female = (pid & 0xFF) < t;
      if (female !== (mon.gender === 1)) continue;
    }
    return pid;
  }
  throw new Error("could not roll a PID");
}

/**
 * Build a decrypted 220-byte party PK5.
 * mon = {species, nickname, level, exp, nature, ability, hiddenAbility, abilitySlot, gender (0 M,1 F,2 none),
 *        genderRate, item, moves[4], pp[4], ppUps[4], evs{hp,atk,def,spa,spd,spe}, ivs{...}, stats{...}, friendship}
 * trainer = {tid, sid, name, gender, language, version}
 */
export function buildPK5(mon, trainer, rng, meta = {}) {
  const b = new Uint8Array(PARTY);
  const dv = new DataView(b.buffer);
  const pid = makePID(rng, trainer, mon);
  dv.setUint32(0x00, pid, true);
  dv.setUint16(0x08, mon.species, true);
  dv.setUint16(0x0A, mon.item || 0, true);
  dv.setUint16(0x0C, trainer.tid, true);
  dv.setUint16(0x0E, trainer.sid, true);
  dv.setUint32(0x10, mon.exp, true);
  b[0x14] = mon.friendship ?? 255;
  b[0x15] = mon.ability;
  b[0x17] = trainer.language;
  const ev = mon.evs, iv = mon.ivs;
  [ev.hp, ev.atk, ev.def, ev.spe, ev.spa, ev.spd].forEach((v, i) => (b[0x18 + i] = v));
  for (let i = 0; i < 4; i++) {
    dv.setUint16(0x28 + i * 2, mon.moves[i] || 0, true);
    b[0x30 + i] = mon.moves[i] ? mon.pp[i] : 0;
    b[0x34 + i] = mon.moves[i] ? (mon.ppUps?.[i] ?? 3) : 0;
  }
  const iv32 = (iv.hp & 31) | (iv.atk & 31) << 5 | (iv.def & 31) << 10 | (iv.spe & 31) << 15 |
               (iv.spa & 31) << 20 | (iv.spd & 31) << 25;               // not an egg, not nicknamed
  dv.setUint32(0x38, iv32 >>> 0, true);
  b[0x40] = (mon.gender & 3) << 1;                                       // form 0, not fateful
  b[0x41] = mon.nature;
  b[0x42] = mon.hiddenAbility ? 1 : 0;
  writeString(b, 0x48, mon.nickname, 10, 22);
  b[0x5F] = trainer.version;
  writeString(b, 0x68, trainer.name, 7, 16);
  const d = meta.metDate || [26, 5, 1];
  b[0x7B] = d[0]; b[0x7C] = d[1]; b[0x7D] = d[2];
  dv.setUint16(0x80, meta.metLocation ?? 42, true);                      // 42 = Undella Town
  b[0x83] = meta.ball ?? 4;                                              // Poké Ball
  b[0x84] = (Math.min(mon.level, 100) & 0x7F) | ((trainer.gender & 1) << 7);
  // party block
  b[0x8C] = mon.level;
  const s = mon.stats;
  dv.setUint16(0x8E, s.hp, true);
  dv.setUint16(0x90, s.hp, true);
  dv.setUint16(0x92, s.atk, true);
  dv.setUint16(0x94, s.def, true);
  dv.setUint16(0x96, s.spe, true);
  dv.setUint16(0x98, s.spa, true);
  dv.setUint16(0x9A, s.spd, true);
  // blank mail (same shape the game writes)
  b.set([0,0,0,0,0,0,0x02,0x16], 0x9C);
  b.fill(0xFF, 0xA4, 0xD4);
  // checksum over the 128 stored bytes after the header
  let sum = 0;
  for (let i = 8; i < STORED; i += 2) sum = (sum + dv.getUint16(i, true)) & 0xFFFF;
  dv.setUint16(0x06, sum, true);
  return b;
}

export function isPostgame(sav) { return getFlag(sav, 2400) === 1; }

export function readTrainer(sav) {
  const dv = new DataView(sav.buffer, sav.byteOffset, sav.byteLength);
  return {
    name: readString(sav, PLAYER_OFS + 4, 16),
    tid: dv.getUint16(PLAYER_OFS + 0x14, true),
    sid: dv.getUint16(PLAYER_OFS + 0x16, true),
    language: sav[PLAYER_OFS + 0x1E],
    version: sav[PLAYER_OFS + 0x1F],
    gender: sav[PLAYER_OFS + 0x21],
    badges: sav[0x21100 + 4] ?? 0,
  };
}

export function readParty(sav) {
  const n = sav[PARTY_OFS + 4];
  const out = [];
  for (let i = 0; i < n && i < 6; i++) {
    const m = decryptPK5(sav.subarray(PARTY_OFS + 8 + i * PARTY, PARTY_OFS + 8 + (i + 1) * PARTY));
    const dv = new DataView(m.buffer);
    out.push({ species: dv.getUint16(8, true), level: m[0x8C], nickname: readString(m, 0x48, 22) });
  }
  return out;
}

export function validate(sav) {
  const problems = [];
  if (sav.length !== SAVE_SIZE) problems.push(`size ${sav.length} != ${SAVE_SIZE}`);
  const dv = new DataView(sav.buffer, sav.byteOffset, sav.byteLength);
  // B2W2 footer check (same test PKHeX uses to recognise a B2W2 save)
  const foot = MAIN_SIZE - 0x100;
  if (crc16(sav, foot, 0x94) !== dv.getUint16(foot + 0x94 + 0x0E, true)) problems.push("not a Black 2 / White 2 save");
  return problems;
}

function emptyStoredSlot() {
  return encryptPK5(new Uint8Array(STORED));
}

function writeSpawn(sav, ofs, spawn, changeType) {
  const dv = new DataView(sav.buffer, sav.byteOffset, sav.byteLength);
  dv.setUint32(ofs + 0x00, changeType, true);
  dv.setUint16(ofs + 0x04, spawn.zone, true);
  dv.setUint16(ofs + 0x06, spawn.warp ?? 0xFFFF, true);
  dv.setUint16(ofs + 0x08, 2, true);
  dv.setUint32(ofs + 0x0C, 0, true);                                    // grid, not rail
  dv.setInt32(ofs + 0x10, (spawn.tileX * 16 + 8) * 0x1000, true);
  dv.setInt32(ofs + 0x14, spawn.y * 0x1000, true);
  dv.setInt32(ofs + 0x18, (spawn.tileZ * 16 + 8) * 0x1000, true);
}

const FACING = { north: 0x0000, west: 0x4000, south: 0x8000, east: 0xC000 };

// Event work / flags (EventWork5B2W2: 0x1AF u16 works, then flag bitfield)
const EVENT_OFS = 0x1FF00, FLAG_OFS = EVENT_OFS + 0x1AF * 2;
export function getFlag(sav, n) { return (sav[FLAG_OFS + (n >> 3)] >> (n & 7)) & 1; }
export function setFlag(sav, n, on) {
  const i = FLAG_OFS + (n >> 3);
  sav[i] = on ? (sav[i] | (1 << (n & 7))) : (sav[i] & ~(1 << (n & 7)));
}
export function getWork(sav, v) { return sav[EVENT_OFS + (v - 0x4000) * 2] | sav[EVENT_OFS + (v - 0x4000) * 2 + 1] << 8; }
export function setWork(sav, v, val) { sav[EVENT_OFS + (v - 0x4000) * 2] = val & 0xFF; sav[EVENT_OFS + (v - 0x4000) * 2 + 1] = val >> 8; }

// From the Undella Town (script 824) and villa (script 832) event scripts:
export const CYNTHIA = {
  FLAG_HIDDEN: 683,        // vanish flag of the Cynthia NPC in zone 416
  FLAG_VISITORS: [684, 685, 687, 688, 689],
  FLAG_BATTLED_TODAY: 2745,
  FLAG_VISITORS_ROLLED: 2746,
  FLAG_HALL_OF_FAME: 2400, // must be set for her to ever appear
  WORK_STAGE: 0x4098,      // 0/1 = not met, 2 = met, 3 = rematches unlocked
  WORK_DAILY: 0x400F,      // 1 = already battled today
  TRAINER_ID: 456,
};

/**
 * Patch a save for today's challenge.
 * opts: {team:[mon...], seed, spawn, clearBoxes, clearBag, season}
 */
export function patchSave(original, opts) {
  const sav = new Uint8Array(original);   // copy
  const problems = validate(sav);
  if (problems.length) throw new Error(problems.join("; "));
  const dv = new DataView(sav.buffer);
  // every player is Nate (the Black 2/White 2 hero); the name shows in battle text and as your Pokémon's OT
  writeString(sav, PLAYER_OFS + 4, opts.playerName ?? PLAYER_NAME, 7, 16);
  const trainer = readTrainer(sav);
  const rng = mulberry32(opts.seed >>> 0);

  // ---- party
  const team = opts.team.slice(0, 6);
  dv.setUint32(PARTY_OFS, team.length, true);
  dv.setUint32(PARTY_OFS + 4, team.length, true);
  for (let i = 0; i < 6; i++) {
    const at = PARTY_OFS + 8 + i * PARTY;
    if (i < team.length) sav.set(encryptPK5(buildPK5(team[i], trainer, rng, opts.meta)), at);
    else sav.fill(0, at, at + PARTY);
  }

  // ---- PC boxes (so nobody swaps in their old team at the Pokémon Center)
  if (opts.clearBoxes !== false) {
    const blank = emptyStoredSlot();
    for (let box = 0; box < 24; box++) {
      const base = BOX_OFS + box * 0x1000;
      for (let s = 0; s < 30; s++) sav.set(blank, base + s * STORED);
    }
  }

  // ---- bag: empty Items, Medicine and Berries pockets (Key Items and TMs stay)
  if (opts.clearBag !== false) {
    sav.fill(0, INVENTORY_OFS + 0x000, INVENTORY_OFS + 0x4D8);
    sav.fill(0, INVENTORY_OFS + 0x7D8, INVENTORY_OFS + 0x9EC);
  }

  // ---- position: right outside Cynthia's villa in Undella Town
  const sp = opts.spawn || UNDELLA_SPAWN;
  const P = POSITION_OFS;
  writeSpawn(sav, P + 0x00, sp, 0);     // NowSpawnZone
  writeSpawn(sav, P + 0x54, UNDELLA_SPAWN, 0);  // EscapeRopeZone
  sav[P + 0x73] = opts.season ?? 0;     // 0 = spring (Cynthia only battles in spring)
  dv.setUint16(P + 0x74, 0, true);      // weather: clear
  dv.setUint16(P + 0x76, sp.zone, true);// place-name zone
  dv.setUint16(P + 0x80, sp.zone, true);
  dv.setInt32(P + 0x84, (sp.tileX * 16 + 8) * 0x1000, true);
  dv.setInt32(P + 0x88, sp.y * 0x1000, true);
  dv.setInt32(P + 0x8C, (sp.tileZ * 16 + 8) * 0x1000, true);
  dv.setUint16(P + 0x98, FACING[sp.facing] ?? 0x8000, true);

  // ---- make sure Cynthia is home and willing to battle today
  setFlag(sav, CYNTHIA.FLAG_HIDDEN, false);
  setFlag(sav, CYNTHIA.FLAG_BATTLED_TODAY, false);
  setWork(sav, CYNTHIA.WORK_DAILY, 0);
  setWork(sav, CYNTHIA.WORK_STAGE, 3);

  // ---- checksums (checksum table block last), then mirror into the backup copy
  for (const [ofs, len, chk, mirror] of BLOCKS) {
    const c = crc16(sav, ofs, len);
    dv.setUint16(chk, c, true);
    dv.setUint16(mirror, c, true);
  }
  sav.copyWithin(MAIN_SIZE, 0, MAIN_SIZE);
  return sav;
}

export function checksumsValid(sav) {
  const dv = new DataView(sav.buffer, sav.byteOffset, sav.byteLength);
  return BLOCKS.every(([ofs, len, chk, mirror]) => {
    const c = crc16(sav, ofs, len);
    return dv.getUint16(chk, true) === c && dv.getUint16(mirror, true) === c;
  });
}
