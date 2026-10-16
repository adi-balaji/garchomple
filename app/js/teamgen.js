import { fetchRetry } from "./net.js";
// Garchomple — team generator. Samples a balanced, fully trained six straight from data/dex/.
// Same seed → same team on every machine (own PRNG, no Math.random), so the Daily team is shared
// and Unlimited mode just uses a fresh random seed.
//
// Rules live in data/dex/rules.json:
//   * no base forms; middle stages only if strong (BST >= middleStageMinBst, they hold an Eviolite)
//   * fully evolved / non-evolving Pokémon within [bstMin, bstMax] (legendaries/mythicals per excludeLegendary/excludeMythical)
//   * at most `maxPerType` team members share a type
//   * banned species and banned (game-breaking) abilities are never used

const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];
const API_STAT = { hp: "hp", attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe" };
const DEX = "data/dex/";

// ------------------------------------------------------------------ randomness
export function hashSeed(str) {                 // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function rng32(seed) {                   // mulberry32
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return next;
}
export function randomSeed() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0];
}

// ------------------------------------------------------------------ data
let dexPromise = null;
const speciesCache = new Map();
const getJSON = async url => { const r = await fetchRetry(url); if (!r.ok) throw new Error(`Couldn't load ${url}`); return r.json(); };

export function loadDex() {
  dexPromise ||= (async () => {
    const [index, moves, abilities, items, natures, chart, growth, rules] = await Promise.all(
      ["species/index.json", "moves.json", "abilities.json", "items.json", "natures.json", "typechart.json", "growth.json", "rules.json"]
        .map(f => getJSON(DEX + f)));
    const movesByName = {};
    for (const m of Object.values(moves)) movesByName[m.name] = m;
    const natureByIndex = {};
    for (const [k, n] of Object.entries(natures)) natureByIndex[n.index] = { key: k, ...n };
    return { index, moves, movesByName, abilities, items, natures, chart, growth, rules, types: Object.keys(chart) };
  })();
  dexPromise.catch(() => { dexPromise = null; });   // a failed load is retried next time, not remembered
  return dexPromise;
}

async function loadSpecies(entry) {
  if (!speciesCache.has(entry.file)) {
    const p = getJSON(`${DEX}species/${entry.file}`);
    p.catch(() => speciesCache.delete(entry.file));
    speciesCache.set(entry.file, p);
  }
  return speciesCache.get(entry.file);
}

const bst = s => STATS.reduce((a, k) => a + s.base[k], 0);

/** Every species the rules allow, with the reason others were dropped (handy when editing rules.json). */
export function eligible(dex) {
  const R = dex.rules, banned = new Set(R.bannedSpecies), badAb = new Set(R.bannedAbilities);
  return dex.index.filter(s => {
    if (banned.has(s.name)) return false;
    if (R.excludeLegendary && s.legendary) return false;
    if (R.excludeMythical && s.mythical) return false;
    if (!s.abilities.some(a => !badAb.has(a.name) && dex.abilities[a.name])) return false;
    const evolves = s.evolvesTo.length > 0;
    const t = bst(s);
    if (evolves) return !!s.evolvesFrom && t >= R.middleStageMinBst;     // strong middle stage only
    return t >= R.bstMin && t <= R.bstMax;                               // final / single stage
  });
}

// ------------------------------------------------------------------ team draft (types + balance)
function eff(dex, atk, defTypes) { return defTypes.reduce((m, t) => m * dex.chart[atk][t], 1); }

function draftOnce(dex, pool, rng, maxPerType, forced = null) {
  const R = dex.rules, pseudos = new Set(R.pseudoLegendaries);
  const order = rng.shuffle(pool.slice());
  const team = [], typeCount = {};
  let nPseudo = 0;
  if (forced) { team.push(forced); forced.types.forEach(t => (typeCount[t] = 1)); }
  for (const s of order) {
    if (team.length === R.teamSize) break;
    if (s.types.some(t => (typeCount[t] || 0) >= maxPerType)) continue;
    if (pseudos.has(s.name) && nPseudo >= R.maxPseudoLegendaries) continue;
    team.push(s);
    s.types.forEach(t => (typeCount[t] = (typeCount[t] || 0) + 1));
    if (pseudos.has(s.name)) nPseudo++;
  }
  return team.length === R.teamSize ? team : null;
}

/**
 * Basic balance checks a draft must pass. Taking the FIRST draft that passes (rather than the best-scoring of
 * many) keeps every eligible Pokémon about equally likely; picking the "best" draft favoured high-BST and
 * Steel-type Pokémon (Garchomp, Salamence, Probopass…) several times over.
 */
