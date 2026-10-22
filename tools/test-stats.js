// Checks the damage numbers and the smart jewel picks without opening the page.
//   node tools/test-stats.js
// Prints PASS/FAIL per check and exits with an error code if anything fails.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Solver = require("../solver.js");
const Stats = require("../stats.js");

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of ["data.js", "effects.js"]) {
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox);
}
const data = sandbox.window.WILDS_DATA;
const effects = sandbox.window.WILDS_EFFECTS;
const index = Solver.makeIndex(data);

let failures = 0;
function check(name, ok, detail) {
	console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : ""));
	if (!ok) {
		failures += 1;
	}
}

function skill(name) {
	return data.skills.find((s) => s.name === name);
}

function levelsOf(pairs) {
	return new Map(pairs.map(([name, level]) => [skill(name).id, level]));
}

// --- effects.js must match the game data ---
const situationIds = new Set(effects.situations.map((s) => s.id));
const unknownNames = Object.keys(effects.skills).concat(effects.notCounted).filter((name) => !skill(name));
check("every skill name in effects.js exists in the game data", unknownNames.length === 0, unknownNames.join(", "));

const unknownSituations = [];
const wrongNumbers = [];
for (const [name, parts] of Object.entries(effects.skills)) {
	const s = skill(name);
	for (const part of parts) {
		if (part.when !== "always" && !situationIds.has(part.when)) {
			unknownSituations.push(name + ": " + part.when);
		}
		for (const field of ["attack", "attackPct", "affinity", "critDamage"]) {
			(part[field] || []).forEach((value, i) => {
				if (!s || value === 0) {
					return;
				}
				const rank = s.ranks[i];
				// The number must appear on its own in that level's text ("+20", "to 40%").
				const pattern = new RegExp("(^|[^\\d])" + value + "([^\\d]|$)");
				if (!rank || !pattern.test(rank.desc)) {
					wrongNumbers.push(name + " level " + (i + 1) + " " + field + " " + value + " vs \"" + (rank ? rank.desc : "no such level") + "\"");
				}
			});
		}
	}
}
check("every situation used is in the situations list", unknownSituations.length === 0, unknownSituations.join(", "));
check("every number in effects.js matches the in-game skill text", wrongNumbers.length === 0, wrongNumbers.join(" | "));
for (const id of effects.defaultSituations.concat(effects.alwaysShown)) {
	check("listed situation '" + id + "' exists", situationIds.has(id));
}
const badExcludes = effects.situations.flatMap((s) => (s.excludes || []).filter((id) => !situationIds.has(id)).map((id) => s.id + " -> " + id));
check("every 'excludes' names a real situation", badExcludes.length === 0, badExcludes.join(", "));

// --- The updater's whole-set check (finds sets with an Akuma-style recipe) ---
{
	const { findWholeSetCandidates } = require("./update-data.js");
	const mats = [{ item: { name: "Scale" }, quantity: 1 }];
	const piece = (set, withMaterials) => ({ armorSet: { name: set }, crafting: { materials: withMaterials ? mats : [] } });
	const fake = [
		// One recipe for the whole set: only the first piece lists materials.
		piece("New Collab α", true), piece("New Collab α", false), piece("New Collab α", false), piece("New Collab α", false), piece("New Collab α", false),
		// A normal set: every piece has its own recipe.
		piece("Normal α", true), piece("Normal α", true), piece("Normal α", true), piece("Normal α", true), piece("Normal α", true),
		// A free starter set: no piece lists materials.
		piece("Starter", false), piece("Starter", false), piece("Starter", false),
		// A single accessory.
		piece("Glasses α", true),
	];
	const found = findWholeSetCandidates(fake);
	check("the updater flags a set with one recipe for all pieces", found.includes("New Collab α"), found.join(", "));
	check("...and leaves normal sets, free starter sets and single accessories alone", found.length === 1, found.join(", "));
}

