// Garchomple — figuring out where the ROM and save come from, and checking them.
import { getFile, putFile, localFile } from "./store.js";
import { fetchRetry } from "./net.js";
import { validate, isPostgame, readTrainer } from "./gen5save.js";

const ROM_CODES = {
  IRDO: "Pokémon White 2 (USA)", IREO: "Pokémon Black 2 (USA)",
  IRDP: "Pokémon White 2 (Europe)", IREP: "Pokémon Black 2 (Europe)",
  IRDD: "Pokémon White 2 (Germany)", IRED: "Pokémon Black 2 (Germany)",
  IRDF: "Pokémon White 2 (France)", IREF: "Pokémon Black 2 (France)",
  IRDI: "Pokémon White 2 (Italy)", IREI: "Pokémon Black 2 (Italy)",
  IRDS: "Pokémon White 2 (Spain)", IRES: "Pokémon Black 2 (Spain)",
  IRDJ: "Pokémon White 2 (Japan)", IREJ: "Pokémon Black 2 (Japan)",
  IRDK: "Pokémon White 2 (Korea)", IREK: "Pokémon Black 2 (Korea)",
};

export async function inspectRom(blob) {
  const head = new Uint8Array(await blob.slice(0, 0x20).arrayBuffer());
  const code = String.fromCharCode(...head.subarray(0x0C, 0x10));
  const name = ROM_CODES[code];
  if (!name) return { ok: false, code, message: `That isn't a Black 2 or White 2 ROM (game code ${code || "unknown"}).` };
  const tested = code === "IRDO" || code === "IREO";
  return { ok: true, code, name, warn: tested ? null : "Only the US releases have been tested; other regions should work but aren't guaranteed." };
}

export function inspectSave(bytes) {
  const problems = validate(bytes);
  if (problems.length) return { ok: false, message: "That isn't a Black 2 or White 2 save file (.sav, 512 KB)." };
  const trainer = readTrainer(bytes);
  if (!isPostgame(bytes)) return { ok: false, trainer, message: `${trainer.name}'s save hasn't entered the Hall of Fame yet. Cynthia only visits Undella after you become Champion.` };
  return { ok: true, trainer };
}

/** Returns {rom:{blob|url,size,info}, save:{bytes,info}, source} or partial. */
export async function loadSources() {
  const out = { rom: null, save: null };
  // 1) local development: ./local/rom.nds and ./local/base.sav (start.command links them in)
  const lr = await localFile("local/rom.nds");
  if (lr) {
    const headBlob = await (await fetch("local/rom.nds", { headers: { Range: "bytes=0-31" } })).blob();
    out.rom = { url: lr.url, size: lr.size, info: await inspectRom(headBlob.slice(0, 32)), source: "local" };
  }
  // the postgame save ships with the site (data/base.sav); ./local/base.sav overrides it for development
  for (const [path, source] of [["local/base.sav", "local"], ["data/base.sav", "bundled"]]) {
    if (out.save || !(await localFile(path))) continue;
    const bytes = new Uint8Array(await (await fetchRetry(path, { cache: "no-cache" })).arrayBuffer());
    out.save = { bytes, info: inspectSave(bytes), source };
  }
  // 2) what the player picked earlier (IndexedDB)
  if (!out.rom) {
    const r = await getFile("rom");
    if (r) out.rom = { blob: r.blob, size: r.blob.size, info: await inspectRom(r.blob), source: "browser", name: r.meta.name };
  }
  return out;
}

export async function storeRom(file) {
  const info = await inspectRom(file);
  if (info.ok) await putFile("rom", file, { name: file.name });
  return info;
}

export async function storeSave(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = inspectSave(bytes);
  if (info.ok) await putFile("save", new Blob([bytes]), { name: file.name });
  return info;
}

/**
 * The ROM as a File for the emulator, trimmed of the 0xFF padding at the end (White 2 is a 512 MB cart
 * holding ~280 MB of data, so this nearly halves what has to be read and copied), plus a key that
 * identifies this exact ROM for the snapshot cache.
 */
export async function romFile(rom) {
  const size = rom.size || (rom.blob && rom.blob.size) || 0;
  const read = async (a, b) => {
    if (rom.blob) return new Uint8Array(await rom.blob.slice(a, b).arrayBuffer());
    const res = await fetch(rom.url, { headers: { Range: `bytes=${a}-${b - 1}` } });
    if (res.status !== 206) throw new Error("no range support");
    return new Uint8Array(await res.arrayBuffer());
  };
  let cut = size, head = null;
  try {
    head = await read(0, 0x200);
    const used = (head[0x80] | head[0x81] << 8 | head[0x82] << 16 | head[0x83] << 24) >>> 0;
    if (used > 0x8000 && used < size) {
      // data can run a little past the header's "used" size; keep everything up to the first all-0xFF MB
      const MB = 1 << 20;
      let last = used;
      for (let a = used; a < size; a += MB) {
        const w = await read(a, Math.min(size, a + MB));
        let i = w.length - 1;
        while (i >= 0 && w[i] === 0xFF) i--;
        if (i < 0) break;
        last = a + i + 1;
      }
      cut = Math.min(size, Math.ceil(last / MB) * MB);
    }
  } catch { cut = size; }
  const hex = head ? [...head.subarray(0x0C, 0x10)].map(c => String.fromCharCode(c)).join("")
    + "-" + (head[0x15E] | head[0x15F] << 8).toString(16) + "-" + (head[0x1E] | 0) : "unknown";
  const romKey = `${hex}-${cut}`;
  let blob;
  if (rom.blob) blob = cut < size ? rom.blob.slice(0, cut) : rom.blob;
  else {
    const res = await fetch(rom.url, cut < size ? { headers: { Range: `bytes=0-${cut - 1}` } } : {});
    blob = await res.blob();
  }
  return { file: new File([blob], "cynthiale.nds", { type: "application/octet-stream" }), romKey, size: cut };
}
