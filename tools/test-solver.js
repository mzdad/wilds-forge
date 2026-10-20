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
		const totals = Solver.totalSkills(index, result, answer.weapon);
		for (const target of targets) {
			const skill = index.skillById.get(target.skillId);
			if (skill.kind === "weapon") {
				continue; // weapon skills are reported as "missing" instead
			}
			const goal = Math.min(target.level, Solver.maxLevel(skill));
			if (levelOf(totals, skill.name) < goal) {
				return skill.name + " only " + levelOf(totals, skill.name) + " in " + result.pieces.map((p) => p.name).join(", ");
			}
		}
		// Jewels must fit the slots the armor actually has.
		const slots = result.pieces.flatMap((p) => p.slots);
		const sizes = result.jewels.flatMap((j) => new Array(j.count).fill(j.deco.slot));
		if (Solver.fitJewels(sizes, slots) === null) {
			return "jewels do not fit";
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
