// Garchomple — autopilot: boots the game from power-on to standing inside Cynthia's villa.
//
// The emulator doesn't expose game memory, so we look at the picture instead. Each frame is
// shrunk to a 16x12 grayscale "fingerprint" per DS screen and compared with fingerprints
// recorded from the real game (autopilot_refs.js, captured from US White 2 in melonDS).
// Knowing which screen we're on, we only press buttons that are safe there:
//
//   intro / title ......................... START until the main menu shows
//   main menu ............................. A (Continue is preselected)
//   "Launch C-Gear communications?" ....... Down, A  (No; Yes crashes with "Communication error")
//   "Some functions will be restricted" ... A        (Yes)
//   "Communication error" ................. reset the console and start over
//   overworld (C-Gear on the lower screen)  onArrive() (the page reveals the game / snapshots it), then Up into the villa
//   inside the villa ...................... A through Cynthia's lines (default YES) until the battle starts
//   battle on ............................. hand control to the player
//
// The emulator is fast-forwarded and muted, and the player's keys are ignored, while this runs.

import { REFS } from "./autopilot_refs.js";

const W = 16, H = 12;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Grab the emulator canvas on the next animation frame at the DS's native 256x384 (letterboxing removed). */
function grabFrame(emu) {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      const src = emu.canvas;
      const cw = src.width, ch = src.height, aspect = 256 / 384;
      let sw = cw, sh = ch, sx = 0, sy = 0;
      if (cw / ch > aspect) { sw = ch * aspect; sx = (cw - sw) / 2; } else { sh = cw / aspect; sy = (ch - sh) / 2; }
      const c = document.createElement("canvas");
      c.width = 256; c.height = 384;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, 256, 384);
      resolve(ctx.getImageData(0, 0, 256, 384).data);
    });
  });
}

/**
 * {top:number[192], bottom:number[192]}: mean luminance of each 16x16 block (0..255).
 * Averaging real blocks (instead of letting the browser shrink the image) makes the
 * fingerprint independent of how big the game is drawn on screen.
 */
export async function fingerprint(emu) {
  const px = await grabFrame(emu);
  const cells = new Float64Array(W * H * 2);
  for (let y = 0; y < 384; y++) {
    const row = (y >> 4) * W;
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      cells[row + (x >> 4)] += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
  }
  const lum = Array.from(cells, v => Math.round(v / 256));
  // redness of the upper half of the lower screen's centre: the battle screen's Poké Ball is dark red there,
  // the C-Gear (even dimmed behind dialogue) is blue-grey
  let r = 0, g = 0, n = 0;
  for (let y = 192 + 40; y < 192 + 120; y++) for (let x = 72; x < 184; x++) { const i = (y * 256 + x) * 4; r += px[i]; g += px[i + 1]; n++; }
  return { top: lum.slice(0, W * H), bottom: lum.slice(W * H), redness: Math.round((r - g) / n) };
}

function dist(a, b, from = 0, to = a.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += Math.abs(a[i] - b[i]);
  return s / (to - from);
}

/** Closest known screen within tolerance, or "unknown". */
export function classify(fp) {
  const hits = {};
  for (const [name, ref] of Object.entries(REFS)) {
    let d = 0, n = 0;
    if (ref.top) { d += dist(fp.top, ref.top); n++; }
    if (ref.bottom) { d += dist(fp.bottom, ref.bottom); n++; }
    d /= n;
    if (d < (ref.tol ?? 14)) hits[name] = d;
  }
  // priority matters: inside the villa the lower screen also shows the C-Gear ("overworld")
  if ("battle" in hits && fp.redness > 15) return { state: "battle", d: hits.battle };
  for (const name of ["comm_error", "cgear1", "cgear2", "menu", "villa", "overworld"]) {
    if (!(name in hits)) continue;
    let state = name;
    // the two C-Gear questions only differ in the text box (last three rows of the top screen)
    if ((name === "cgear1" || name === "cgear2") && REFS.cgear1 && REFS.cgear2) {
      const rows = [9 * W, 12 * W];
      state = dist(fp.top, REFS.cgear1.top, ...rows) <= dist(fp.top, REFS.cgear2.top, ...rows) ? "cgear1" : "cgear2";
    }
    return { state, d: hits[name] };
  }
  return { state: "unknown", d: null };
}

/** Swallow the player's keys (EmulatorJS reads them from its container). Returns the unlock function. */
export function lockKeys(emu) {
  const parent = emu.elements && emu.elements.parent;
  if (!parent) return () => {};
  const block = e => { e.stopImmediatePropagation(); e.preventDefault(); };
  parent.addEventListener("keydown", block, true);
  parent.addEventListener("keyup", block, true);
  return () => { parent.removeEventListener("keydown", block, true); parent.removeEventListener("keyup", block, true); };
}

