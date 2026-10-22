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
for (const file of ["data.js", "effects.js", "builds.js"]) {
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox);
}
const data = sandbox.window.WILDS_DATA;
const popular = sandbox.window.WILDS_POPULAR;
const effects = sandbox.window.WILDS_EFFECTS;
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

// --- Where each jewel goes ---
{
	const deco = (name) => data.decorations.find((d) => d.name === name);
	// The reported case: two Magazine Jewel [1], a weapon with ③ ② ① and a charm with one ① weapon slot.
	const placed = Solver.placeJewels(
		[
			{ deco: deco("Magazine Jewel [1]"), count: 2 },
			{ deco: deco("Artillery Jewel III [3]"), count: 1 },
			{ deco: deco("Critical Jewel II [2]"), count: 1 },
		],
		[{ size: 3, place: "weapon" }, { size: 2, place: "weapon" }, { size: 1, place: "weapon" }, { size: 1, place: "charm" }]);
	check("2 Magazine Jewels: one in the weapon's ① slot, one in the charm's", placed.places[0].join(",") === "weapon,charm", placed.places[0].join(","));
	check("the big jewels take the big weapon slots", placed.places[1][0] === "weapon" && placed.places[2][0] === "weapon");
	check("nothing left over when every slot is used", placed.left.length === 0);

	// Every jewel of every found set must get a real place, with your own charm in play.
	const myCharm = {
		id: "mine-place", name: "Place charm", rarity: 8, custom: true,
		skills: [[skillId("Divine Blessing"), 3], [skillId("Attack Boost"), 3]], armorSlots: [1, 1], weaponSlots: [1],
	};
	let unplaced = "";
	for (const build of popular.builds) {
		const targets = build.skills.map(([name, level]) => ({ skillId: skillId(name), level: level }));
		const answer = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], gogmaWeapon: true, customCharms: [myCharm], onlyCharm: myCharm.id });
		for (const result of answer.results) {
			const armorSlots = result.pieces.flatMap((p) => p.slots.map((s) => ({ size: s, place: p.name })))
				.concat(myCharm.armorSlots.map((s) => ({ size: s, place: "charm" })));
			const weaponSlots = [3, 3, 3].map((s) => ({ size: s, place: "weapon" })).concat([{ size: 1, place: "charm" }]);
			const armor = Solver.placeJewels(result.jewels, armorSlots);
			const weapon = Solver.placeJewels(result.weapon.jewels, weaponSlots);
			if (armor.places.flat().includes(null) || weapon.places.flat().includes(null)) {
				unplaced = build.name;
			}
		}
	}
	check("every needed jewel in every ready-made build gets a place (with your charm)", unplaced === "", unplaced);
}

// --- Your Gogma weapon with a known set bonus and group skill ---
{
	const piecesWith = (result, name) => result.pieces.filter((p) => p.skills.some(([id]) => index.skillById.get(id).name === name)).length;
	const gore = skillId("Gore Magala's Tyranny");
	const lords = skillId("Lord's Soul");

	// The weapon has Lord's Soul, so two armor pieces with it are enough for Guts.
	const guts = Solver.findSets(index, {
		targets: [{ skillId: lords, level: 1 }], weaponSlots: [3, 3, 3], gogmaWeapon: true, gogmaSet: gore, gogmaGroup: lords,
	});
	const gutsProblem = resultReachesGoals(guts, [{ skillId: lords, level: 1 }]);
	check("Gogma weapon with Lord's Soul: sets correct", guts.results.length > 0 && gutsProblem === "", gutsProblem);
	check("Gogma weapon with Lord's Soul: some set needs only 2 Lord's Soul armor pieces",
		guts.results.some((r) => piecesWith(r, "Lord's Soul") === 2),
		guts.results.map((r) => piecesWith(r, "Lord's Soul")).join(","));
	check("Gogma weapon's bonus is marked as fixed", guts.results.every((r) => r.weaponBonus.groupFixed && r.weaponBonus.setFixed));
	const totals = Solver.totalSkills(index, guts.results[0]);
	check("the weapon's own set bonus counts even when not wished",
		totals.some((e) => e.skill.id === gore && e.pieces >= 1), String((totals.find((e) => e.skill.id === gore) || {}).pieces));

	// The weapon has Gore Magala's Tyranny, so it cannot help with Gogmapocalypse: 4 armor pieces needed.
	const gogma = Solver.findSets(index, {
		targets: [{ skillId: skillId("Gogmapocalypse"), level: 2 }], weaponSlots: [3, 3, 3], gogmaWeapon: true, gogmaSet: gore, gogmaGroup: lords,
	});
	check("Gogma weapon with another set bonus: Gogmapocalypse II needs 4 armor pieces",
		gogma.results.length > 0 && gogma.results.every((r) => piecesWith(r, "Gogmapocalypse") >= 4),
		gogma.results.map((r) => piecesWith(r, "Gogmapocalypse")).join(","));

	// Left on "any", the same wish can use the weapon for the 4th piece.
	const flexible = Solver.findSets(index, {
		targets: [{ skillId: skillId("Gogmapocalypse"), level: 2 }], weaponSlots: [3, 3, 3], gogmaWeapon: true,
	});
	check("Gogma weapon left on 'any': results stay correct",
		flexible.results.length > 0 && resultReachesGoals(flexible, [{ skillId: skillId("Gogmapocalypse"), level: 2 }]) === "");
}