function acceptable(dex, team) {
  for (const t of dex.types) if (team.filter(s => eff(dex, t, s.types) > 1).length >= 4) return false;
  if (!team.some(s => s.base.atk > s.base.spa + 10) || !team.some(s => s.base.spa > s.base.atk + 10)) return false;
  return team.some(s => s.base.spe >= 95);
}

function scoreDraft(dex, team) {
  let score = -Math.abs(team.reduce((a, s) => a + bst(s), 0) - 3150) / 40;
  for (const t of dex.types) {                       // shared weaknesses
    const weak = team.filter(s => eff(dex, t, s.types) > 1).length;
    const resist = team.filter(s => eff(dex, t, s.types) < 1).length;
    if (weak >= 3) score -= (weak - 2) * 2.5;
    if (resist === 0) score -= 1;
  }
  const phys = team.filter(s => s.base.atk > s.base.spa + 10).length;
  const spec = team.filter(s => s.base.spa > s.base.atk + 10).length;
  if (!phys || !spec) score -= 4;
  if (!team.some(s => s.base.spe >= 95)) score -= 2;
  const types = new Set(team.flatMap(s => s.types)).size;
  score += types * 0.5;                              // reward variety
  return score;
}

// ------------------------------------------------------------------ sets
function moveScore(dex, mv, s, category) {
  const P = dex.rules.movePolicy, name = mv.name;
  if (P.excludeMoves.includes(name) || mv.class === "status") return 0;
  if (category !== "mixed" && mv.class !== category) return 0;
  const power = P.fixedPower[name] ?? mv.power;
  if (!power) return 0;
  if (mv.priority > 0 && !P.priorityOk.includes(name)) return 0;
  if (power < 60 && !P.priorityOk.includes(name) && !(name in P.fixedPower)) return 0;
  let hits = 1;
  if (mv.meta.minHits) hits = mv.meta.maxHits !== 5 ? (mv.meta.minHits + mv.meta.maxHits) / 2 : 3;
  const acc = (mv.accuracy || 100) / 100;
  const stab = s.types.includes(mv.type) && !(name in P.fixedPower) ? 1.5 : 1;
  let score = power * hits * acc ** 1.5 * stab * (P.statDropPenalty[name] ?? 1);
  if (P.priorityOk.includes(name)) score *= 0.75;
  if (mv.meta.drain) score *= mv.meta.drain > 0 ? 1.05 : 0.92;
  return score;
}

function roleOf(s) {
  const b = s.base, off = Math.max(b.atk, b.spa), bulk = b.hp + b.def + b.spd;
  const category = Math.abs(b.atk - b.spa) <= 10 ? "mixed" : b.atk > b.spa ? "physical" : "special";
  const nfe = s.evolvesTo.length > 0;
  const role = nfe || (off < 85 && bulk >= 270) || (off < 95 && bulk >= 330 && b.spe < 70) ? "wall"
    : b.spe >= 85 ? "sweeper" : "bulky";
  return { role, category };
}