/**
 * Drive the game to the villa. onStep(label) reports progress.
 * Resolves {ok:true} once the player is inside, or {ok:false, reason}.
 */
export async function runAutopilot(emu, { onStep = () => {}, onArrive = async () => {}, startPhase = "boot",
                                          timeoutMs = 180000, fast = 4, walkFast = 2, log = () => {} } = {}) {
  const gm = emu.gameManager;
  const BTN = { A: 8, B: 0, DOWN: 5, UP: 4, START: 3 };
  const press = async (k, hold = 140) => {
    gm.simulateInput(0, BTN[k], 1);
    await sleep(hold);
    gm.simulateInput(0, BTN[k], 0);
    await sleep(120);
  };

  const restore = [];
  const safely = (fn, undo) => { try { fn(); if (undo) restore.push(undo); } catch { /* optional feature */ } };
  // swallow the player's keys while we drive (EmulatorJS reads keys from its container element)
  safely(() => restore.push(lockKeys(emu)));
  const vol = typeof emu.volume === "number" ? emu.volume : 0.5;
  safely(() => emu.setVolume(0), () => emu.setVolume(vol));
  safely(() => { gm.setFastForwardRatio(fast); gm.toggleFastForward(1); }, () => gm.toggleFastForward(0));

  const started = performance.now();
  let phase = startPhase;          // boot → loading → walking → talking (a snapshot starts at "loading")
  let lastA = 0, overworldHits = 0, villaHits = 0, walkTries = 0, lastWalk = 0, resets = 0, talkStart = 0, battleHits = 0;
  onStep(phase === "boot" ? "Booting the cartridge" : "Loading Undella Town");
  try {
    while (performance.now() - started < timeoutMs) {
      const fp = await fingerprint(emu);
      const { state, d } = classify(fp);
      const now = performance.now();
      log(phase, state, d, fp.redness);

      if (state === "comm_error") {                   // only happens if "Yes" got pressed on the C-Gear question
        if (++resets > 2) return { ok: false, reason: "comm_error" };
        onStep("Restarting the console");
        gm.restart();
        phase = "boot"; overworldHits = 0;
        await sleep(1500);
        continue;
      }
      if (state === "menu") {
        onStep("Loading your save");
        await press("A");                              // Continue
        phase = "loading";
        await sleep(800);
        continue;
      }
      if (state === "cgear1") {
        onStep("Skipping C-Gear");
        await press("DOWN");
        await press("A");                              // No
        phase = "loading";
        await sleep(700);
        continue;
      }
      if (state === "cgear2") {
        await press("A");                              // Yes, restricted is fine
        phase = "loading";
        await sleep(700);
        continue;
      }
      if (state === "villa" && phase !== "talking") {
        if (++villaHits >= 2) { phase = "talking"; talkStart = now; onStep("Challenging Cynthia"); }
        await sleep(200);
        continue;
      }
      if (phase === "talking") {
        // Mash A through her lines (A also picks the default YES to "Would you care to be my opponent?")
        // until the battle screen is up, then hand over.
        if (state === "battle") {
          if (++battleHits >= 2) { onStep("Battle!"); return { ok: true }; }
        } else {
          battleHits = 0;
          if (now - talkStart > 60000) return { ok: false, reason: "battle didn't start" };
          if (now - lastA > 700) { await press("A"); lastA = performance.now(); }
        }
        await sleep(200);
        continue;
      }
      villaHits = 0;

      if (state === "overworld" && phase !== "boot") {
        // standing somewhere with the C-Gear on the lower screen: outside the door, or inside but not yet
        // in front of Cynthia. Step north until the villa view matches (Cynthia blocks the 4th step).
        if (++overworldHits >= 2 && phase === "loading") {
          // standing in Undella Town: the page shows the game from here (and may snapshot it)
          phase = "walking";
          await onArrive();
          safely(() => gm.setFastForwardRatio(walkFast));
          onStep("Walking into Caitlin's villa");
        }
        if (phase === "walking" && now - lastWalk > 1600) {
          if (walkTries >= 8) return { ok: false, reason: "couldn't reach Cynthia" };
          walkTries++;
          lastWalk = now;
          await press("UP", 260);
        }
        await sleep(200);
        continue;
      }
      overworldHits = 0;

      // unknown screen: during boot it's the intro or title, so START moves things along.
      // START never answers a Yes/No question, so an unrecognised prompt can't be confirmed by
      // accident; after Continue nothing is pressed blind (A in the overworld would start talking).
      if (phase === "boot" && now - lastA > 900) {
        await press("START");
        lastA = performance.now();
      }
      await sleep(250);
    }
    return { ok: false, reason: "timeout" };
  } finally {
    restore.reverse().forEach(f => { try { f(); } catch { /* ignore */ } });
  }
}