// --- Whole-set armor (Akuma α: the game puts on all five pieces together) ---
{
	const WHOLE = effects.wholeSetOnly;
	const akuma = data.armor.filter((a) => a.set === "Akuma α");
	const partial = (answer) => answer.results.filter((r) => {
		const n = r.pieces.filter((p) => WHOLE.includes(p.set)).length;
		return n > 0 && n < 5;
	});
	const myCharm = {
		id: "mine-whole", name: "attak/blessing", rarity: 8, custom: true,
		skills: [[skillId("Attack Boost"), 3], [skillId("Divine Blessing"), 3]], armorSlots: [1, 1], weaponSlots: [1],
	};
	const wishes = [
		[[{ skillId: skillId("Heroics"), level: 5 }], "Heroics 5"],
		[[{ skillId: skillId("Heroics"), level: 5 }, { skillId: skillId("Weakness Exploit"), level: 5 }, { skillId: skillId("Agitator"), level: 5 }], "Heroics + WEX + Agitator"],
	];

	check("the Akuma α set has all five pieces in the data", akuma.length === 5 && new Set(akuma.map((a) => a.kind)).size === 5);
	check("effects.js names real sets", WHOLE.every((name) => data.armor.some((a) => a.set === name)));

	// The bug that was reported: one Demon Garb α mixed in with other armor.
	for (const [targets, label] of wishes) {
		const before = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], gogmaWeapon: true, customCharms: [myCharm], onlyCharm: myCharm.id });
		const after = Solver.findSets(index, { targets: targets, weaponSlots: [3, 3, 3], gogmaWeapon: true, customCharms: [myCharm], onlyCharm: myCharm.id, wholeSets: WHOLE });
		check(label + ": without the rule a lone Akuma piece shows up (this was the bug)", partial(before).length > 0, partial(before).length + " of " + before.results.length);
		check(label + ": with the rule, never a partial Akuma set", partial(after).length === 0 && after.results.length > 0, after.results.length + " sets");
		check(label + ": the rule keeps the sets correct", resultReachesGoals(after, targets) === "");
	}

	// Wishing for the Akuma group skill: the only answer is all five pieces, never three.
	const fist = [{ skillId: skillId("Master of the Fist"), level: 1 }];
	const fistAnswer = Solver.findSets(index, { targets: fist, weaponSlots: [3, 3, 3], gogmaWeapon: false, wholeSets: WHOLE });
	check("Master of the Fist (needs 3 Akuma pieces): the full 5-piece set is offered",
		fistAnswer.results.length === 1 && fistAnswer.results[0].pieces.every((p) => p.set === "Akuma α"),
		fistAnswer.results.map((r) => r.pieces.map((p) => p.name).join("/")).join(" | "));
	check("...and it lists all five pieces in head to legs order",
		fistAnswer.results[0] && fistAnswer.results[0].pieces.map((p) => p.kind).join(",") === "head,chest,arms,waist,legs");
	const fistTotals = fistAnswer.results[0] ? Solver.totalSkills(index, fistAnswer.results[0]) : [];
	check("...with Heroics 3 from the Demon Garb counted", levelOf(fistTotals, "Heroics") === 3, String(levelOf(fistTotals, "Heroics")));
	// Without the rule, three Akuma pieces plus others were offered, which the game does not allow.
	const fistLoose = Solver.findSets(index, { targets: fist, weaponSlots: [3, 3, 3], gogmaWeapon: false });
	check("without the rule, Master of the Fist could be reached with just 3 Akuma pieces (not possible in the game)",
		fistLoose.results.some((r) => r.pieces.filter((p) => p.set === "Akuma α").length === 3));
}

// --- The ready-made builds list says how fresh it is ---
{
	const real = /^\d{4}-\d{2}-\d{2}$/.test(popular.checked) && !isNaN(new Date(popular.checked + "T12:00:00"));
	check("ready-made builds: 'checked' is a real date (YYYY-MM-DD)", real, popular.checked);
	check("ready-made builds: 'checked' is not in the future", new Date(popular.checked + "T12:00:00") <= new Date(), popular.checked);
	const badSources = popular.sources.filter((s) => !s.name || !s.short || !/^https:\/\//.test(s.url));
	check("ready-made builds: every source has a name, a short name and a https link", popular.sources.length > 0 && badSources.length === 0,
		badSources.map((s) => s.name).join(", "));
	const weapons = new Set(popular.builds.map((b) => b.weapon));
	check("ready-made builds: no weapon listed twice by mistake", weapons.size === popular.builds.length, popular.builds.length + " builds");
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
