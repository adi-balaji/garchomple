import { loadResets, todayKey, dayNumber, prettyDate, teamFor, shareText, unlimitedTeam, newUnlimitedSeed, seedLabel } from "./daily.js";
import { getResult, setResult, markStarted, addUnlimited } from "./store.js";
import { loadSources, romFile } from "./files.js";
import { fetchRetry } from "./net.js";
import { loadTeamText, parseTeam, patchRom } from "./cynthiateam.js";
import { loadSnapshot, storeSnapshot, dropSnapshot, swapParty } from "./snapshot.js";
import { patchSave } from "./gen5save.js";
import { watchBattle } from "./monitor.js";
import { $, h, spriteImg, toast } from "./ui.js";
import { runAutopilot, fingerprint, classify, lockKeys } from "./autopilot.js";

const params = new URLSearchParams(location.search);
const today = todayKey();
const mode = params.get("mode") === "unlimited" ? "unlimited" : "daily";
const day = params.get("day") && params.get("day") <= today ? params.get("day") : today;
const seed = Number(params.get("seed")) >>> 0;
await loadResets();
const practice = mode === "daily" && (!!getResult(day) || day !== today);
const autopilotOn = params.get("autopilot") !== "0";
// developer shortcut (localhost only): ?debug=strong / ?debug=weak to test win / loss detection fast
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const debug = local ? params.get("debug") : null;

const status = (msg, err = false) => { const s = $("#status"); s.textContent = msg; s.classList.toggle("err", err); };
const log = (...a) => (window.__cynLog = window.__cynLog || []).push([Math.round(performance.now()), ...a]);
let entry = null, saveBytes = null, recorded = false, rom = null, snap = null;
const mark = k => ((window.__cynT = window.__cynT || {})[k] = Math.round(performance.now()));

function overlay(show, step) {
  const o = $("#boot-overlay");
  o.hidden = !show;
  if (step) $("#boot-step").textContent = step;
}
function setReady(ok, nearly = false) {
  const r = $("#help-ready");
  r.hidden = false;
  r.textContent = nearly ? "You're in the villa. Close this, walk up to Cynthia with the arrow keys and press Z."
    : ok ? "The battle has started! Close this and fight."
    : "Auto-start didn't finish. Close this and continue by hand: Enter through the intro, Z on Continue, then No, then Yes to the C-Gear questions.";
  $("#help-close").textContent = ok ? "Fight!" : "Close";
}

function applyDebug(team) {
  if (!debug) return team;
  return team.map(m => debug === "weak"
    ? { ...m, level: 5, stats: { hp: 12, atk: 5, def: 5, spa: 5, spd: 5, spe: 5 } }
    : { ...m, level: 100, stats: { hp: 999, atk: 999, def: 999, spa: 999, spd: 999, spe: 999 } });
}

