#!/usr/bin/env python3
"""Build Garchomple's Gen-5-accurate Pokémon dataset with pokebase (PokeAPI).

Output: data/dex/ (one readable file per species + moves/items/abilities/... tables; see dex_layout.py).
The browser builds teams from it at play time (app/js/teamgen.js).

Everything is normalised to how it was in Pokémon Black 2 / White 2:
  * species limited to #1-649
  * types / abilities / base stats rolled back with PokeAPI's past_* fields
    (no Fairy type, Gengar has Levitate, Butterfree has 80 SpA, ...)
  * move power / accuracy / PP / type rolled back with past_values
  * learnsets taken from the "black-2-white-2" version group
  * item IDs are Generation V internal indices (game_indices)

Usage
  pip install pokebase
  python3 tools/build_data.py                       # talks to https://pokeapi.co
  POKEAPI_BASE=http://127.0.0.1:8642/api/v2 python3 tools/build_data.py   # local mirror
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import pokebase
import pokebase.cache
import pokebase.common
from pokebase import api

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if os.environ.get("POKEAPI_BASE"):
    pokebase.common.BASE_URL = os.environ["POKEAPI_BASE"].rstrip("/")
pokebase.cache.set_cache(os.environ.get("POKEBASE_CACHE", os.path.join(HERE, ".pokebase_cache")))

MAX_SPECIES = 649
MAX_MOVE = 559
MAX_ABILITY = 164
VG = "black-2-white-2"
VG_ORDER = {  # version-group chronology, used to roll move data back to Gen 5
    "red-blue": 1, "yellow": 2, "gold-silver": 3, "crystal": 4, "ruby-sapphire": 5, "emerald": 6,
    "firered-leafgreen": 7, "diamond-pearl": 8, "platinum": 9, "heartgold-soulsilver": 10,
    "black-white": 11, "colosseum": 12, "xd": 13, "black-2-white-2": 14, "x-y": 15,
    "omega-ruby-alpha-sapphire": 16, "sun-moon": 17, "ultra-sun-ultra-moon": 18,
}
GEN_NUM = {"generation-i": 1, "generation-ii": 2, "generation-iii": 3, "generation-iv": 4,
           "generation-v": 5, "generation-vi": 6, "generation-vii": 7, "generation-viii": 8,
           "generation-ix": 9}
STAT_KEYS = ["hp", "attack", "defense", "special-attack", "special-defense", "speed"]
GEN5_TYPES = ["normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel",
              "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark"]

# Held items the generator may hand out (PokeAPI names).
HELD_ITEMS = [
    "leftovers", "life-orb", "choice-scarf", "choice-band", "choice-specs", "focus-sash",
    "sitrus-berry", "lum-berry", "expert-belt", "black-sludge", "eviolite", "rocky-helmet",
    "air-balloon", "muscle-band", "wise-glasses", "scope-lens", "shell-bell", "quick-claw",
    "chesto-berry", "light-clay", "bright-powder", "salac-berry", "liechi-berry", "petaya-berry",
    "charcoal", "mystic-water", "miracle-seed", "magnet", "never-melt-ice", "black-belt",
    "poison-barb", "soft-sand", "sharp-beak", "twisted-spoon", "silver-powder", "hard-stone",
    "spell-tag", "dragon-fang", "black-glasses", "metal-coat", "silk-scarf", "toxic-orb", "flame-orb",
    "white-herb", "mental-herb", "power-herb", "zoom-lens", "wide-lens", "razor-claw",
]


def name_en(obj, fallback):
    for n in obj.get("names", []):
        if n["language"]["name"] == "en":
            return n["name"]
    return fallback


def gen_of(entry):
    return GEN_NUM[entry["generation"]["name"]]


def pick_past(past_list, gen=5):
    """PokeAPI past_* entries record the values that held *up to and including* that generation.
    The earliest entry whose generation is >= gen therefore describes generation `gen`."""
    cands = [p for p in past_list if gen_of(p) >= gen]
    return min(cands, key=gen_of) if cands else None


_ability_ids = {}


def url_id(url):
    return int(url.rstrip("/").split("/")[-1])


def resolve_names(endpoint, names):
    """pokebase.api.get_data wants numeric ids; map names through the endpoint's index."""
    listing = api.get_data(endpoint)
    by_name = {r["name"]: url_id(r["url"]) for r in listing["results"]}
    return [by_name[n] for n in names if n in by_name]


