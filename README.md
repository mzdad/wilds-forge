# Wilds Build Forge

A page for Monster Hunter Wilds. Pick the skills you want (for example Heroics 5)
and it finds armor sets, a charm and jewels that reach them. A second tab has
ready-made builds per weapon; "Use this build" sends one to the finder.

The page is built to be easy: step 1 is the skills you want, step 2 is your build.
Builds show one at a time (‹ › to flip) as two to-do lists, "Wear these" and
"Put in these jewels", with boxes to tick off while you set it up in the game.
Your weapon and charm sit in a closed "My gear" section.

"☆ Save this build" stores a snapshot of the build in the browser (localStorage, like
cookies: this device only). The "My builds" tab lists them: rename, show, open the
skills in the builder again, or delete. A saved build always looks as it did when saved.

"Share" (on a build and on each saved build) gives a link, a plain-text version for
Discord, and on phones the phone's own share menu. The whole build is packed inside
the link after `#share=` (`share.js`), so nothing is uploaded. Opening such a link
shows the build with "Save to My builds" and "Open in builder". Everything read from
a link is checked by `cleanView()` and shown as plain text only.

Each set shows its damage numbers (affinity, crit damage, attack, a raw damage
estimate) for the fight situations you switch on, such as "Monster is enraged".
It also picks smart jewels for the free slots: the ones that add the most damage
in those situations.

You can add your own charms (appraised ones with their own skills, armor slots and
weapon slots). Tick "Build around this charm" and every set uses it; otherwise it
competes with the crafted charms. Charms are saved in your browser only.

Tick "I have a Gogma Artian weapon" and a box appears to fill in your weapon: type,
element, attack, affinity, its set bonus and group skill, and its slots. The set bonus
and group skill count as one piece each; left on "Any" the forge picks whichever helps.
Attack and affinity feed the damage numbers.

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
| `share.js` | Packs a build into a share link and checks what comes out of one |
| `tools/test-share.js` | Checks share links: round trip, broken links, tampered content |

## Commands

Run these from this folder.

```bash
node tools/update-data.js
```

Gets the newest game data from [mhdb](https://docs.wilds.mhdb.io) (after a game update).
It also checks for armor that can only be worn as a whole set, like Akuma α, and tells you
if a new one shows up (add its name to `wholeSetOnly` in `effects.js`). Add `--check` to
only look, without changing `data.js`.

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
- Raw damage is an estimate for your Gogma weapon's attack, or a 200-attack weapon when unknown. Element damage is not included, and neither
  are skills whose in-game text gives no number (Burst, Lord's Soul and others). The page names them.
- Smart jewels are picked one at a time. A test against trying every weapon combination gave the same result.