function buildSet(dex, s, rng) {
  const P = dex.rules.movePolicy, b = s.base;
  let { role, category } = roleOf(s);
  const ids = [...new Set(Object.values(s.learnset).flat())];
  const learn = ids.map(id => dex.moves[id]).filter(Boolean);
  const names = new Set(learn.map(m => m.name));

  if (category === "mixed") {
    const best = cat => Math.max(0, ...learn.filter(m => s.types.includes(m.type)).map(m => moveScore(dex, m, s, cat)));
    category = best("physical") * b.atk >= best("special") * b.spa ? "physical" : "special";
  }
  const offStat = category === "physical" ? "atk" : "spa";
  const scored = learn.map(m => [moveScore(dex, m, s, category), m]).filter(x => x[0] > 0).sort((x, y) => y[0] - x[0] || x[1].id - y[1].id);

  const chosen = [];
  for (const t of s.types) {                                   // 1) STAB
    const hit = scored.find(([, m]) => m.type === t && !chosen.includes(m));
    if (hit) chosen.push(hit[1]);
  }
  const utility = [];                                          // 2) role utility
  const pick = (options, chance = 1) => {
    const opts = options.filter(o => names.has(o) && !utility.includes(o));
    if (opts.length && rng() < chance) { utility.push(opts.length > 1 ? rng.pick(opts.slice(0, 3)) : opts[0]); return true; }
    return false;
  };
  const setup = category === "physical" ? P.setupPhysical : P.setupSpecial;
  if (role === "sweeper") pick(setup, 0.6);
  else if (role === "bulky") { if (!pick(P.recovery.slice(0, -1), 0.5)) pick(setup, 0.35) || pick(P.status, 0.4); }
  else { pick(P.recovery, 1); pick(P.status, 0.9); if (utility.length < 2) pick(P.support, 0.7); }

  const covered = ms => new Set(dex.types.filter(t => ms.some(m => eff(dex, m.type, [t]) > 1)));
  const nAttacks = 4 - utility.length;                         // 3) coverage
  while (chosen.length < nAttacks) {
    const have = covered(chosen);
    let best = null, bestVal = 0;
    for (const [sc, m] of scored) {
      if (chosen.includes(m) || chosen.some(c => c.type === m.type)) continue;
      const gain = [...covered([...chosen, m])].filter(t => !have.has(t)).length;
      const val = sc * (0.35 + 0.65 * Math.min(gain, 4) / 4) * (0.9 + 0.2 * rng());
      if (val > bestVal) { best = m; bestVal = val; }
    }
    if (!best) break;
    chosen.push(best);
  }
  while (chosen.length + utility.length < 4) {                // thin movepool: utility before duplicates
    if (!(pick(P.status) || pick(P.recovery.slice(0, -1)) || pick(P.support) || pick(setup))) break;
  }
  for (const [, m] of scored) { if (chosen.length + utility.length >= 4) break; if (!chosen.includes(m)) chosen.push(m); }
  const moves = [...chosen.slice(0, 4 - utility.length), ...utility.map(u => dex.movesByName[u])];
  const extra = learn.filter(m => !moves.includes(m) && !P.excludeMoves.includes(m.name)).sort((x, y) => x.id - y.id);
  while (moves.length < 4 && extra.length) moves.push(extra.splice(Math.floor(rng() * extra.length), 1)[0]);

  const evs = Object.fromEntries(STATS.map(k => [k, 0]));       // 4) spread
  let nature;
  if (role === "sweeper") {
    evs[offStat] = 252; evs.spe = 252; evs.hp = 4;
    nature = b.spe >= 100 && rng() < 0.5 ? (category === "physical" ? "adamant" : "modest") : (category === "physical" ? "jolly" : "timid");
  } else if (role === "bulky") {
    evs.hp = 252; evs[offStat] = 252; evs[b.def >= b.spd ? "spd" : "def"] = 4;
    nature = category === "physical" ? "adamant" : "modest";
  } else {
    const physWall = b.def <= b.spd;
    evs.hp = 252; evs[physWall ? "def" : "spd"] = 252; evs[physWall ? "spd" : "def"] = 4;
    nature = physWall ? (category === "physical" ? "impish" : "bold") : (category === "physical" ? "careful" : "calm");
  }

  const banned = new Set(dex.rules.bannedAbilities);           // 5) ability
  const great = new Set(dex.rules.abilityPreference.great), avoid = new Set(dex.rules.abilityPreference.avoid);
  const opts = s.abilities.filter(a => dex.abilities[a.name] && !banned.has(a.name))
    .map(a => [great.has(a.name) ? 3 : avoid.has(a.name) ? 0.05 : 1, a]);
  let r = rng() * opts.reduce((x, [w]) => x + w, 0), ability = opts[opts.length - 1][1];
  for (const [w, a] of opts) { r -= w; if (r <= 0) { ability = a; break; } }
  // rules.json abilityPreference.fixed pins an ability (the random draw above still happens, so other picks don't shift)
  const pinned = (dex.rules.abilityPreference.fixed || {})[s.name];
  const pin = pinned && opts.find(([, a]) => a.name === pinned);
  if (pin) ability = pin[1];

  return { role, category, moves, evs, nature, ability, nStatus: utility.length };
}

const BOOSTERS = { fire: "charcoal", water: "mystic-water", grass: "miracle-seed", electric: "magnet", ice: "never-melt-ice",
  fighting: "black-belt", poison: "poison-barb", ground: "soft-sand", flying: "sharp-beak", psychic: "twisted-spoon",
  bug: "silver-powder", rock: "hard-stone", ghost: "spell-tag", dragon: "dragon-fang", dark: "black-glasses",
  steel: "metal-coat", normal: "silk-scarf" };

function chooseItem(dex, s, st, used, rng) {
  const b = s.base, { role, category: cat, nStatus } = st;
  let c = [];
  if (s.evolvesTo.length) c.push("eviolite");
  const frail = b.hp + b.def + b.spd < 210;
  if (role === "sweeper") {
    if (nStatus === 0) { if (b.spe >= 70 && b.spe <= 105) c.push("choice-scarf"); c.push(cat === "physical" ? "choice-band" : "choice-specs"); }
    c.push("life-orb"); if (frail) c.push("focus-sash"); c.push("expert-belt", "lum-berry");
  } else if (role === "bulky") {
    if (nStatus === 0) c.push(cat === "physical" ? "choice-band" : "choice-specs");
    c.push("life-orb", "expert-belt", "sitrus-berry", "lum-berry");
  } else {
    c.push(s.types.includes("poison") ? "black-sludge" : "leftovers", "rocky-helmet", "sitrus-berry");
  }
  if (s.types.includes("poison")) c = c.map(x => (x === "leftovers" ? "black-sludge" : x));
  c.push(BOOSTERS[s.types[0]], "leftovers", "sitrus-berry", "lum-berry", "shell-bell", cat === "physical" ? "muscle-band" : "wise-glasses", "scope-lens", "quick-claw");
  if (!s.evolvesTo.length) { const head = rng.shuffle(c.slice(0, 3)); c = [...head, ...c.slice(3)]; }
  for (const x of c) if (!used.has(x) && dex.items[x]) { used.add(x); return x; }
  return "leftovers";
}

