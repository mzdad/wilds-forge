# Wilds Build Forge

A page for Monster Hunter Wilds. Pick the skills you want (for example Heroics 5)
and it finds armor sets, a charm and jewels that reach them. A second tab lists
popular builds per weapon; "Use these skills" sends one to the finder.

Each set shows its damage numbers (affinity, crit damage, attack, a raw damage
estimate) for the fight situations you switch on, such as "Monster is enraged".
It also picks smart jewels for the free slots: the ones that add the most damage
in those situations.

You can add your own charms (appraised ones with their own skills, armor slots and
weapon slots). Tick "Build around this charm" and every set uses it; otherwise it
competes with the crafted charms. Charms are saved in your browser only.

## Files

| File | What it is |
|---|---|
| `index.html` | The page and its look |
| `app.js` | Everything you click on |
| `solver.js` | The set finder (no page code, so it can be tested on its own) |
| `stats.js` | Damage numbers and smart jewel picks |
| `effects.js` | What each skill adds (attack, affinity, crit damage) and when. Edit this to add a skill to the numbers |
| `builds.js` | The popular builds list. Edit this to add or change builds |
| `data.js` | All game data. Generated, do not edit by hand |
| `tools/update-data.js` | Downloads fresh game data into `data.js` |
| `tools/test-solver.js` | Checks the set finder |
| `tools/test-stats.js` | Checks the damage numbers against the in-game skill text, and the smart jewels |

## Commands

Run these from this folder.

```bash
node tools/update-data.js
```

Gets the newest game data from [mhdb](https://docs.wilds.mhdb.io) (after a game update).

```bash
node tools/test-solver.js
```

Checks that every found set really has the skills it claims. Prints PASS/FAIL.

```bash
node tools/test-stats.js
```

Checks every number in `effects.js` against the game's own skill text (run it after
`update-data.js`), and that smart jewels fit and add damage.

To look at the page on this PC, open `index.html` in a browser.

## Known limits

- Weapon skills are filled with weapon jewels only. Skills already built into a weapon are not counted.
- Random charms (appraised "Unknown Charm" etc.) differ per player, so they are only used when you add your own.
- A Gogma Artian weapon is assumed to add one piece to any one set bonus and one group skill.
- Raw damage is an estimate for a 200-attack weapon. Element damage is not included, and neither
  are skills whose in-game text gives no number (Burst, Lord's Soul and others). The page names them.
- Smart jewels are picked one at a time. A test against trying every weapon combination gave the same result.