def fetch(endpoint, ident):
    return api.get_data(endpoint, ident)


def parallel(fn, items, workers=16):
    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(fn, items))


def build_species():
    ids = list(range(1, MAX_SPECIES + 1))
    print("fetching species ...", file=sys.stderr)
    species = parallel(lambda i: fetch("pokemon-species", i), ids)
    print("fetching pokemon ...", file=sys.stderr)
    pokemon = parallel(lambda i: fetch("pokemon", i), ids)

    evolves_from = {}
    for s in species:  # only evolutions that exist by Gen 5 count (e.g. Sylveon does not)
        if s["evolves_from_species"]:
            parent = s["evolves_from_species"]["name"]
            evolves_from.setdefault(parent, []).append(s["name"])

    out, all_moves, all_abilities = [], set(), set()
    for s, p in zip(species, pokemon):
        # types
        types = [t["type"]["name"] for t in sorted(p["types"], key=lambda t: t["slot"])]
        past = pick_past(p.get("past_types", []))
        if past:
            types = [t["type"]["name"] for t in sorted(past["types"], key=lambda t: t["slot"])]
        # stats
        stats = {st["stat"]["name"]: st["base_stat"] for st in p["stats"]}
        for ps in sorted([x for x in p.get("past_stats", []) if gen_of(x) >= 5], key=gen_of, reverse=True):
            for st in ps["stats"]:
                stats[st["stat"]["name"]] = st["base_stat"]
        # abilities (slot 1/2 regular, 3 hidden)
        abil = {a["slot"]: (a["ability"]["name"] if a["ability"] else None, a["is_hidden"]) for a in p["abilities"]}
        pa = pick_past(p.get("past_abilities", []))
        if pa:
            for a in pa["abilities"]:
                abil[a["slot"]] = (a["ability"]["name"] if a["ability"] else None, a["is_hidden"])
        for a in p["abilities"] + [x for e in p.get("past_abilities", []) for x in e["abilities"]]:
            if a["ability"]:
                _ability_ids[a["ability"]["name"]] = url_id(a["ability"]["url"])
        # learnset for B2W2
        learn = {}
        for m in p["moves"]:
            mid = int(m["move"]["url"].rstrip("/").split("/")[-1])
            if mid > MAX_MOVE:
                continue
            methods = [d["move_learn_method"]["name"] for d in m["version_group_details"]
                       if d["version_group"]["name"] == VG]
            if methods:
                learn[mid] = sorted(set(methods))
                all_moves.add(mid)
        rec = {
            "id": s["id"],
            "name": s["name"],
            "display": name_en(s, s["name"].title()),
            "types": types,
            "base": [stats[k] for k in STAT_KEYS],
            "abilities": [],
            "growth": s["growth_rate"]["name"],
            "genderRate": s["gender_rate"],
            "legendary": s["is_legendary"],
            "mythical": s["is_mythical"],
            "baby": s["is_baby"],
            "fullyEvolved": s["name"] not in evolves_from,
            "evolvesFrom": s["evolves_from_species"]["name"] if s["evolves_from_species"] else None,
            "learnset": {str(k): v for k, v in sorted(learn.items())},
        }
        for slot in sorted(abil):
            nm, hidden = abil[slot]
            if nm:
                rec["abilities"].append({"name": nm, "hidden": hidden, "slot": slot})
                all_abilities.add(nm)
        out.append(rec)
    return out, all_moves, all_abilities


