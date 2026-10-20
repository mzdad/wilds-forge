// Damage numbers for a finished set, and "smart jewel" picks for its free slots.
// Works in the browser (window.WildsStats) and in Node (for tests).
//
// The damage estimate is the usual Monster Hunter rule of thumb for raw damage:
//   attack     = weapon attack × (1 + attack%) + flat attack
//   crit bonus = 1 + affinity × crit damage   (a normal crit hits 25% harder)
//   damage     = attack × crit bonus
// Element damage and skills without exact numbers (Burst, Guts ...) are not included.

(function (root) {
	"use strict";

	const BASE_CRIT_DAMAGE = 25; // a normal critical hit does 25% more damage
	const FEEBLE_HIT_DAMAGE = -25; // with negative affinity, "feeble" hits do 25% less
	// Used to weigh flat attack (+20) against percent attack (+10%) when you have not
	// entered your weapon's attack. 200 is about what an endgame weapon has.
	const TYPICAL_WEAPON_ATTACK = 200;
	// Jewels that add less damage than this are not worth suggesting.
	const SMALLEST_USEFUL_GAIN = 0.0005;

	// Adds up every active skill part. levels is a Map of skillId -> level.
	// situationsOn is a Set of situation ids. Returns totals plus one line per part.
	// weaponAttack is optional: without it a typical endgame weapon is assumed.
	function computeStats(index, effects, levels, situationsOn, weaponAffinity, weaponAttack) {
		const baseAttack = weaponAttack > 0 ? weaponAttack : TYPICAL_WEAPON_ATTACK;
		const stats = {
			attack: 0,
			attackPct: 0,
			affinity: weaponAffinity || 0,
			critDamage: BASE_CRIT_DAMAGE,
			lines: [],
			uncounted: [],
		};

		for (const [skillId, level] of levels) {
			if (level <= 0) {
				continue;
			}
			const skill = index.skillById.get(skillId);
			const parts = effects.skills[skill.name];
			if (!parts) {
				if (effects.notCounted.includes(skill.name)) {
					stats.uncounted.push(skill);
				}
				continue;
			}
			for (const part of parts) {
				const line = {
					skill: skill,
					level: level,
					when: part.when,
					active: part.when === "always" || situationsOn.has(part.when),
					attack: valueAt(part.attack, level),
					attackPct: valueAt(part.attackPct, level),
					affinity: valueAt(part.affinity, level),
					critDamage: valueAt(part.critDamage, level),
				};
				stats.lines.push(line);
				if (!line.active) {
					continue;
				}
				stats.attack += line.attack;
				stats.attackPct += line.attackPct;
				stats.affinity += line.affinity;
				// Crit damage is "raised to" a value, so take the highest, do not add.
				stats.critDamage = Math.max(stats.critDamage, line.critDamage);
			}
		}

		stats.affinityShown = Math.max(-100, Math.min(100, stats.affinity));
		stats.weaponAttack = baseAttack;
		stats.weaponAttackKnown = weaponAttack > 0;
		// Your attack in a fight: weapon attack raised by the % skills, plus the flat ones.
		stats.totalAttack = Math.round(baseAttack * (1 + stats.attackPct / 100) + stats.attack);
		stats.damageGain = damageOf(stats, baseAttack) / damageOf({ attack: 0, attackPct: 0, affinity: weaponAffinity || 0, critDamage: BASE_CRIT_DAMAGE }, baseAttack) - 1;
		return stats;
	}

	// The level-th number of a list (levels start at 1). Missing means 0.
	function valueAt(list, level) {
		if (!list || list.length === 0) {
			return 0;
		}
		return list[Math.min(level, list.length) - 1] || 0;
	}

	function damageOf(totals, baseAttack) {
		const attack = baseAttack * (1 + totals.attackPct / 100) + totals.attack;
		const affinity = Math.max(-100, Math.min(100, totals.affinity)) / 100;
		const critBonus = affinity >= 0
			? 1 + affinity * (totals.critDamage / 100)
			: 1 + -affinity * (FEEBLE_HIT_DAMAGE / 100);
		return attack * critBonus;
	}

	// Adds a jewel's skills to a copy of the levels, never past a skill's max level.
	function withJewel(index, levels, deco) {
		const next = new Map(levels);
		for (const pair of deco.skills) {
			const skill = index.skillById.get(pair[0]);
			const max = skill ? skill.ranks.length : pair[1];
			next.set(pair[0], Math.min(max, (next.get(pair[0]) || 0) + pair[1]));
		}
		return next;
	}

	// Fills free slots one jewel at a time, each time taking the jewel that adds the
	// most damage right now, and putting it in the smallest free slot it fits.
	// Armor jewels go in armor slots, weapon jewels in weapon slots.
	function suggestJewels(index, effects, levels, freeArmorSlots, freeWeaponSlots, situationsOn, weaponAffinity, weaponAttack) {
		const free = { armor: freeArmorSlots.slice(), weapon: freeWeaponSlots.slice() };
		const candidates = index.data.decorations.filter((deco) =>
			deco.skills.some((pair) => {
				const skill = index.skillById.get(pair[0]);
				return skill && effects.skills[skill.name];
			}));

		let current = new Map(levels);
		let currentDamage = computeStats(index, effects, current, situationsOn, weaponAffinity, weaponAttack).damageGain;
		const picks = [];

		while (true) {
			let best = null;
			for (const deco of candidates) {
				const slots = free[deco.kind];
				if (!slots || !slots.some((s) => s >= deco.slot)) {
					continue;
				}
				const next = withJewel(index, current, deco);
				const gain = computeStats(index, effects, next, situationsOn, weaponAffinity, weaponAttack).damageGain - currentDamage;
				const better = !best ||
					gain > best.gain + 1e-9 ||
					// Same gain: the smaller jewel leaves bigger slots for later.
					(Math.abs(gain - best.gain) <= 1e-9 && deco.slot < best.deco.slot);
				if (better) {
					best = { deco: deco, gain: gain, next: next };
				}
			}
			if (!best || best.gain < SMALLEST_USEFUL_GAIN) {
				break;
			}
			const slots = free[best.deco.kind];
			let at = -1;
			for (let i = 0; i < slots.length; i++) {
				if (slots[i] >= best.deco.slot && (at === -1 || slots[i] < slots[at])) {
					at = i;
				}
			}
			slots.splice(at, 1);
			picks.push({ deco: best.deco, gain: best.gain, levelsBefore: current, levelsAfter: best.next });
			current = best.next;
			currentDamage += best.gain;
		}

		return {
			picks: groupPicks(picks),
			levels: current,
			stats: computeStats(index, effects, current, situationsOn, weaponAffinity, weaponAttack),
			leftArmorSlots: free.armor.sort((a, b) => b - a),
			leftWeaponSlots: free.weapon.sort((a, b) => b - a),
		};
	}

	// "Tenderizer Jewel x2" instead of two separate rows. Keeps the from/to levels.
	function groupPicks(picks) {
		const grouped = [];
		for (const pick of picks) {
			let entry = grouped.find((g) => g.deco.id === pick.deco.id);
			if (!entry) {
				entry = { deco: pick.deco, count: 0, gain: 0, from: new Map(), to: new Map() };
				for (const pair of pick.deco.skills) {
					entry.from.set(pair[0], pick.levelsBefore.get(pair[0]) || 0);
				}
				grouped.push(entry);
			}
			entry.count += 1;
			entry.gain += pick.gain;
			for (const pair of pick.deco.skills) {
				entry.to.set(pair[0], pick.levelsAfter.get(pair[0]) || 0);
			}
		}
		return grouped;
	}

	// Which situations matter for these skill levels (so the page only shows useful switches).
	function situationsUsed(index, effects, levels) {
		const used = new Set();
		for (const [skillId, level] of levels) {
			if (level <= 0) {
				continue;
			}
			const skill = index.skillById.get(skillId);
			for (const part of effects.skills[skill.name] || []) {
				if (part.when !== "always") {
					used.add(part.when);
				}
			}
		}
		return used;
	}

	const api = {
		BASE_CRIT_DAMAGE: BASE_CRIT_DAMAGE,
		TYPICAL_WEAPON_ATTACK: TYPICAL_WEAPON_ATTACK,
		computeStats: computeStats,
		suggestJewels: suggestJewels,
		situationsUsed: situationsUsed,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	} else {
		root.WildsStats = api;
	}
})(typeof window !== "undefined" ? window : globalThis);
