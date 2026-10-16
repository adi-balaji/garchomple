"""Write Garchomple's Gen 5 dex as small, readable, hand-editable JSON files.

data/dex/
  index.json        one line per species: the summary the team generator filters on
  species/NNNN-name.json   full entry incl. B2W2 learnset (one file per Pokémon, easy to add/edit)
  moves.json        one line per move (Gen 5 values)
  abilities.json    one line per ability
  items.json        held items with Gen 5 item indices
  natures.json      in-game nature order
  typechart.json    Gen 5 type chart (attacker -> defender -> multiplier)
  growth.json       experience tables (level 1..100)
  rules.json        team-building rules: bans, BST window, levels (edit freely)

To add a Pokémon by hand: drop a file in species/ following the existing shape and add its
summary line to index.json (or re-run tools/build_data.py).
"""
import json
import os
import re


def _compact(obj, indent=2):
    """Pretty JSON, but short lists of scalars stay on one line."""
    text = json.dumps(obj, indent=indent, ensure_ascii=False)
    def squash(m):
        inner = re.sub(r"\s+", " ", m.group(0))
        inner = inner.replace("[ ", "[").replace(" ]", "]")
        return inner
    text = re.sub(r"\[[^\[\]{}]*\]", squash, text)
    # small flat objects ({"hp": 108, ...}, ability entries) on one line too
    def squash_obj(m):
        one = re.sub(r"\s+", " ", m.group(0)).replace("{ ", "{").replace(" }", "}")
        return one if len(one) <= 110 else m.group(0)
    return re.sub(r"\{[^{}\[\]]*\}", squash_obj, text)


def _lines(mapping):
    """JSON object with one entry per line."""
    keys = list(mapping)
    out = ["{"]
    for i, k in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        out.append(f"  {json.dumps(str(k))}: {json.dumps(mapping[k], ensure_ascii=False, separators=(', ', ': '))}{comma}")
    out.append("}")
    return "\n".join(out) + "\n"


def _list_lines(items):
    out = ["["]
    for i, it in enumerate(items):
        comma = "," if i < len(items) - 1 else ""
        out.append(f"  {json.dumps(it, ensure_ascii=False, separators=(', ', ': '))}{comma}")
    out.append("]")
    return "\n".join(out) + "\n"


DEFAULT_RULES = {
    "_doc": "Team-building rules used by app/js/teamgen.js. Edit freely; species/abilities use PokeAPI names.",
    "level": 76,
    "aceLevel": 78,
    "teamSize": 6,
    "bstMin": 440,
    "bstMax": 600,
    "middleStageMinBst": 440,
    "_middleStage": "Pokémon that still evolve are only allowed if they already evolved once (no base forms) and have at least this BST; they get an Eviolite.",
    "excludeLegendary": True,
    "excludeMythical": True,
    "maxPerType": 1,
    "_maxPerType": "How many team members may share a type. The generator relaxes this only if it can't fill the team.",
    "maxPseudoLegendaries": 1,
    "pseudoLegendaries": ["dragonite", "tyranitar", "salamence", "metagross", "garchomp", "hydreigon"],
    "bannedSpecies": ["shedinja", "slaking", "regigigas", "archeops", "ditto", "smeargle", "unown",
                      "wobbuffet", "wynaut", "castform", "darmanitan", "kecleon", "luvdisc", "delibird", "spinda"],
    "bannedAbilities": ["wonder-guard", "truant", "defeatist", "slow-start", "moody", "shadow-tag", "arena-trap",
                        "zen-mode", "multitype", "imposter", "illusion", "forecast"],
}


def write_dex(data, root):
    d = os.path.join(root, "dex")
    sp_dir = os.path.join(d, "species")
    os.makedirs(sp_dir, exist_ok=True)
    species = data["species"]
    evolves_to = {}
    for s in species:
        if s.get("evolvesFrom"):
            evolves_to.setdefault(s["evolvesFrom"], []).append(s["name"])
    index = []
    for s in species:
        fname = f"{s['id']:04d}-{s['name']}.json"
        learn = {}
        for mid, methods in s["learnset"].items():
            for m in methods:
                learn.setdefault(m, []).append(int(mid))
        entry = {
            "id": s["id"], "name": s["name"], "display": s["display"], "types": s["types"],
            "base": dict(zip(["hp", "atk", "def", "spa", "spd", "spe"], s["base"])),
            "abilities": s["abilities"], "growth": s["growth"], "genderRate": s["genderRate"],
            "legendary": s["legendary"], "mythical": s["mythical"],
            "evolvesFrom": s.get("evolvesFrom"), "evolvesTo": evolves_to.get(s["name"], []),
            "learnset": {k: sorted(v) for k, v in sorted(learn.items())},
        }
        with open(os.path.join(sp_dir, fname), "w") as f:
            f.write(_compact(entry) + "\n")
        index.append({k: entry[k] for k in ("id", "name", "display", "types", "base", "abilities",
                                             "legendary", "mythical", "evolvesFrom", "evolvesTo")} | {"file": fname})
    with open(os.path.join(sp_dir, "index.json"), "w") as f:
        f.write(_list_lines(index))
    with open(os.path.join(d, "moves.json"), "w") as f:
        f.write(_lines(data["moves"]))
    with open(os.path.join(d, "abilities.json"), "w") as f:
        f.write(_lines(data["abilities"]))
    with open(os.path.join(d, "items.json"), "w") as f:
        f.write(_lines(data["items"]))
    with open(os.path.join(d, "natures.json"), "w") as f:
        f.write(_lines(data["natures"]))
    with open(os.path.join(d, "typechart.json"), "w") as f:
        f.write(_lines(data["typeChart"]))
    with open(os.path.join(d, "growth.json"), "w") as f:
        f.write(_lines(data["growth"]))
    rules = os.path.join(d, "rules.json")
    if not os.path.exists(rules):  # never overwrite hand edits
        with open(rules, "w") as f:
            f.write(_compact(DEFAULT_RULES) + "\n")
    return len(species)


if __name__ == "__main__":
    # convert an old single-file dump: python3 tools/dex_layout.py data/pokedex_gen5.json
    import sys
    here = os.path.dirname(os.path.abspath(__file__))
    with open(sys.argv[1]) as f:
        n = write_dex(json.load(f), os.path.join(here, "..", "data"))
    print(f"wrote data/dex with {n} species")