async function main() {
  $("#dayline").textContent = mode === "unlimited" ? `Unlimited, team ${seedLabel(seed)}`
    : `${prettyDate(day)}${practice ? " (practice)" : ""}`;
  wireHelp();
  // start reading the ROM (and any snapshot) right away, in parallel with building the team
  const srcP = loadSources();
  const romP = srcP.then(src => (src.rom && src.rom.info.ok ? romFile(src.rom) : null)).catch(() => null);
  const snapP = romP.then(r => (r && autopilotOn ? loadSnapshot(r.romKey) : null)).catch(() => null);
  const dataPathP = emulatorDataPath();
  try { entry = mode === "unlimited" ? await unlimitedTeam(seed) : await teamFor(day); }
  catch (e) { return status(e.message, true); }
  renderMini(entry.team);
  wireManual();
  if (practice) $("#result-note").textContent = "Today's Daily result is already saved; this run is practice and won't change it.";
  if (debug) $("#result-note").textContent = `Debug team (${debug}); results aren't saved.`;

  const src = await srcP;
  if (!src.rom || !src.rom.info.ok || !src.save || !src.save.info.ok) {
    return status("Add your ROM on the home page first (you only need to do it once).", true);
  }

  // the save: this team, empty boxes and bag, standing at Cynthia's door in spring
  const now = new (window.__RealDate || Date)();
  try {
    saveBytes = patchSave(src.save.bytes, { team: applyDebug(entry.team), seed: entry.seed,
      meta: { metDate: [now.getFullYear() % 100, now.getMonth() + 1, now.getDate()] } });
  } catch (e) {
    return status(`Couldn't prepare the save: ${e.message}`, true);
  }
  if (mode === "daily" && !practice && !debug) markStarted(day);

  status("Loading the game…");
  overlay(autopilotOn, "Loading the cartridge");
  rom = await romP;
  if (!rom) return status("Couldn't read your ROM. Add it again on the home page.", true);
  // Cynthia's team from cynthia-team.txt, written into (a copy of) the game's trainer data
  try {
    const team = await parseTeam(await loadTeamText());
    if (team.errors.length) {
      overlay(false);
      return status(`Fix cynthia-team.txt, then reload: ${team.errors.join(" · ")}`, true);
    }
    rom.file = new File([await patchRom(rom.file, team)], "cynthiale.nds", { type: "application/octet-stream" });
    log("cynthia", team.mons.map(m => m.display).join(","));
  } catch (e) {
    overlay(false);
    return status(`Couldn't apply cynthia-team.txt: ${e.message}`, true);
  }
  snap = await snapP;
  mark("romReady");
  log("rom", rom.romKey, rom.size, snap ? `snapshot (${snap.source})` : "no snapshot");
  overlay(autopilotOn, snap ? "Loading Undella Town" : "First run: booting the cartridge (later starts are much faster)");
  status("Starting the emulator…");
  await bootEmulator(rom.file, await dataPathP);
}

async function emulatorDataPath() {
  try {
    const r = await fetchRetry("vendor/emulatorjs/data/loader.js", { method: "HEAD" }, 4);
    if (r.ok) return "vendor/emulatorjs/data/";
  } catch { /* fall through */ }
  return "https://cdn.emulatorjs.org/4.2.3/data/";
}

