# Garchomple

A daily Pokémon battle, Wordle-style. Every day everyone gets the same random, fully trained team of six
and one shot at Champion Cynthia in Caitlin's villa, Undella Town (Pokémon Black 2 / White 2, so anything up to Gen 5).

The game runs in the browser (EmulatorJS + melonDS). Players bring their own Pokémon White 2 (or Black 2) ROM,
picked once and remembered in their browser; the postgame save is built in (`data/base.sav`, trainer **Nate**).
Each battle copies that save, swaps in the day's team, empties the PC boxes and bag, sets the DS clock to spring
(the only season Cynthia accepts battles) and drops you one step south of her door.

## Play locally (macOS)

1. Keep `Pokemon_White2.nds` in this folder (or next to it, on the Desktop). A `Pokemon_White2.sav` there is used
   instead of the bundled save, if you want a different one.
2. In Terminal run `bash ~/Desktop/Cynthiale/start.command` (or `chmod +x start.command` once, then double-click it).
3. Your browser opens `http://localhost:8137`. Press **Battle Cynthia**.

`start.command` links the ROM into `local/` (nothing is copied) and copies a save, if present, into
`local/base.sav`, so your originals are never written to. Or skip that and pick the ROM in the page, as players do.

**Fast start.** The very first start boots the cartridge (intro, **Continue**, C-Gear questions) under a
loading screen, fast-forwarded and muted, and the moment Undella Town appears it snapshots the emulator
(a save state, ~7 MB, kept in the browser's IndexedDB). Every later start loads that snapshot and writes the
day's team over the party in the emulated RAM, so the game shows Undella Town a few seconds after the page
opens. The ROM is also trimmed of its 0xFF padding before loading (512 MB → 281 MB). From Undella the game
walks you into the villa and accepts Cynthia's challenge with the keyboard locked; it unlocks when the battle
starts. `start.command` doesn't create the snapshot; the page does. A copy can live in `local/undella.*` for
development. Add `?autopilot=0` to `play.html` to do everything by hand. Garchomple is keyboard-only: Z = A, X = B, A = X, S = Y,
Enter = Start, V = Select, Q/E = L/R, arrows = D-pad. (Never answer **Yes** to "Launch C-Gear
communications?" by hand; the emulator has no wireless and the game stops with a communication error.)

## How it works

| Piece | File |
| --- | --- |
| Pokémon data (Gen 5 accurate) via **pokebase** | `tools/build_data.py` → `data/dex/` |
| Team rules (bans, BST window, type limits, move/ability policy) | `data/dex/rules.json` |
| Team generator (runs in the browser) | `app/js/teamgen.js` |
| Save editor (PK5 encryption, party, warp, flags, CRCs) | `app/js/gen5save.js` |
| Automatic win/loss detection | `app/js/monitor.js` |
| Autopilot (boot → Continue → C-Gear → walk in → challenge Cynthia; keyboard locked) | `app/js/autopilot.js`, `app/js/autopilot_refs.js` |
| Undella snapshot (save state cache, party swap in RAM) and trimmed ROM loading | `app/js/snapshot.js`, `app/js/files.js` |
| Spring clock for the emulated DS | `app/js/clock.js` |
| Pages | `index.html`, `play.html`, `app/js/*.js` |

**The dex** (`data/dex/`) is plain, readable JSON: `species/NNNN-name.json` holds one Pokémon (types, stats,
abilities, evolution links, B2W2 learnset), `species/index.json` has one summary line per Pokémon, and
`moves/abilities/items/natures/typechart/growth.json` have one entry per line. To add or tweak a Pokémon, edit
or add its species file and its line in `index.json`; sprites fall back to PokeAPI's copy if there's no local one.

**Teams** are sampled live, never pre-built. Daily seeds the generator with the date (everyone gets the same six);
Unlimited uses a random seed and **New team** rolls another. Rules (from `rules.json`): no base forms; middle
stages only if strong (BST ≥ 440, holding an Eviolite); fully evolved / single-stage within 440–600 BST; no
legendaries; no two team members share a type (relaxed only if impossible); banned species (Shedinja, Slaking,
Regigigas, Archeops, Ditto, Smeargle, …) and abilities (Wonder Guard, Truant, Defeatist, Slow Start, Moody, Shadow
Tag, Arena Trap, …). Each Pokémon gets a role-based nature, 252/252/4 EVs, 31 IVs, STAB + coverage moves from
its B2W2 learnset, and a unique item. Five are Lv 76 and the ace is Lv 78, like Cynthia's team.

**No wandering.** The player never controls the overworld: the autopilot boots the game, walks into the
villa, talks to Cynthia and accepts her challenge with the keyboard locked. Keys unlock only once the battle
screen is up, and lock again (with the game paused) the moment the result is detected.

**Result detection.** Once the battle starts, the page finds the game's RAM inside the emulator by
searching for bytes planted in today's save, then watches Cynthia's "battled today" flag (win) and your
party's HP (all zero = loss). On a win it records how many Pokémon were still standing and the % HP left, pauses
the game and shows the result. If memory can't be read, a "Log it by hand" panel appears instead.

**Where Cynthia is.** Undella Town is zone 412, Caitlin's villa zone 416 (warp #4, door tile 745,297). Her NPC
vanish flag is 683; she battles only in spring, once per day (flag 2745 / var 0x400F), after the Hall of Fame
(flag 2400). The clock is pinned to noon, 15 May 2090: always spring, later than any save, and the same day every run (so the snapshot stays valid). Her team is trainer #456.

## Changing Cynthia's team

Edit **`cynthia-team.txt`** (Showdown-style text; the notes at its top explain the format) and reload the page.
You can set each Pokémon's species, level, gender, held item, ability (regular abilities only), up to 4 moves and
IVs, plus up to 4 items in her bag. The battle page writes this into the game's own trainer data for Cynthia
(trainer #456, files `a/0/9/1` and `a/0/9/2`) in an in-memory copy of the ROM (`app/js/cynthiateam.js`), and
the home page preview reads the same file. Black 2/White 2 trainer data has no natures or EVs, so those can't be
set. If a line is wrong, the battle page refuses to start and says which line and why.
(`data/cynthia.json` is no longer used.)

## Regenerating data

```bash
pip install -r tools/requirements.txt
python3 tools/build_data.py        # pokeapi.co via pokebase → data/dex/ (rules.json is never overwritten)
```

If pokeapi.co is unreachable, clone `github.com/PokeAPI/api-data`, run `python3 tools/pokeapi_mirror.py api-data/data 8642`
and set `POKEAPI_BASE=http://127.0.0.1:8642/api/v2`.

Developer switches (localhost only): `play.html?debug=strong|weak` (test team, results not saved),
`?autopilot=0`.

## Deploying online

Everything is static. Push the folder to GitHub and turn on GitHub Pages (or use Netlify or similar). `.gitignore`
keeps `local/`, `_transfer/` and every `.nds` / `.sav` out of the repo, except the bundled `data/base.sav`.
Players pick their own ROM once in the page; it stays in their browser and is never uploaded, and the ROM is never
hosted. `vendor/emulatorjs` can be committed, or deleted, in which case the page loads EmulatorJS
4.2.3 from `cdn.emulatorjs.org`.

**After changing any code or CSS, run `python3 tools/bump.py` before pushing.** Every script and the stylesheet
are loaded with a version number (`?v=N`, via an import map in `index.html` and `play.html`), and the bump raises
it everywhere at once. GitHub Pages lets browsers cache files for ~10 minutes, so without a bump returning players
can mix old cached scripts with new ones and the page won't load. (`cynthia-team.txt` edits don't need a bump.)

## Known limits

- Results are on the honour system: you log won/lost and how many Pokémon were left.
- The autopilot recognises screens by comparing small grayscale fingerprints with ones recorded from US White 2.
  Other regions/languages have different text on the menus, so it may not recognise them; it then stops safely
  and the status panel says to continue by hand.
- Touch input isn't supported; everything is played with the keyboard.
- Tested with US White 2 (IRDO). Black 2 US and other regions are accepted, but they're untested.
- In-game saving works but is thrown away; each launch rebuilds today's save from the bundled one.
