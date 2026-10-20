// The set finder: given the skills you want, it tries armor combinations and
// finds the ones that reach every skill, with jewels filling the gaps.
//
// It works in the browser (window.WildsSolver) and in Node (for tests).
//
// How a search works, in short:
//   1. For each armor slot (head, chest ...) keep only the pieces that could matter.
//      A piece is dropped when another piece is at least as good in every way
//      that counts for THIS search (skills you asked for, and jewel slots).
//   2. Try every combination of the remaining pieces, skipping any branch that
//      can no longer reach the goal, even with the best pieces still to come.
//   3. For each full set, try each useful charm, then check if jewels can fill
//      what is still missing.

(function (root) {
	"use strict";

	const ARMOR_KINDS = ["head", "chest", "arms", "waist", "legs"];

	// Searching every combination can take long for big wish lists, so stop after this.
	const DEFAULT_TIME_LIMIT_MS = 3000;
	const DEFAULT_MAX_RESULTS = 8;

	// How strongly the ranking prefers spare jewel slots over defense.
	const SCORE_PER_FREE_SLOT_LEVEL = 10;
	const SCORE_PER_DEFENSE = 0.1;
	// A result that needs the special Gogma Artian weapon bonus ranks lower,
	// because not everyone owns such a weapon.
	const SCORE_PENALTY_WEAPON_BONUS = 100;
	// A wished weapon skill level that does not fit anywhere. Only differs between sets
	// when your own charm (with weapon skills or weapon slots) is in some sets and not others.
	const SCORE_PENALTY_MISSING_WEAPON_LEVEL = 40;

	// ---------- Looking things up ----------

	function makeIndex(data) {
		const skillById = new Map();
		for (const skill of data.skills) {
			skillById.set(skill.id, skill);
		}

		// The smallest armor jewel for each armor skill. In Wilds every armor
		// jewel gives exactly one level of one skill, so one jewel per skill is enough.
		const armorJewelBySkill = new Map();
		for (const deco of data.decorations) {
			if (deco.kind !== "armor") {
				continue;
			}
			if (deco.skills.length !== 1 || deco.skills[0][1] !== 1) {
				continue;
			}
			const skillId = deco.skills[0][0];
			const known = armorJewelBySkill.get(skillId);
			if (!known || deco.slot < known.slot) {
				armorJewelBySkill.set(skillId, deco);
			}
		}

		return { data: data, skillById: skillById, armorJewelBySkill: armorJewelBySkill };
	}

	function maxLevel(skill) {
		return skill.ranks.length;
	}

	// For set bonuses and group skills, "level" means which bonus step you want.
	// This turns it into how many armor pieces that step needs.
	function piecesNeeded(skill, level) {
		const rank = skill.ranks.find((r) => r.level === level) || skill.ranks[skill.ranks.length - 1];
		return rank.pieces;
	}

	function isPieceCountSkill(skill) {
		return skill.kind === "set" || skill.kind === "group";
	}

	// Splits the wish list into the three kinds of goals the search handles differently.
	function splitTargets(index, targets) {
		const armorGoals = []; // reached by armor skills + charm + armor jewels
		const pieceGoals = []; // set bonuses and group skills: reached by wearing enough pieces
		const weaponGoals = []; // reached by weapon jewels

		for (const target of targets) {
			const skill = index.skillById.get(target.skillId);
			if (!skill) {
				continue;
			}
			const level = Math.max(1, Math.min(target.level, maxLevel(skill)));
			if (skill.kind === "weapon") {
				weaponGoals.push({ skill: skill, need: level });
			} else if (isPieceCountSkill(skill)) {
				pieceGoals.push({ skill: skill, level: level, need: piecesNeeded(skill, level) });
			} else {
				armorGoals.push({
					skill: skill,
					need: level,
					jewel: index.armorJewelBySkill.get(skill.id) || null,
				});
			}
		}
		return { armorGoals: armorGoals, pieceGoals: pieceGoals, weaponGoals: weaponGoals };
	}

	// ---------- Comparing pieces ----------

	// What a piece gives towards each goal, capped at what the goal needs.
	// Armor goals come first in the list, then piece-count goals.
	function contributionOf(skillPairs, armorGoals, pieceGoals) {
		const gives = new Array(armorGoals.length + pieceGoals.length).fill(0);
		for (const pair of skillPairs) {
			const skillId = pair[0];
			const level = pair[1];
			for (let i = 0; i < armorGoals.length; i++) {
				if (armorGoals[i].skill.id === skillId) {
					gives[i] = Math.min(level, armorGoals[i].need);
				}
			}
			for (let j = 0; j < pieceGoals.length; j++) {
				if (pieceGoals[j].skill.id === skillId) {
					gives[armorGoals.length + j] = 1;
				}
			}
		}
		return gives;
	}

	// Slots sorted biggest first, always three long, so they compare position by position.
	function slotProfile(slots) {
		const sorted = slots.slice().sort((a, b) => b - a);
		while (sorted.length < 3) {
			sorted.push(0);
		}
		return sorted;
	}

	function atLeastAsGood(a, b) {
		for (let i = 0; i < a.gives.length; i++) {
			if (a.gives[i] < b.gives[i]) {
				return false;
			}
		}
		for (let i = 0; i < 3; i++) {
			if (a.slots[i] < b.slots[i]) {
				return false;
			}
		}
		return true;
	}

	function sameValue(a, b) {
		return atLeastAsGood(a, b) && atLeastAsGood(b, a);
	}

	// Keeps only pieces that no other piece beats. When two pieces are equally useful,
	// the one with more defense stays.
	function removeBeatenOptions(options) {
		const kept = [];
		for (const option of options) {
			let beaten = false;
			for (const other of options) {
				if (other === option || !atLeastAsGood(other, option)) {
					continue;
				}
				if (!sameValue(other, option)) {
					beaten = true;
					break;
				}
				// Equal for this search: keep the higher defense (or the lower id on a tie, so exactly one survives).
				if (other.defense > option.defense || (other.defense === option.defense && other.id < option.id)) {
					beaten = true;
					break;
				}
			}
			if (!beaten) {
				kept.push(option);
			}
		}
		return kept;
	}

	// A rough "how useful is this" number, used only to try promising pieces first.
	function roughValue(option, goals) {
		let value = 0;
		for (let i = 0; i < option.gives.length; i++) {
			const goal = goals[i];
			// Skills with no jewel can only come from armor, so they count extra.
			const weight = goal.jewel === undefined ? 3 : goal.jewel ? goal.jewel.slot : 4;
			value += option.gives[i] * weight;
		}
		value += (option.slots[0] + option.slots[1] + option.slots[2]) * 0.5;
		value += option.defense / 1000;
		return value;
	}

	// ---------- Jewels ----------

	// Can these jewels (sizes) all fit into these slots? A jewel fits any slot of its
	// size or bigger. Placing the biggest jewels first, each in the smallest slot that
	// still fits, always finds a fit when one exists.
	// Returns the slots left empty, or null when they do not fit.
	function fitJewels(jewelSizes, slots) {
		if (jewelSizes.length > slots.length) {
			return null;
		}
		const free = slots.slice().sort((a, b) => a - b); // smallest first
		const jewels = jewelSizes.slice().sort((a, b) => b - a); // biggest first
		for (const size of jewels) {
			const at = free.findIndex((slot) => slot >= size);
			if (at === -1) {
				return null;
			}
			free.splice(at, 1);
		}
		return free.sort((a, b) => b - a);
	}

	// Picks weapon jewels for weapon skills. A weapon has at most three slots,
	// so trying every combination is quick.
	function solveWeapon(index, weaponGoals, weaponSlots) {
		if (weaponGoals.length === 0) {
			return { jewels: [], missing: [] };
		}

		let options = [];
		for (const deco of index.data.decorations) {
			if (deco.kind !== "weapon") {
				continue;
			}
			const gives = weaponGoals.map((goal) => {
				const pair = deco.skills.find((p) => p[0] === goal.skill.id);
				return pair ? Math.min(pair[1], goal.need) : 0;
			});
			if (gives.some((g) => g > 0)) {
				options.push({ deco: deco, gives: gives, size: deco.slot });
			}
		}
		// Drop jewels that another jewel beats: same or smaller slot, same or more skill.
		function beats(other, option) {
			if (other === option || other.size > option.size) {
				return false;
			}
			if (!other.gives.every((g, i) => g >= option.gives[i])) {
				return false;
			}
			if (other.size < option.size || other.gives.some((g, i) => g > option.gives[i])) {
				return true;
			}
			// Exactly as useful here. Prefer a plain one-skill jewel (easier to recognise),
			// then the lower id, so exactly one of them survives.
			if (other.deco.skills.length !== option.deco.skills.length) {
				return other.deco.skills.length < option.deco.skills.length;
			}
			return other.deco.id < option.deco.id;
		}
		options = options.filter((option) => !options.some((other) => beats(other, option)));

		const slots = weaponSlots.filter((s) => s > 0);
		let best = { picked: [], covered: 0, size: 0 };

		function covered(picked) {
			let total = 0;
			for (let i = 0; i < weaponGoals.length; i++) {
				let got = 0;
				for (const option of picked) {
					got += option.gives[i];
				}
				total += Math.min(got, weaponGoals[i].need);
			}
			return total;
		}

		function tryFrom(start, picked) {
			if (fitJewels(picked.map((o) => o.size), slots) === null) {
				return;
			}
			const score = covered(picked);
			const size = picked.reduce((sum, o) => sum + o.size, 0);
			const better =
				score > best.covered ||
				(score === best.covered && picked.length < best.picked.length) ||
				(score === best.covered && picked.length === best.picked.length && size < best.size);
			if (better) {
				best = { picked: picked.slice(), covered: score, size: size };
			}
			if (picked.length === slots.length) {
				return;
			}
			for (let k = start; k < options.length; k++) {
				picked.push(options[k]);
				tryFrom(k, picked);
				picked.pop();
			}
		}
		tryFrom(0, []);

		const missing = [];
		weaponGoals.forEach((goal, i) => {
			let got = 0;
			for (const option of best.picked) {
				got += option.gives[i];
			}
			if (got < goal.need) {
				missing.push({ skill: goal.skill, levels: goal.need - got });
			}
		});
		return { jewels: countJewels(best.picked.map((o) => o.deco)), missing: missing };
	}

	// The level a charm gives in one skill (0 for no charm or not on it).
	function levelOn(charm, skillId) {
		if (!charm) {
			return 0;
		}
		const pair = charm.skills.find((p) => p[0] === skillId);
		return pair ? pair[1] : 0;
	}

	// Turns a list of jewels into [{ deco, count }], e.g. "Attack Jewel III x2".
	function countJewels(decos) {
		const counted = [];
		for (const deco of decos) {
			const entry = counted.find((c) => c.deco.id === deco.id);
			if (entry) {
				entry.count += 1;
			} else {
				counted.push({ deco: deco, count: 1 });
			}
		}
		return counted;
	}

	// ---------- The armor search ----------

	function findSets(index, request) {
		const started = Date.now();
		const timeLimit = request.timeLimitMs || DEFAULT_TIME_LIMIT_MS;
		const maxResults = request.maxResults || DEFAULT_MAX_RESULTS;
		const allowWeaponBonus = !!request.gogmaWeapon;

		const split = splitTargets(index, request.targets);
		const armorGoals = split.armorGoals;
		const pieceGoals = split.pieceGoals;
		const goals = armorGoals.concat(pieceGoals);
		const need = goals.map((goal) => goal.need);
		const firstPieceGoal = armorGoals.length;

		const weaponSlots = request.weaponSlots || [3, 3, 3];
		// Your own charms: { id, name, rarity, skills, armorSlots, weaponSlots, custom: true }.
		const customCharms = request.customCharms || [];
		const forcedCharm = customCharms.find((charm) => charm.id === request.onlyCharm) || null;

		// The weapon jewels depend on the charm only when it has weapon skills or weapon
		// slots (only your own appraised charms do), so each charm is worked out once.
		const weaponByCharm = new Map();
		function weaponFor(charm) {
			const key = charm && charm.custom ? charm.id : "crafted";
			if (!weaponByCharm.has(key)) {
				const goals = split.weaponGoals
					.map((goal) => ({ skill: goal.skill, need: goal.need - levelOn(charm, goal.skill.id) }))
					.filter((goal) => goal.need > 0);
				const slots = weaponSlots.concat(charm && charm.weaponSlots ? charm.weaponSlots : []);
				const solved = solveWeapon(index, goals, slots);
				const used = solved.jewels.flatMap((entry) => new Array(entry.count).fill(entry.deco.slot));
				weaponByCharm.set(key, {
					jewels: solved.jewels,
					missing: solved.missing,
					slots: slots,
					freeSlots: fitJewels(used, slots) || [],
				});
			}
			return weaponByCharm.get(key);
		}

		// Options per armor slot.
		const optionsByKind = ARMOR_KINDS.map((kind) => {
			const options = [];
			for (const piece of index.data.armor) {
				if (piece.kind !== kind) {
					continue;
				}
				if (piece.rank !== "high" && !request.includeLowRank) {
					continue;
				}
				options.push({
					id: piece.id,
					piece: piece,
					gives: contributionOf(piece.skills, armorGoals, pieceGoals),
					slots: slotProfile(piece.slots),
					defense: piece.defense,
				});
			}
			const kept = removeBeatenOptions(options);
			kept.sort((a, b) => roughValue(b, goals) - roughValue(a, goals));
			return kept;
		});

		// Crafted charm options. Crafted charms only carry armor skills and have no slots.
		let charmOptions = [];
		for (const charm of index.data.charms) {
			const gives = contributionOf(charm.skills, armorGoals, []);
			if (gives.some((g) => g > 0)) {
				charmOptions.push({ id: charm.id, charm: charm, gives: gives, slots: [0, 0, 0], defense: charm.rarity });
			}
		}
		charmOptions = removeBeatenOptions(charmOptions);
		// Your own charms always stay in the running: their slots and weapon skills can matter
		// even when they give none of the wished armor skills.
		const customOptions = customCharms.map((charm) => ({
			id: charm.id, charm: charm, gives: contributionOf(charm.skills, armorGoals, []), slots: [0, 0, 0], defense: 0,
		}));
		// "Build around this charm" means every set uses it. Otherwise null stands for
		// "any charm you like" (when no charm is needed for the wished skills).
		const charmChoices = forcedCharm
			? customOptions.filter((option) => option.charm === forcedCharm)
			: [null].concat(charmOptions, customOptions);
		const realChoices = charmChoices.filter(Boolean);

		const charmBest = armorGoals.map((_, i) => Math.max(0, ...realChoices.map((c) => c.gives[i])));
		const charmSlotsBest = Math.max(0, ...realChoices.map((c) => (c.charm.armorSlots || []).length));

		// For pruning: the most each goal could still gain from the slots not yet chosen.
		const stillPossible = [];
		const slotsStillPossible = [];
		for (let depth = 0; depth <= ARMOR_KINDS.length; depth++) {
			const gains = new Array(goals.length).fill(0);
			let slotCount = 0;
			for (let k = depth; k < ARMOR_KINDS.length; k++) {
				const options = optionsByKind[k];
				for (let i = 0; i < goals.length; i++) {
					gains[i] += Math.max(0, ...options.map((o) => o.gives[i]));
				}
				slotCount += Math.max(0, ...options.map((o) => o.slots.filter((s) => s > 0).length));
			}
			stillPossible.push(gains);
			slotsStillPossible.push(slotCount);
		}

		const results = [];
		const current = new Array(goals.length).fill(0);
		const chosen = [];
		let setsChecked = 0;
		let timedOut = false;

		function canStillReachGoal(depth) {
			const gains = stillPossible[depth];
			// Set bonuses and group skills: only armor (and one weapon bonus) can give them.
			for (let i = firstPieceGoal; i < goals.length; i++) {
				const weaponHelp = allowWeaponBonus ? 1 : 0;
				if (current[i] + gains[i] + weaponHelp < need[i]) {
					return false;
				}
			}
			// Armor skills: count how many jewels would be needed at the very least.
			let jewelsNeeded = 0;
			for (let i = 0; i < firstPieceGoal; i++) {
				const short = need[i] - current[i] - gains[i] - charmBest[i];
				if (short <= 0) {
					continue;
				}
				if (!armorGoals[i].jewel) {
					return false; // no jewel exists for this skill
				}
				jewelsNeeded += short;
			}
			let slotsSoFar = 0;
			for (const option of chosen) {
				slotsSoFar += option.slots.filter((s) => s > 0).length;
			}
			return jewelsNeeded <= slotsSoFar + slotsStillPossible[depth] + charmSlotsBest;
		}

		function checkFullSet() {
			setsChecked += 1;

			// Set bonuses and group skills. A Gogma Artian weapon can add one piece
			// to one set bonus and one piece to one group skill.
			let setShort = null;
			let groupShort = null;
			for (let j = 0; j < pieceGoals.length; j++) {
				const short = need[firstPieceGoal + j] - current[firstPieceGoal + j];
				if (short <= 0) {
					continue;
				}
				if (short > 1 || !allowWeaponBonus) {
					return;
				}
				if (pieceGoals[j].skill.kind === "set") {
					if (setShort) {
						return;
					}
					setShort = pieceGoals[j].skill;
				} else {
					if (groupShort) {
						return;
					}
					groupShort = pieceGoals[j].skill;
				}
			}

			const slots = [];
			let defense = 0;
			for (const option of chosen) {
				defense += option.defense;
				for (const s of option.piece.slots) {
					slots.push(s);
				}
			}

			let best = null;
			for (const charm of charmChoices) {
				const jewels = [];
				let possible = true;
				for (let i = 0; i < firstPieceGoal; i++) {
					const have = current[i] + (charm ? charm.gives[i] : 0);
					const short = need[i] - have;
					if (short <= 0) {
						continue;
					}
					if (!armorGoals[i].jewel) {
						possible = false;
						break;
					}
					for (let n = 0; n < short; n++) {
						jewels.push(armorGoals[i].jewel);
					}
				}
				if (!possible) {
					continue;
				}
				// Armor jewels can also go in the charm's own armor slots.
				const armorSlots = charm && charm.charm.armorSlots ? slots.concat(charm.charm.armorSlots) : slots;
				const freeSlots = fitJewels(jewels.map((j) => j.slot), armorSlots);
				if (freeSlots === null) {
					continue;
				}
				const weapon = weaponFor(charm ? charm.charm : null);
				const freePoints = freeSlots.reduce((sum, s) => sum + s, 0) + weapon.freeSlots.reduce((sum, s) => sum + s, 0);
				const missingWeaponLevels = weapon.missing.reduce((sum, m) => sum + m.levels, 0);
				const bonusUsed = (setShort ? 1 : 0) + (groupShort ? 1 : 0);
				const score =
					freePoints * SCORE_PER_FREE_SLOT_LEVEL +
					defense * SCORE_PER_DEFENSE -
					bonusUsed * SCORE_PENALTY_WEAPON_BONUS -
					missingWeaponLevels * SCORE_PENALTY_MISSING_WEAPON_LEVEL;
				if (!best || score > best.score) {
					best = { charm: charm, jewels: jewels, freeSlots: freeSlots, weapon: weapon, score: score };
				}
			}
			if (!best) {
				return;
			}

			addResult({
				pieces: chosen.map((o) => o.piece),
				charm: best.charm ? best.charm.charm : null,
				jewels: countJewels(best.jewels),
				freeSlots: best.freeSlots, // free armor slots, including the charm's
				weapon: best.weapon, // weapon jewels, missing weapon skills and free weapon slots
				freeWeaponSlots: best.weapon.freeSlots,
				weaponBonus: { set: setShort, group: groupShort },
				defense: defense,
				score: best.score,
			});
		}

		function addResult(result) {
			if (results.length >= maxResults && result.score <= results[results.length - 1].score) {
				return;
			}
			results.push(result);
			results.sort((a, b) => b.score - a.score);
			if (results.length > maxResults) {
				results.pop();
			}
		}

		function search(depth) {
			if (timedOut) {
				return;
			}
			// Looking at the clock is slow-ish, so only do it now and then.
			if (setsChecked % 2000 === 0 && Date.now() - started > timeLimit) {
				timedOut = true;
				return;
			}
			if (depth === ARMOR_KINDS.length) {
				checkFullSet();
				return;
			}
			if (!canStillReachGoal(depth)) {
				return;
			}
			for (const option of optionsByKind[depth]) {
				chosen.push(option);
				for (let i = 0; i < goals.length; i++) {
					current[i] += option.gives[i];
				}
				search(depth + 1);
				for (let i = 0; i < goals.length; i++) {
					current[i] -= option.gives[i];
				}
				chosen.pop();
				if (timedOut) {
					return;
				}
			}
		}

		search(0);

		return {
			results: results,
			// The weapon answer when no set is found (each set also carries its own).
			weapon: weaponFor(forcedCharm),
			timedOut: timedOut,
			setsChecked: setsChecked,
			milliseconds: Date.now() - started,
			optionCounts: optionsByKind.map((o) => o.length),
		};
	}

	// Adds up every skill a finished build gives (armor, charm, jewels, set pieces,
	// weapon jewels and weapon bonus). Returns [{ skill, level, pieces? }].
	function totalSkills(index, result, weapon) {
		// Each set carries its own weapon answer (it can depend on the charm).
		weapon = weapon || result.weapon;
		const levels = new Map();
		const pieceCounts = new Map();

		function addLevels(skillPairs, times) {
			for (const pair of skillPairs) {
				const skill = index.skillById.get(pair[0]);
				if (!skill) {
					continue;
				}
				if (isPieceCountSkill(skill)) {
					pieceCounts.set(skill.id, (pieceCounts.get(skill.id) || 0) + times);
				} else {
					levels.set(skill.id, (levels.get(skill.id) || 0) + pair[1] * times);
				}
			}
		}

		for (const piece of result.pieces) {
			addLevels(piece.skills, 1);
		}
		if (result.charm) {
			addLevels(result.charm.skills, 1);
		}
		for (const entry of result.jewels) {
			addLevels(entry.deco.skills, entry.count);
		}
		if (weapon) {
			for (const entry of weapon.jewels) {
				addLevels(entry.deco.skills, entry.count);
			}
		}
		for (const skill of [result.weaponBonus.set, result.weaponBonus.group]) {
			if (skill) {
				pieceCounts.set(skill.id, (pieceCounts.get(skill.id) || 0) + 1);
			}
		}

		const list = [];
		for (const [id, level] of levels) {
			const skill = index.skillById.get(id);
			list.push({ skill: skill, level: Math.min(level, maxLevel(skill)) });
		}
		for (const [id, count] of pieceCounts) {
			const skill = index.skillById.get(id);
			// Which bonus step do this many pieces unlock? 0 means none yet.
			let level = 0;
			for (const rank of skill.ranks) {
				if (count >= rank.pieces) {
					level = rank.level;
				}
			}
			list.push({ skill: skill, level: level, pieces: count });
		}
		return list;
	}

	const api = {
		ARMOR_KINDS: ARMOR_KINDS,
		makeIndex: makeIndex,
		findSets: findSets,
		totalSkills: totalSkills,
		fitJewels: fitJewels,
		piecesNeeded: piecesNeeded,
		isPieceCountSkill: isPieceCountSkill,
		maxLevel: maxLevel,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	} else {
		root.WildsSolver = api;
	}
})(typeof window !== "undefined" ? window : globalThis);
