// What skills do to your numbers: attack, affinity (crit chance) and crit damage.
// Copied from the in-game skill text (see data.js). tools/test-stats.js checks every
// number here against that text, so a game update that changes a value gets caught.
//
// Each skill has one or more parts. A part says WHEN it works (a situation id from the
// list below, or "always") and what it adds at each level (first number = level 1).
//   attack     flat attack, e.g. Agitator "Attack +20"
//   attackPct  percent attack, e.g. Heroics "Attack +30%"
//   affinity   percent affinity (chance to crit)
//   critDamage how hard a crit hits, e.g. Critical Boost "to 40%" (normal is 25%)
// For set bonuses and group skills the levels are the bonus steps (2 pieces, 4 pieces).
//
// Skills that only say "increases attack" without a number (Burst, Lord's Soul ...)
// are left out on purpose. The page lists them as "not in the numbers".

window.WILDS_EFFECTS = {
	// The order here is the order the switches appear on the page.
	// "excludes" lists situations that cannot be true at the same time; switching
	// this one on switches those off.
	situations: [
		{ id: "weak", label: "Hitting a weak point" },
		{ id: "wound", label: "Hitting a wound (adds to weak point)" },
		{ id: "enraged", label: "Monster is enraged" },
		{ id: "fullStamina", label: "Stamina stays full" },
		{ id: "fullHealth", label: "Health is full", excludes: ["lowHealth", "redHealth"] },
		{ id: "latent", label: "Latent Power is on" },
		{ id: "lowHealth", label: "Health 35% or lower", excludes: ["fullHealth"] },
		{ id: "redHealth", label: "Red health on your bar", excludes: ["fullHealth"] },
		{ id: "knockedBack", label: "Just got knocked back" },
		{ id: "perfectEvade", label: "After a perfect evade" },
		{ id: "perfectGuard", label: "After a perfect guard" },
		{ id: "poisonPara", label: "Monster poisoned or paralyzed" },
		{ id: "cured", label: "Cured the Frenzy" },
		{ id: "sneakAttack", label: "After a sneak attack" },
		{ id: "powerClash", label: "After a Power Clash" },
		{ id: "burst", label: "Burst is on" },
		{ id: "ateSteak", label: "Ate a steak" },
		{ id: "hardParts", label: "Hitting hard parts" },
		{ id: "drawAttack", label: "Draw attacks" },
		{ id: "wet", label: "You are wet" },
		{ id: "jumping", label: "Jumping attacks" },
	],

	// Situations switched on for a first visit. Most fights have both.
	defaultSituations: ["weak", "enraged"],

	// Switches always on screen, so the smart jewels can try these common skills
	// even when no wished skill uses them. Other switches appear when a skill needs them.
	alwaysShown: ["weak", "enraged", "fullHealth", "fullStamina", "latent"],

	// Skills that do raise damage, but the game gives no exact number, the boost
	// depends on the weapon, or it is element damage. The page names them so you
	// know they are missing from the numbers.
	notCounted: [
		"Burst", "Lord's Soul", "Gore Magala's Tyranny", "Jin Dahaad's Revolt", "Leviathan's Fury",
		"Gogmapocalypse", "Omega Resonance", "Rathalos's Flare", "Whiteflame Torrent", "Lord's Fury",
		"Fortifying Pelt", "Lord's Favor", "Buttery Leathercraft", "Self-Improvement", "Flayer",
		"Coalescence", "Convert Element", "Critical Element", "Critical Status", "Charge Up",
		"Rapid Morph", "Artillery", "Tetrad Shot", "Opening Shot", "Normal Shots", "Piercing Shots",
		"Spread/Power Shots", "Ballistics", "Seregios's Tenacity", "Darkside", "Synergy",
		"Fire Attack", "Water Attack", "Thunder Attack", "Ice Attack", "Dragon Attack",
	],

	skills: {
		"Attack Boost": [{ when: "always", attack: [3, 5, 7, 8, 9], attackPct: [0, 0, 0, 2, 4] }],
		"Critical Eye": [{ when: "always", affinity: [4, 8, 12, 16, 20] }],
		"Critical Boost": [{ when: "always", critDamage: [28, 31, 34, 37, 40] }],
		"Weakness Exploit": [
			{ when: "weak", affinity: [5, 10, 15, 20, 30] },
			{ when: "wound", affinity: [3, 5, 10, 15, 20] },
		],
		"Agitator": [{ when: "enraged", attack: [4, 8, 12, 16, 20], affinity: [3, 5, 7, 10, 15] }],
		"Maximum Might": [{ when: "fullStamina", affinity: [10, 20, 30] }],
		"Peak Performance": [{ when: "fullHealth", attack: [3, 6, 10, 15, 20] }],
		"Latent Power": [{ when: "latent", affinity: [10, 20, 30, 40, 50] }],
		"Heroics": [{ when: "lowHealth", attackPct: [0, 5, 5, 10, 30] }],
		"Resentment": [{ when: "redHealth", attack: [5, 10, 15, 20, 25] }],
		"Counterstrike": [{ when: "knockedBack", attack: [10, 15, 25] }],
		"Adrenaline Rush": [{ when: "perfectEvade", attack: [10, 15, 20, 25, 30] }],
		"Offensive Guard": [{ when: "perfectGuard", attackPct: [5, 10, 15] }],
		"Foray": [{ when: "poisonPara", attack: [6, 8, 10, 12, 15], affinity: [0, 5, 10, 15, 20] }],
		"Antivirus": [{ when: "cured", affinity: [3, 6, 10] }],
		"Ambush": [{ when: "sneakAttack", attackPct: [5, 10, 15] }],
		"Doshaguma's Might": [{ when: "powerClash", attack: [10, 25] }],
		"Ebony Odogaron's Power": [{ when: "burst", attack: [8, 18] }],
		"Xu Wu's Vigor": [{ when: "ateSteak", attack: [15, 30] }],
		"Mind's Eye": [{ when: "hardParts", attackPct: [10, 15, 30] }],
		"Critical Draw": [{ when: "drawAttack", affinity: [50, 75, 100] }],
		"Punishing Draw": [{ when: "drawAttack", attack: [3, 5, 7] }],
		"Slicked Blade": [{ when: "wet", affinity: [3, 6, 9] }],
		"Airborne": [{ when: "jumping", attackPct: [10] }],
	},
};