// --- Adding up ---
{
	const levels = levelsOf([["Critical Eye", 5], ["Weakness Exploit", 5], ["Agitator", 5], ["Critical Boost", 5]]);
	const both = Stats.computeStats(index, effects, levels, new Set(["weak", "enraged"]), 0);
	check("Crit Eye 5 + WEX 5 + Agitator 5 on a weak point while enraged = 65% affinity", both.affinity === 65, both.affinity + "%");
	check("...and attack +20", both.attack === 20, String(both.attack));
	check("...and crits hit 40% harder", both.critDamage === 40, both.critDamage + "%");
	const calm = Stats.computeStats(index, effects, levels, new Set(["weak"]), 0);
	check("same set, monster calm = 50% affinity", calm.affinity === 50, calm.affinity + "%");
	const withWeapon = Stats.computeStats(index, effects, levels, new Set(["weak", "enraged"]), 10);
	check("weapon affinity is added on top", withWeapon.affinity === 75, withWeapon.affinity + "%");
	check("damage goes up when Agitator switches on", both.damageGain > calm.damageGain,
		(calm.damageGain * 100).toFixed(1) + "% -> " + (both.damageGain * 100).toFixed(1) + "%");
}
{
	const levels = levelsOf([["Heroics", 5], ["Burst", 3]]);
	const low = Stats.computeStats(index, effects, levels, new Set(["lowHealth"]), 0);
	check("Heroics 5 at low health = attack +30%", low.attackPct === 30, low.attackPct + "%");
	check("Burst is listed as not in the numbers", low.uncounted.some((s) => s.name === "Burst"));
	const healthy = Stats.computeStats(index, effects, levels, new Set(), 0);
	check("Heroics does nothing at full health", healthy.attackPct === 0 && healthy.damageGain === 0);
}
{
	const levels = levelsOf([["Attack Boost", 5]]);
	const typical = Stats.computeStats(index, effects, levels, new Set(), 0);
	check("without a weapon attack, a 200-attack weapon is assumed: 200 x 1.04 + 9 = 217", typical.totalAttack === 217, String(typical.totalAttack));
	const own = Stats.computeStats(index, effects, levels, new Set(), 0, 250);
	check("with your weapon's attack 250: 250 x 1.04 + 9 = 269", own.totalAttack === 269 && own.weaponAttackKnown, String(own.totalAttack));
	const flat = levelsOf([["Agitator", 5]]);
	const low = Stats.computeStats(index, effects, flat, new Set(["enraged"]), 0, 150).damageGain;
	const high = Stats.computeStats(index, effects, flat, new Set(["enraged"]), 0, 300).damageGain;
	check("flat attack (+20) matters more on a weaker weapon", low > high, (low * 100).toFixed(1) + "% vs " + (high * 100).toFixed(1) + "%");
}
{
	const levels = levelsOf([["Critical Eye", 5], ["Latent Power", 5], ["Maximum Might", 3]]);
	const capped = Stats.computeStats(index, effects, levels, new Set(["latent", "fullStamina"]), 20);
	check("affinity shown is capped at 100%", capped.affinityShown === 100, capped.affinity + "% raw");
}

// --- Smart jewels ---
{
	const heroics = skill("Heroics");
	const answer = Solver.findSets(index, { targets: [{ skillId: heroics.id, level: 5 }], weaponSlots: [3, 3, 3], gogmaWeapon: false });
	const result = answer.results[0];
	const levels = new Map(Solver.totalSkills(index, result, answer.weapon).map((e) => [e.skill.id, e.level]));
	const situations = new Set(["weak", "enraged", "lowHealth"]);
	const before = Stats.computeStats(index, effects, levels, situations, 0);
	const smart = Stats.suggestJewels(index, effects, levels, result.freeSlots, [3, 3, 3], situations, 0);

	const armorSizes = smart.picks.filter((p) => p.deco.kind === "armor").flatMap((p) => new Array(p.count).fill(p.deco.slot));
	const weaponSizes = smart.picks.filter((p) => p.deco.kind === "weapon").flatMap((p) => new Array(p.count).fill(p.deco.slot));
	check("smart armor jewels fit the free armor slots", Solver.fitJewels(armorSizes, result.freeSlots) !== null, armorSizes.join(","));
	check("smart weapon jewels fit the weapon slots", Solver.fitJewels(weaponSizes, [3, 3, 3]) !== null, weaponSizes.join(","));
	check("smart jewels raise damage", smart.stats.damageGain > before.damageGain,
		(before.damageGain * 100).toFixed(1) + "% -> " + (smart.stats.damageGain * 100).toFixed(1) + "%");
	check("every pick adds damage", smart.picks.every((p) => p.gain > 0));
	const overMax = [...smart.levels].filter(([id, level]) => level > index.skillById.get(id).ranks.length);
	check("no skill goes past its max level", overMax.length === 0);
	console.log("     picks: " + smart.picks.map((p) => p.count + "x " + p.deco.name + " (+" + (p.gain * 100).toFixed(1) + "%)").join(", "));
	console.log("     affinity " + smart.stats.affinity + "%, attack +" + smart.stats.attack + " +" + smart.stats.attackPct + "%, crit +" + smart.stats.critDamage + "%");
}
{
	// With no situations on, only always-on skills help (Attack Boost, Critical Eye ...),
	// and those are all weapon jewels in Wilds.
	const smart = Stats.suggestJewels(index, effects, new Map(), [3, 3, 2, 1], [3, 3, 3], new Set(), 0);
	const situational = smart.picks.filter((p) => p.deco.skills.some(([id]) =>
		(effects.skills[index.skillById.get(id).name] || []).every((part) => part.when !== "always")));
	check("with no situations ticked, some always-on jewels are picked", smart.picks.length > 0,
		smart.picks.map((p) => p.deco.name).join(", "));
	check("with no situations ticked, no situational jewels are picked", situational.length === 0,
		situational.map((p) => p.deco.name).join(", "));
	check("with no situations ticked, armor slots stay free", smart.leftArmorSlots.length === 4);
}

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) failed.");
process.exit(failures === 0 ? 0 : 1);
