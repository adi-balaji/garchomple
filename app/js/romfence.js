// Cynthiale — keep the player on Cynthia's doorstep.
//
// Before booting, we patch the ROM in memory (never on disk): nine of Undella Town's townsfolk
// are moved to stand in a ring around the villa door, so the player can only step around the
// few tiles in front of it (NPCs block movement). Field moves that could escape (Fly, Surf, Dig,
// Teleport) are never generated, and the bag (Escape Rope) is emptied by the save patch.
//
//   NDS file system → a/0/1/2 (zone headers) → zone 412's entity-file id
//                    → a/1/2/6 (zone entities NARC) → that file → NPC records (36 bytes each)

const UNDELLA_ZONE = 412;
// door is tile (745, 297); the player may stand on x 744..746, z 298..299
const FENCE = [
  // [x, z, facing]   facing: 0 north, 1 south, 2 west, 3 east
  [743, 300, 0], [744, 300, 0], [745, 300, 0], [746, 300, 0], [747, 300, 0],
  [743, 298, 3], [743, 299, 3], [747, 298, 2], [747, 299, 2],
];
const GROUND_Y = -64 * 0x1000;          // Undella's ground height (fx32), same as the villa warp
const SAFE_SCRIPTS = [5, 6, 8, 9, 15];  // plain townsfolk chatter from the Undella script file

async function reader(src) {
  if (src.blob) return (off, len) => src.blob.slice(off, off + len).arrayBuffer().then(b => new Uint8Array(b));
  return async (off, len) => {
    const r = await fetch(src.url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
    const buf = new Uint8Array(await r.arrayBuffer());
    if (r.status === 200 && buf.length > len) return buf.subarray(off, off + len);  // server ignored Range
    return buf;
  };
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function findFile(read, path) {
  const head = await read(0, 0x60);
  const fntOff = u32(head, 0x40), fntLen = u32(head, 0x44), fatOff = u32(head, 0x48);
  const fnt = await read(fntOff, fntLen);
  const parts = path.split("/");
  let dir = 0xF000;
  for (let p = 0; p < parts.length; p++) {
    const base = (dir & 0xFFF) * 8;
    let o = u32(fnt, base), fid = u16(fnt, base + 4), found = null;
    while (fnt[o]) {
      const t = fnt[o++], n = t & 0x7F;
      const name = String.fromCharCode(...fnt.subarray(o, o + n)); o += n;
      if (t & 0x80) { const sub = u16(fnt, o); o += 2; if (name === parts[p]) { found = { dir: sub }; break; } }
      else { if (name === parts[p]) { found = { fid }; break; } fid++; }
    }
    if (!found) throw new Error(`ROM: ${path} not found`);
    if (p === parts.length - 1) {
      const fat = await read(fatOff + found.fid * 8, 8);
      return { start: u32(fat, 0), end: u32(fat, 4) };
    }
    dir = found.dir;
  }
}

async function narcMember(read, file, index) {
  const head = await read(file.start, 0x10);
  const hsize = u16(head, 0x0C);
  const btaf = await read(file.start + hsize, 12);
  const btafSize = u32(btaf, 4), count = u16(btaf, 8);
  if (index >= count) throw new Error("ROM: NARC index out of range");
  const ent = await read(file.start + hsize + 12 + index * 8, 8);
  const btnfAt = file.start + hsize + btafSize;
  const btnfSize = u32(await read(btnfAt + 4, 4), 0);
  const gmifData = btnfAt + btnfSize + 8;
  return { start: gmifData + u32(ent, 0), end: gmifData + u32(ent, 4) };
}

/** Returns [{offset, bytes}] patches, or throws if the ROM layout isn't what we expect. */
export async function fencePatches(src) {
  const read = await reader(src);
  const zoneTable = await narcMember(read, await findFile(read, "a/0/1/2"), 0);
  const hdr = await read(zoneTable.start + UNDELLA_ZONE * 0x30, 0x30);
  const entId = u16(hdr, 22);
  const ent = await narcMember(read, await findFile(read, "a/1/2/6"), entId);
  const data = await read(ent.start, ent.end - ent.start);
  const nFurn = data[4], nNpc = data[5];
  if (nNpc < FENCE.length + 1) throw new Error("ROM: not enough NPCs in Undella Town");
  const npcBase = 8 + nFurn * 20;
  const out = new Uint8Array(nNpc * 36);
  out.set(data.subarray(npcBase, npcBase + nNpc * 36));
  const dv = new DataView(out.buffer);
  // reuse every NPC except the special one hidden behind flag 1226 (index 5 in US White 2)
  const slots = [];
  for (let i = 0; i < nNpc && slots.length < FENCE.length; i++) if (dv.getUint16(i * 36 + 8, true) !== 1226) slots.push(i);
  FENCE.forEach(([x, z, dir], k) => {
    const o = slots[k] * 36;
    dv.setUint16(o + 4, 0, true);                         // MoveCode: stand still
    dv.setUint16(o + 6, 0, true);                         // EvType: plain NPC
    dv.setUint16(o + 8, 0, true);                         // SpawnFlag 0: always present
    dv.setUint16(o + 10, SAFE_SCRIPTS[k % SAFE_SCRIPTS.length], true);
    dv.setUint16(o + 12, dir, true);
    dv.setUint16(o + 14, 0, true); dv.setUint16(o + 16, 0, true); dv.setUint16(o + 18, 0, true);
    dv.setUint16(o + 20, 0, true); dv.setUint16(o + 22, 0, true);   // no wander area
    dv.setUint32(o + 24, 0, true);                        // grid, not rail
    dv.setUint16(o + 28, x, true);
    dv.setUint16(o + 30, z, true);
    dv.setInt32(o + 32, GROUND_Y, true);
  });
  return [{ offset: ent.start + npcBase, bytes: out }];
}

/** Apply patches to a ROM Blob without copying it (Blob slices are lazy). */
export function applyPatches(blob, patches) {
  const parts = [];
  let at = 0;
  for (const p of patches.slice().sort((a, b) => a.offset - b.offset)) {
    parts.push(blob.slice(at, p.offset), p.bytes);
    at = p.offset + p.bytes.length;
  }
  parts.push(blob.slice(at));
  return new Blob(parts, { type: "application/octet-stream" });
}
