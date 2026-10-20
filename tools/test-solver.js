// Checks the set finder without opening the page.
//   node tools/test-solver.js
// Prints PASS/FAIL per check and exits with an error code if anything fails.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Solver = require("../solver.js");

// data.js and builds.js are written for the browser (they set window.X),
// so run them with a pretend window.
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of ["data.js", "builds.js"]) {
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox);
}
const data = sandbox.window.WILDS_DATA;
const popular = sandbox.window.WILDS_POPULAR;
const index = Solver.makeIndex(data);

let failures = 0;
function check(name, ok, detail) {
	console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : ""));
	if (!ok) {
		failures += 1;
	}
}

function skillId(name) {
	const skill = data.skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
	return skill ? skill.id : null;
}

function levelOf(list, name) {
	const entry = list.find((e) => e.skill.name === name);
	return entry ? entry.level : 0;
}

// Every result must really reach every goal. This re-adds the skills from scratch.
function resultReachesGoals(answer, targets) {
	for (const result of answer.results) {
		const totals = Solver.totalSkills(index, result, result.weapon);
		for (const target of targets) {
			const skill = index.skillById.get(target.skillId);
			const goal = Math.min(target.level, Solver.maxLevel(skill));
			if (skill.kind === "weapon") {
				// Weapon skills may not fit; then they must be reported as missing.
				const missing = result.weapon.missing.find((m) => m.skill.id === skill.id);
				const have = levelOf(totals, skill.name) + (missing ? missing.levels : 0);
				if (have < goal) {
					return skill.name + " neither reached nor reported missing";
				}
				continue;
			}
			if (levelOf(totals, skill.name) < goal) {
				return skill.name + " only " + levelOf(totals, skill.name) + " in " + result.pieces.map((p) => p.name).join(", ");
			}
		}
		// Armor jewels must fit the armor's slots plus the charm's armor slots.
		const slots = result.pieces.flatMap((p) => p.slots).concat(result.charm && result.charm.armorSlots ? result.charm.armorSlots : []);
		const sizes = result.jewels.flatMap((j) => new Array(j.count).fill(j.deco.slot));
		if (Solver.fitJewels(sizes, slots) === null) {
			return "armor jewels do not fit";
		}
		// Weapon jewels must fit the weapon's slots plus the charm's weapon slots.
		const weaponSizes = result.weapon.jewels.flatMap((j) => new Array(j.count).fill(j.deco.slot));
		if (Solver.fitJewels(weaponSizes, result.weapon.slots) === null) {
			return "weapon jewels do not fit";
		}
	}
	return "";
}

// --- Jewel fitting ---
check("jewel fit: 3,2 into 3,2", Solver.fitJewels([2, 3], [2, 3]) !== null);
check("jewel fit: 3,3 into 3,2 fails", Solver.fitJewels([3, 3], [3, 2]) === null);
check("jewel fit: jewels use the smallest slot that fits, keeping the big one free", JSON.stringify(Solver.fitJewels([1, 2], [1, 3, 2])) === "[3]");
check("jewel fit: too many jewels fails", Solver.fitJewels([1, 1, 1], [3, 3]) === null);

// --- Heroics 5, the original wish ---
{
	const targets = [{ skillId: skillId("Heroics"), level: 5 }];
	const answer = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], gogmaWeapon: false });
	check("Heroics 5 finds sets", answer.results.length > 0, answer.results.length + " sets in " + answer.milliseconds + " ms");
	const problem = resultReachesGoals(answer, targets);
	check("Heroics 5 sets really reach Heroics 5", problem === "", problem);
	if (answer.results[0]) {
		const top = answer.results[0];
		console.log("     best: " + top.pieces.map((p) => p.name).join(" / ") +
			(top.charm ? " + " + top.charm.name : "") +
			" | jewels: " + top.jewels.map((j) => j.count + "x " + j.deco.name).join(", ") +
			" | free slots " + top.freeSlots.join(",") + " | defense " + top.defense);
	}
}

// --- A goal that cannot be reached returns nothing (and does not hang) ---
{
	const targets = ["Heroics", "Resentment", "Latent Power", "Peak Performance", "Agitator", "Weakness Exploit", "Burst", "Counterstrike"]
		.map((n) => ({ skillId: skillId(n), level: 5 }));
	const answer = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], gogmaWeapon: true, timeLimitMs: 3000 });
	check("impossible wish list returns no sets", answer.results.length === 0, answer.milliseconds + " ms");
	check("impossible wish list stops in time", answer.milliseconds < 4000, answer.milliseconds + " ms");
}