def build_moves(move_ids):
    print(f"fetching {len(move_ids)} moves ...", file=sys.stderr)
    raw = parallel(lambda i: fetch("move", i), sorted(move_ids))
    out = {}
    for m in raw:
        rec = {
            "id": m["id"], "name": m["name"], "display": name_en(m, m["name"]),
            "type": m["type"]["name"], "power": m["power"], "accuracy": m["accuracy"], "pp": m["pp"],
            "class": m["damage_class"]["name"], "priority": m["priority"],
            "target": m["target"]["name"],
        }
        # roll back to B2W2: the earliest past_values entry from a later version group
        later = [pv for pv in m.get("past_values", []) if VG_ORDER.get(pv["version_group"]["name"], 99) > VG_ORDER[VG]]
        for pv in sorted(later, key=lambda pv: VG_ORDER.get(pv["version_group"]["name"], 99), reverse=True):
            for k in ("power", "accuracy", "pp"):
                if pv.get(k) is not None:
                    rec[k] = pv[k]
            if pv.get("type"):
                rec["type"] = pv["type"]["name"]
        meta = m.get("meta") or {}
        rec["meta"] = {
            "category": (meta.get("category") or {}).get("name"),
            "drain": meta.get("drain", 0), "healing": meta.get("healing", 0),
            "minHits": meta.get("min_hits"), "maxHits": meta.get("max_hits"),
            "ailment": (meta.get("ailment") or {}).get("name"), "ailmentChance": meta.get("ailment_chance", 0),
            "flinch": meta.get("flinch_chance", 0), "crit": meta.get("crit_rate", 0),
        }
        rec["statChanges"] = [{"stat": sc["stat"]["name"], "change": sc["change"]} for sc in m.get("stat_changes", [])]
        out[str(m["id"])] = rec
    return out


def build_abilities(names):
    print(f"fetching {len(names)} abilities ...", file=sys.stderr)
    raw = parallel(lambda i: fetch("ability", i), sorted({_ability_ids[n] for n in names}))
    return {a["name"]: {"id": a["id"], "display": name_en(a, a["name"])} for a in raw if a["id"] <= MAX_ABILITY}


def build_items():
    print("fetching items ...", file=sys.stderr)
    raw = parallel(lambda i: fetch("item", i), resolve_names("item", HELD_ITEMS))
    out = {}
    for it in raw:
        idx = [g["game_index"] for g in it["game_indices"] if g["generation"]["name"] == "generation-v"]
        if idx:
            out[it["name"]] = {"index": idx[0], "display": name_en(it, it["name"])}
    return out


NATURE_ORDER = ["hardy", "lonely", "brave", "adamant", "naughty", "bold", "docile", "relaxed", "impish",
                "lax", "timid", "hasty", "serious", "jolly", "naive", "modest", "mild", "quiet", "bashful",
                "rash", "calm", "gentle", "sassy", "careful", "quirky"]  # in-game index order


def build_natures():
    out = {}
    for n in parallel(lambda i: fetch("nature", i), range(1, 26)):
        out[n["name"]] = {
            "index": NATURE_ORDER.index(n["name"]), "display": name_en(n, n["name"].title()),
            "up": n["increased_stat"]["name"] if n["increased_stat"] else None,
            "down": n["decreased_stat"]["name"] if n["decreased_stat"] else None,
        }
    return out


def build_type_chart():
    chart = {a: {d: 1.0 for d in GEN5_TYPES} for a in GEN5_TYPES}
    for t in parallel(lambda i: fetch("type", i), resolve_names("type", GEN5_TYPES)):
        rel = t["damage_relations"]
        past = pick_past(t.get("past_damage_relations", []))
        if past:
            rel = past["damage_relations"]
        for key, mult in (("double_damage_to", 2.0), ("half_damage_to", 0.5), ("no_damage_to", 0.0)):
            for d in rel[key]:
                if d["name"] in chart[t["name"]]:
                    chart[t["name"]][d["name"]] = mult
    return chart


def build_growth():
    out = {}
    for g in parallel(lambda i: fetch("growth-rate", i), range(1, 7)):
        table = {lv["level"]: lv["experience"] for lv in g["levels"]}
        out[g["name"]] = [table[i] for i in range(1, 101)]
    return out


def main():
    species, move_ids, ability_names = build_species()
    data = {
        "source": "PokeAPI via pokebase",
        "versionGroup": VG,
        "statKeys": STAT_KEYS,
        "species": species,
        "moves": build_moves(move_ids),
        "abilities": build_abilities(ability_names),
        "items": build_items(),
        "natures": build_natures(),
        "typeChart": build_type_chart(),
        "growth": build_growth(),
    }
    from dex_layout import write_dex
    n = write_dex(data, os.path.join(HERE, "..", "data"))
    print(f"wrote data/dex: {n} species, {len(data['moves'])} moves", file=sys.stderr)


if __name__ == "__main__":
    main()