async function bootEmulator(romUrl, dataPath) {
  Object.assign(window, {
    EJS_player: "#game",
    EJS_core: "melonds",
    EJS_gameUrl: romUrl,
    EJS_gameName: "cynthiale",
    EJS_pathtodata: dataPath,
    EJS_startOnLoaded: true,
    EJS_disableDatabases: true,
    EJS_color: "#e0532f",
    EJS_backgroundColor: "#1d2634",
    EJS_Buttons: { saveState: false, loadState: false, quickSave: false, quickLoad: false, cheat: false,
                   saveSavFiles: false, loadSavFiles: false, netplay: false, cacheManager: false, exitEmulation: false },
    EJS_onGameStart: async () => {
      mark("gameStart");
      const emu = window.EJS_emulator, gm = emu.gameManager;
      const path = gm.getSaveFilePath();
      try { gm.FS.unlink(path); } catch { /* none yet */ }
      try { gm.FS.mkdirTree(path.slice(0, path.lastIndexOf("/"))); } catch { /* exists */ }
      gm.FS.writeFile(path, saveBytes);
      gm.loadSaveFiles();
      let loc = null;
      if (snap) {
        // jump straight to Undella Town and put today's team into the party
        gm.loadState(snap.state);
        for (let t = 0; t < 8 && !loc; t++) {
          await new Promise(r => setTimeout(r, 120));
          loc = swapParty(emu, snap.save, saveBytes);
        }
        log("swap", loc ? JSON.stringify(loc) : "failed");
        if (!loc) { dropSnapshot(rom.romKey); snap = null; overlay(true, "Booting the cartridge"); }
      }
      if (!snap) gm.restart();
      mark("stateReady");
      window.__cynthialeStarted = true;
      window.__cynFP = async () => { const fp = await fingerprint(emu); return { fp, ...classify(fp) }; };
      if (!autopilotOn) {
        status("Running. Press Enter through the intro and Z on Continue. Cynthia's villa is right in front of you.");
        startWatching();
        return;
      }
      status("Auto-starting: skipping the intro and loading your save…");
      const fresh = !snap;
      runAutopilot(emu, {
        startPhase: snap ? "loading" : "boot", log,
        onStep: step => { if (!$("#boot-overlay").hidden) overlay(true, step); },
        onArrive: async () => {
          mark("undella");
          if (fresh) {                                 // remember this moment so the next start skips the boot
            try { const st = gm.getState(); storeSnapshot(rom.romKey, st, saveBytes).then(ok => log("snapshot stored", ok, st.length)); }
            catch (e) { log("snapshot failed", e.message); }
          }
          overlay(false);
          status("Undella Town. Walking you in to Cynthia; your keyboard unlocks when the battle starts.");
        },
      }).then(res => {
        mark("battle");
        overlay(false);
        window.__cynthialeReady = res.ok;
        const nearly = res.reason === "couldn't reach Cynthia";
        status(res.ok ? "The battle is on! Your keyboard is live until it ends."
               : nearly ? "You should be in Caitlin's villa. Walk up to Cynthia with the arrow keys and press Z."
               : res.reason === "battle didn't start" ? "Talk to Cynthia with Z and say Yes to start the battle."
               : "Auto-start didn't finish. Press Enter through the intro, Z on Continue, then answer No, then Yes to the C-Gear questions.", !res.ok && !nearly);
        setReady(res.ok || nearly, nearly);
        if (!$("#dlg-help").open) focusGame();
        startWatching(loc);
      });
    },
  });
  // no RetroArch on-screen text (its "Fast-Forward." badge would sit over the game during the walk-in):
  // add to the config EmulatorJS writes before the core starts
  const quietOsd = setInterval(() => {
    const GM = window.EJS_GameManager;
    if (!GM || GM.prototype.__quiet) return;
    clearInterval(quietOsd);
    const base = GM.prototype.getRetroArchCfg;
    GM.prototype.getRetroArchCfg = function () {
      return base.call(this) + 'video_font_enable = "false"\nmenu_enable_widgets = "false"\nnotification_show_fast_forward = "false"\n';
    };
    GM.prototype.__quiet = true;
  }, 5);
  setTimeout(() => clearInterval(quietOsd), 60000);
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${dataPath}loader.js`;
    s.onload = resolve;
    s.onerror = () => reject(new Error("couldn't load the emulator"));
    document.body.append(s);
  }).catch(e => status(`${e.message}. Check that vendor/emulatorjs exists or that you're online.`, true));
}

async function startWatching(loc = null) {
  // the moment the battle looks over: keyboard off and sound off while the outcome is confirmed,
  // so nobody can walk around afterwards (a loss sends you to a Pokémon Center)
  const emu = window.EJS_emulator;
  let unlock = null, vol = null;
  const onEnding = () => {
    if (!unlock) unlock = lockKeys(emu);
    try { if (vol === null) { vol = emu.volume; emu.setVolume(0); } } catch { /* optional */ }
    status("Battle over. Tallying the result…");
  };
  const onResume = () => {
    if (unlock) { unlock(); unlock = null; }
    try { if (vol !== null) { emu.setVolume(vol); vol = null; } } catch { /* optional */ }
    status("The battle is on! Your keyboard is live until it ends.");
  };
  const res = await watchBattle(emu, saveBytes, applyDebug(entry.team), { log, loc, onEnding, onResume });
  if (!res) {
    $("#result-note").textContent = "Couldn't read the game's memory, so the result can't be detected automatically.";
    $("#manual").hidden = false;
    $("#manual").open = true;
    return;
  }
  finish(res);
}

