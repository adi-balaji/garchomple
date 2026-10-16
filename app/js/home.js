import { todayKey, dayNumber, prettyDate, teamFor, cynthia, msUntilTomorrow, shareText, dayKeysUntil,
         unlimitedSeed, newUnlimitedSeed, unlimitedTeam, seedLabel } from "./daily.js";
import { getResult, wasStarted, stats, unlimitedResult, unlimitedStats } from "./store.js";
import { loadSources, storeRom } from "./files.js";
import { $, h, renderTeam, renderOpponent, toast, fmtBytes } from "./ui.js";

const day = todayKey();
let mode = new URLSearchParams(location.search).get("mode") === "unlimited" ? "unlimited" : "daily";
try { if (!new URLSearchParams(location.search).get("mode")) mode = localStorage.getItem("cynthiale.mode") || "daily"; } catch { /* */ }
let entry = null, files = null, countdown = null;

async function init() {
  wireDialogs();
  wireSetup();
  $("#tab-daily").onclick = () => switchMode("daily");
  $("#tab-unlimited").onclick = () => switchMode("unlimited");
  $("#btn-newteam").onclick = () => { newUnlimitedSeed(); render(); };
  try {
    const cyn = await cynthia();
    renderOpponent($("#opponent"), cyn);
    $(".opp-foot").textContent = cyn.errors.length
      ? `cynthia-team.txt has a problem: ${cyn.errors[0]}${cyn.errors.length > 1 ? ` (+${cyn.errors.length - 1} more)` : ""}` : "";
    $(".opp-foot").classList.toggle("err", cyn.errors.length > 0);
    $(".opp-foot").hidden = !cyn.errors.length;
  } catch (e) { $(".opp-foot").textContent = `Couldn't load Cynthia's team: ${e.message}`; $(".opp-foot").hidden = false; }
  files = await loadSources();
  await render();
}

function switchMode(m) {
  mode = m;
  try { localStorage.setItem("cynthiale.mode", m); } catch { /* */ }
  render();
}

async function render() {
  $("#tab-daily").setAttribute("aria-selected", String(mode === "daily"));
  $("#tab-unlimited").setAttribute("aria-selected", String(mode === "unlimited"));
  $("#btn-newteam").hidden = mode !== "unlimited";
  const seed = mode === "unlimited" ? unlimitedSeed() : 0;
  $("#dayline").textContent = mode === "daily" ? prettyDate(day) : `Unlimited, team ${seedLabel(seed)}`;
  $("#team-title").textContent = mode === "daily" ? "Your team today" : "Your team";
  $("#team").replaceChildren(h("p", { class: "status" }, "Building the team…"));
  try {
    entry = mode === "daily" ? await teamFor(day) : await unlimitedTeam(seed);
    renderTeam($("#team"), entry.team);
  } catch (err) {
    entry = null;
    $("#team").replaceChildren(h("p", { class: "status err" }, err.message));
  }
  refreshFiles();
  renderResult();
}

let showSetup = false;
function refreshFiles() {
  const src = files;
  const romOk = src.rom && src.rom.info.ok, saveOk = src.save && src.save.info.ok;
  const btn = $("#btn-play"), hint = $("#play-hint");
  setSlot("rom", src.rom ? (romOk
      ? { ok: true, text: `${src.rom.info.name}, ${fmtBytes(src.rom.size)}${src.rom.source === "local" ? " (from your Cynthiale folder)" : ""}` }
      : { ok: false, text: src.rom.info.message }) : null);
  const ready = romOk && saveOk;
  // the ROM is asked for once; afterwards it lives in this browser and the setup box stays out of the way
  $("#setup").hidden = ready && !showSetup;
  $("#btn-change-rom").hidden = !ready || src.rom.source === "local";
  btn.disabled = !ready || !entry;
  if (!ready) {
    hint.textContent = !src.rom ? "Add your White 2 or Black 2 ROM below to start. You only need to do this once." :
      !romOk ? src.rom.info.message : !src.save ? "The game save couldn't be loaded; reload the page." : src.save.info.message;
    return;
  }
  if (mode === "unlimited") {
    const res = entry && unlimitedResult(entry.seed);
    btn.textContent = res ? "Play this team again" : "Battle Cynthia";
    hint.textContent = res ? "Result saved. Hit New team for a fresh six." : "Unlimited games count toward your Unlimited record.";
    btn.onclick = () => { location.href = `play.html?mode=unlimited&seed=${entry.seed}`; };
    return;
  }
  const res = getResult(day);
  if (res) { btn.textContent = "Replay for practice"; hint.textContent = "Today's result is saved. Practice runs don't change your stats."; }
  else if (wasStarted(day)) { btn.textContent = "Back to the battle"; hint.textContent = "You've started today's attempt; it counts once the battle ends."; }
  else { btn.textContent = "Battle Cynthia"; hint.textContent = src.rom.info.warn || "The game opens in Undella Town and walks you to her."; }
  btn.onclick = () => { location.href = `play.html?mode=daily&day=${day}`; };
}