// --- Set bonus: two Gore Magala pieces ---
{
	const targets = [{ skillId: skillId("Gore Magala's Tyranny"), level: 1 }];
	const answer = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], gogmaWeapon: false });
	const problem = resultReachesGoals(answer, targets);
	check("Gore Magala 2-piece bonus is found", answer.results.length > 0 && problem === "", problem);
}

// --- Weapon jewels ---
{
	const targets = [{ skillId: skillId("Critical Boost"), level: 5 }];
	const answer = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], gogmaWeapon: false });
	const names = answer.weapon.jewels.map((j) => j.count + "x " + j.deco.name).join(", ");
	check("Critical Boost 5 fits in a 3-3-3 weapon", answer.weapon.missing.length === 0, names);
	const small = Solver.findSets(index, { targets: targets, weaponSlots: [1], gogmaWeapon: false });
	check("Critical Boost 5 reports what is missing in a 1-slot weapon", small.weapon.missing.length === 1, small.weapon.missing.map((m) => m.skill.name + " " + m.levels).join(", "));
}

// --- Your own charm (the user's real one: Divine Blessing 3, Attack Boost 3, armor ①①, weapon ①) ---
{
	const myCharm = {
		id: "mine-test", name: "Test charm", rarity: 8, custom: true,
		skills: [[skillId("Divine Blessing"), 3], [skillId("Attack Boost"), 3]],
		armorSlots: [1, 1], weaponSlots: [1],
	};
	const targets = [{ skillId: skillId("Heroics"), level: 5 }, { skillId: skillId("Attack Boost"), level: 5 }];

	const forced = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], customCharms: [myCharm], onlyCharm: myCharm.id });
	check("build around your charm: sets found", forced.results.length > 0, forced.results.length + " sets");
	check("build around your charm: every set uses it", forced.results.every((r) => r.charm === myCharm));
	const problem = resultReachesGoals(forced, targets);
	check("build around your charm: sets really reach the goals", problem === "", problem);
	const first = forced.results[0];
	if (first) {
		const totals = Solver.totalSkills(index, first);
		check("charm's Divine Blessing 3 is counted", levelOf(totals, "Divine Blessing") >= 3, String(levelOf(totals, "Divine Blessing")));
		check("charm's Attack Boost 3 lowers what the weapon jewels must give",
			first.weapon.jewels.every((j) => j.deco.slot <= 2) && levelOf(totals, "Attack Boost") === 5,
			first.weapon.jewels.map((j) => j.count + "x " + j.deco.name).join(", "));
		check("charm's weapon slot counts as a weapon slot", first.weapon.slots.length === 4, first.weapon.slots.join(","));
		check("charm's armor slots count as armor slots",
			first.freeSlots.length + first.jewels.reduce((n, j) => n + j.count, 0) === first.pieces.flatMap((p) => p.slots).length + 2);
	}

	// Without "build around", the finder may still pick a crafted charm if that is better.
	const free = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], customCharms: [myCharm] });
	const freeProblem = resultReachesGoals(free, targets);
	check("your charm as one option among many: sets correct", free.results.length > 0 && freeProblem === "", freeProblem);

	// A charm that gives a wished armor skill must be able to help reach it.
	const heroicsCharm = { id: "mine-heroics", name: "Heroics charm", rarity: 8, custom: true, skills: [[skillId("Heroics"), 5]], armorSlots: [], weaponSlots: [] };
	const helped = Solver.findSets(index, {
		targets: [{ skillId: skillId("Heroics"), level: 5 }], weaponSlots: [3, 3, 3], customCharms: [heroicsCharm], onlyCharm: heroicsCharm.id,
	});
	check("a custom Heroics 5 charm needs no Heroics jewels",
		helped.results.length > 0 && helped.results[0].jewels.length === 0,
		helped.results[0] ? helped.results[0].jewels.map((j) => j.deco.name).join(", ") || "no jewels" : "no sets");
}

// --- Every popular build: names must exist, and the finder should cope ---
for (const build of popular.builds) {
	const unknown = build.skills.filter(([name]) => skillId(name) === null).map(([name]) => name);
	check(build.name + ": all skill names known", unknown.length === 0, unknown.join(", "));
	const targets = build.skills.filter(([name]) => skillId(name) !== null).map(([name, level]) => ({ skillId: skillId(name), level: level }));
	const answer = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], gogmaWeapon: true });
	const problem = resultReachesGoals(answer, targets);
	check(build.name + ": sets found and correct", answer.results.length > 0 && problem === "",
		answer.results.length + " sets, " + answer.milliseconds + " ms" + (answer.timedOut ? ", timed out" : "") +
		", options " + answer.optionCounts.join("/") + (problem ? ", " + problem : ""));
}

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) failed.");
process.exit(failures === 0 ? 0 : 1);