function finish(res) {
  if (recorded) return;
  recorded = true;
  try { window.EJS_emulator.pause(); } catch { /* manual log without emulator */ }
  try { lockKeys(window.EJS_emulator); } catch { /* manual log without emulator */ }
  let note;
  if (debug) note = "Debug run: not saved.";
  else if (mode === "unlimited") { addUnlimited(entry.seed, res); note = "Saved to your Unlimited record."; }
  else if (!practice) { setResult(day, res); note = "Saved. Come back tomorrow for a new team."; }
  else note = "Practice run: not saved.";
  const text = shareText(day, res, entry.team, mode, entry.seed);
  $("#share").textContent = text;
  $("#share").hidden = false;
  $("#result-note").textContent = note;
  $("#manual").hidden = true;
  status(res.won ? "You beat Cynthia!" : "Cynthia won this time.");

  $("#ro-title").textContent = res.won ? "You beat Cynthia!" : "Cynthia wins";
  $("#ro-text").textContent = `${text}\n\n${note}`;
  const actions = [
    h("button", { class: "ghost", onclick: async () => {
      try { await navigator.clipboard.writeText(text); toast("Result copied"); } catch { toast("Copy didn't work; select the text instead"); }
    } }, "Copy result"),
  ];
  if (mode === "unlimited") {
    actions.unshift(h("button", { class: "cta", style: "font-size:18px;padding:12px 22px", onclick: () => {
      location.href = `play.html?mode=unlimited&seed=${newUnlimitedSeed()}`;
    } }, "New team"));
    actions.push(h("button", { class: "ghost", onclick: () => location.reload() }, "Rematch with this team"));
  } else {
    actions.unshift(h("a", { class: "cta", style: "font-size:18px;padding:12px 22px;text-decoration:none", href: "./" }, "Back to Garchomple"));
    actions.push(h("a", { class: "ghost", style: "text-decoration:none", href: "./?mode=unlimited" }, "Try Unlimited"));
  }
  $("#ro-actions").replaceChildren(...actions);
  $("#result-overlay").hidden = false;
}

function renderMini(team) {
  $("#mini-team").replaceChildren(...team.map(mn =>
    h("div", { class: "mini" },
      spriteImg(mn.species, mn.display),
      h("div", {},
        h("b", {}, `${mn.display} `), h("span", {}, `Lv ${mn.level} @ ${mn.itemName}`),
        h("div", { class: "mv" }, mn.moveInfo.map(x => x.name).join(", "))))));
}

function wireManual() {
  let outcome = null, count = null;
  const btns = [...document.querySelectorAll("[data-outcome]")];
  const logBtn = $("#btn-log");
  const renderPips = () => {
    $("#count-wrap").hidden = outcome !== "won";
    $("#pips").replaceChildren(...[1, 2, 3, 4, 5, 6].map(n => h("button", { type: "button", "aria-pressed": String(count === n),
      onclick: () => { count = n; renderPips(); update(); } }, String(n))));
  };
  const update = () => { logBtn.disabled = !outcome || (outcome === "won" && count === null); };
  btns.forEach(b => (b.onclick = () => {
    outcome = b.dataset.outcome; count = null;
    btns.forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderPips(); update();
  }));
  logBtn.onclick = () => finish(outcome === "won"
    ? { won: true, standing: count, hpPct: null, knockedOut: 6, manual: true }
    : { won: false, standing: 0, hpPct: 0, knockedOut: null, manual: true });
}

// EmulatorJS only hears keys while its container has focus
function focusGame() {
  const p = window.EJS_emulator && window.EJS_emulator.elements && window.EJS_emulator.elements.parent;
  if (p) p.focus({ preventScroll: true });
}

function wireHelp() {
  $("#btn-help").onclick = () => $("#dlg-help").showModal();
  $("#dlg-help").addEventListener("close", focusGame);
  document.querySelectorAll("dialog [data-close]").forEach(b => (b.onclick = () => b.closest("dialog").close()));
}

main();