function setSlot(kind, state) {
  const slot = $(`#slot-${kind}`), status = $(`#${kind}-status`);
  slot.classList.remove("ready", "bad");
  if (!state) return;
  slot.classList.add(state.ok ? "ready" : "bad");
  status.textContent = state.text;
}

function renderResult() {
  const slot = $("#result-slot");
  slot.replaceChildren();
  clearInterval(countdown);
  if (!entry) return;
  const res = mode === "daily" ? getResult(day) : unlimitedResult(entry.seed);
  if (!res) return;
  const text = shareText(day, res, entry.team, mode, entry.seed);
  const side = mode === "daily"
    ? h("div", { class: "countdown" }, h("span", { id: "cd" }), h("small", {}, "until the next Daily team"))
    : h("div", {}, h("button", { class: "cta", style: "font-size:18px;padding:12px 22px", onclick: () => { newUnlimitedSeed(); render(); } }, "New team"));
  slot.append(h("section", { class: "result-card" },
    h("div", {},
      h("h3", {}, res.won ? "You beat Cynthia" : "Cynthia won this time"),
      h("pre", {}, text),
      h("button", { class: "ghost", style: "margin-top:10px", onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast("Result copied"); } catch { toast("Copy didn't work; select the text instead"); }
      } }, "Copy result")),
    side));
  if (mode === "daily") {
    const tick = () => {
      const ms = msUntilTomorrow();
      const p = n => String(n).padStart(2, "0");
      $("#cd").textContent = `${p(Math.floor(ms / 3.6e6))}:${p(Math.floor(ms / 6e4) % 60)}:${p(Math.floor(ms / 1e3) % 60)}`;
      if (ms < 1000) location.reload();
    };
    tick(); countdown = setInterval(tick, 1000);
  }
}

function wireDialogs() {
  $("#btn-help").onclick = () => $("#dlg-help").showModal();
  $("#btn-stats").onclick = () => { renderStats(); $("#dlg-stats").showModal(); };
  document.querySelectorAll("dialog [data-close]").forEach(b => (b.onclick = () => b.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));
  try { if (!localStorage.getItem("cynthiale.seenHelp")) { $("#dlg-help").showModal(); localStorage.setItem("cynthiale.seenHelp", "1"); } } catch { /* ignore */ }
}

function renderStats() {
  const s = stats(dayKeysUntil(day));
  const grid = rows => rows.map(([v, l]) => h("div", {}, h("b", {}, String(v)), h("span", {}, l)));
  $("#stat-grid").replaceChildren(...grid([[s.played, "Played"], [s.winPct, "Win %"], [s.current, "Current streak"], [s.best, "Best streak"]]));
  const max = Math.max(1, ...s.dist.slice(1));
  const today = getResult(day);
  $("#dist").replaceChildren(...[1, 2, 3, 4, 5, 6].map(n =>
    h("div", {}, String(n), h("span", {
      class: today && today.won && today.standing === n ? "today" : "",
      style: `width:${Math.max(8, (s.dist[n] / max) * 100)}%` }, String(s.dist[n] || 0)))));
  const u = unlimitedStats();
  $("#stat-grid-unl").replaceChildren(...grid([[u.played, "Played"], [u.winPct, "Win %"], [u.best, "Best streak"], [u.avgStanding, "Avg. left on wins"]]));
}

function wireSetup() {
  const hook = (kind, store) => {
    const input = $(`#pick-${kind}`), slot = $(`#slot-${kind}`);
    const take = async file => {
      if (!file) return;
      $(`#${kind}-status`).textContent = `Checking ${file.name}…`;
      const info = await store(file);
      files = await loadSources();
      refreshFiles();
      if (!info.ok) setSlot(kind, { ok: false, text: info.message });
    };
    input.onchange = () => take(input.files[0]);
    slot.addEventListener("dragover", e => { e.preventDefault(); slot.classList.add("drag"); });
    slot.addEventListener("dragleave", () => slot.classList.remove("drag"));
    slot.addEventListener("drop", e => { e.preventDefault(); slot.classList.remove("drag"); take(e.dataTransfer.files[0]); });
  };
  hook("rom", async file => { const info = await storeRom(file); if (info.ok) showSetup = false; return info; });
  $("#btn-change-rom").onclick = () => { showSetup = true; refreshFiles(); $("#setup").scrollIntoView({ behavior: "smooth" }); };
}

init();
