// Garchomple — shared rendering helpers.
import { TYPE_COLORS, sprite } from "./daily.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
};

export const typeChip = t => h("span", { class: "type", style: `background:${TYPE_COLORS[t]}` }, t);

// local sprite first; Pokémon added to the dex later fall back to PokeAPI's copy
const REMOTE = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${id}.gif`;
export function spriteImg(id, alt) {
  return h("img", { src: sprite(id), alt, loading: "lazy", class: "px",
    onerror: e => { const img = e.currentTarget; if (!img.dataset.remote) { img.dataset.remote = "1"; img.src = REMOTE(id); } } });
}

const STAT_LABEL = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const GENDER = ["♂", "♀", ""];

export function monCard(m) {
  const statRows = Object.keys(STAT_LABEL).map(k => {
    const pct = Math.min(100, Math.round((m.stats[k] / 400) * 100));
    return h("div", { class: "statline" },
      h("b", {}, STAT_LABEL[k]),
      h("div", { class: "bar" }, h("span", { class: m.evs[k] >= 252 ? "ev" : "", style: `width:${pct}%` })),
      h("span", {}, String(m.stats[k])));
  });
  const evs = Object.entries(m.evs).filter(([, v]) => v).map(([k, v]) => `${v} ${STAT_LABEL[k]}`).join(" / ");
  const card = h("button", { class: "mon", type: "button", "aria-expanded": "false",
      onclick: e => { const b = e.currentTarget; b.setAttribute("aria-expanded", b.getAttribute("aria-expanded") === "true" ? "false" : "true"); } },
    h("div", { class: "mon-top" },
      spriteImg(m.species, m.display),
      h("div", {},
        h("div", { class: "mon-name" }, `${m.display} ${GENDER[m.gender]}`),
        h("div", { class: "mon-sub" }, `Lv ${m.level}`),
        h("div", { class: "types" }, m.types.map(typeChip)))),
    h("div", { class: "mon-sub" }, `${m.itemName} · ${m.abilityName}`),
    h("ul", { class: "moves" }, m.moveInfo.map(mv =>
      h("li", { title: `${mv.class}${mv.power ? `, ${mv.power} power` : ""}` },
        h("i", { style: `background:${TYPE_COLORS[mv.type]}` }), mv.name))),
    h("div", { class: "mon-detail" },
      h("div", {}, `${m.natureName} nature · ${evs} EVs · 31 IVs`),
      h("div", { style: "margin-top:6px;display:grid;gap:3px" }, statRows)));
  return card;
}

export function renderTeam(el, team) {
  el.replaceChildren(...team.map(m => monCard(m)));
}

export function renderOpponent(el, cyn) {
  el.replaceChildren(...cyn.team.map(p =>
    h("div", { class: "opp", title: `${p.display}${p.item ? ` @ ${p.item}` : ""}${p.ability ? ` (${p.ability})` : ""}: ${p.moves.map(m => m.name).join(", ")}` },
      spriteImg(p.species, p.display),
      h("span", { class: "lv" }, `Lv ${p.level}`))));
}

export function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = h("div", { class: "toast", role: "status" }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2200);
}

export function fmtBytes(n) {
  return n > 1e6 ? `${(n / 1048576).toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`;
}