function statCalc(base, iv, ev, level, mult, isHp) {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  return isHp ? core + level + 10 : Math.floor((core + 5) * mult);
}

function finalize(dex, s, st, item, level, rng) {
  const nat = dex.natures[st.nature];
  const ivs = Object.fromEntries(STATS.map(k => [k, 31]));
  const stats = {};
  for (const k of STATS) {
    let mult = 1;
    if (nat.up && API_STAT[nat.up] === k) mult = 1.1;
    if (nat.down && API_STAT[nat.down] === k) mult = 0.9;
    stats[k] = statCalc(s.base[k], ivs[k], st.evs[k], level, mult, k === "hp");
  }
  const gr = s.genderRate;
  const gender = gr === -1 ? 2 : gr === 0 ? 0 : gr === 8 ? 1 : (rng() < gr / 8 ? 1 : 0);
  const a = st.ability;
  return {
    species: s.id, name: s.name, display: s.display, nickname: s.display.slice(0, 10), types: s.types,
    level, exp: dex.growth[s.growth][level - 1], role: st.role, category: st.category,
    nature: nat.index, natureName: nat.display,
    ability: dex.abilities[a.name].id, abilityName: dex.abilities[a.name].display,
    hiddenAbility: !!a.hidden, abilitySlot: a.slot === 2 ? 1 : 0,
    gender, genderRate: gr,
    item: dex.items[item].index, itemName: dex.items[item].display,
    moves: st.moves.map(m => m.id),
    moveInfo: st.moves.map(m => ({ name: m.display, type: m.type, power: dex.rules.movePolicy.fixedPower[m.name] ?? m.power, accuracy: m.accuracy, class: m.class })),
    pp: st.moves.map(m => m.pp + Math.floor((m.pp * 3) / 5)), ppUps: st.moves.map(() => 3),
    evs: st.evs, ivs, stats,
  };
}

/** Build a team from a 32-bit seed. Resolves {seed, team:[6 mons]}. */
export async function generateTeam(seed) {
  const dex = await loadDex();
  const R = dex.rules;
  const rng = rng32(seed);
  const all = eligible(dex);
  // legendaries/mythicals: a team gets exactly one with probability rules.legendaryChance, otherwise none
  const isLeg = s => s.legendary || s.mythical;
  const legs = all.filter(isLeg), pool = all.filter(s => !isLeg(s));
  const chance = R.legendaryChance ?? 1;
  const forced = legs.length && rng() < chance ? legs[Math.floor(rng() * legs.length)] : null;
  // first draft that passes the balance checks; if none does within 400 tries, the best-scoring one
  let best = null, bestScore = -Infinity;
  for (let maxPerType = R.maxPerType; !best && maxPerType <= 6; maxPerType++) {
    let fallback = null;
    for (let i = 0; i < 400 && !best; i++) {
      const team = draftOnce(dex, pool, rng, maxPerType, forced);
      if (!team) continue;
      if (acceptable(dex, team)) { best = team; break; }
      const sc = scoreDraft(dex, team);
      if (sc > bestScore) { fallback = team; bestScore = sc; }
    }
    best ||= fallback;
  }
  if (!best) throw new Error("rules.json is too strict: couldn't build a team");
  const full = await Promise.all(best.map(loadSpecies));
  const sets = full.map(s => buildSet(dex, s, rng));
  // one random member is a little higher level (aceLevel, like Cynthia's Garchomp); fastest leads, rest shuffled
  const high = Math.floor(rng() * full.length);
  const rest = full.map((_, i) => i).sort((x, y) => full[y].base.spe - full[x].base.spe || full[x].id - full[y].id);
  const lead = rest.shift();
  const finalOrder = [lead, ...rng.shuffle(rest)];
  const used = new Set();
  const team = finalOrder.map(i => finalize(dex, full[i], sets[i], chooseItem(dex, full[i], sets[i], used, rng),
    i === high ? R.aceLevel : R.level, rng));
  return { seed: seed >>> 0, team };
}
