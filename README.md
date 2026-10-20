# Wilds Build Forge

A page for Monster Hunter Wilds. Pick the skills you want (for example Heroics 5)
and it finds armor sets, a charm and jewels that reach them. A second tab lists
popular builds per weapon; "Use these skills" sends one to the finder.

## Files

| File | What it is |
|---|---|
| `index.html` | The page and its look |
| `app.js` | Everything you click on |
| `solver.js` | The set finder (no page code, so it can be tested on its own) |
| `builds.js` | The popular builds list. Edit this to add or change builds |
| `data.js` | All game data. Generated, do not edit by hand |
| `tools/update-data.js` | Downloads fresh game data into `data.js` |
| `tools/test-solver.js` | Checks the set finder |

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

To look at the page on this PC, open `index.html` in a browser.

## Known limits

- Weapon skills are filled with weapon jewels only. Skills already built into a weapon are not counted.
- Random charms (appraised "Unknown Charm" etc.) are not used, because their skills differ per player.
- A Gogma Artian weapon is assumed to add one piece to any one set bonus and one group skill.
