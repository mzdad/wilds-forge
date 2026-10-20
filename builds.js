// Popular builds: what players are running right now, one per weapon.
// Taken from Game8's "best build for each weapon" list (checked October 2026).
// Only the skill goals are stored here. Pressing "Use these skills" on the page
// hands them to the set finder, which works out the armor itself.
//
// To add a build: copy one entry and change it. Skill names must match the game
// exactly (the page warns about any it cannot find). For set bonuses and group
// skills, the number is the bonus step: 1 = the 2-piece bonus, 2 = the 4-piece bonus.

window.WILDS_POPULAR = {
	checked: "October 2026",
	sources: [
		{ name: "Game8: best builds for each weapon", url: "https://game8.co/games/Monster-Hunter-Wilds/archives/500759" },
		{ name: "MH Wilds Best Builds", url: "https://www.mhwildsbuild.com/builds" },
		{ name: "Mobalytics community builds", url: "https://mobalytics.gg/mhw/community-builds" },
	],
	builds: [
		{
			weapon: "Great Sword",
			name: "Bale-Dahaad Gore GS",
			skills: [
				["Gore Magala's Tyranny", 1], ["Jin Dahaad's Revolt", 1], ["Soul of the Dark Knight", 1], ["Lord's Soul", 1],
				["Critical Boost", 5], ["Agitator", 5], ["Focus", 3], ["Maximum Might", 3], ["Counterstrike", 3],
			],
		},
		{
			weapon: "Long Sword",
			name: "Fulgur-Lagi Guts LS",
			skills: [
				["Fulgur Anjanath's Will", 1], ["Leviathan's Fury", 1], ["Lord's Soul", 1],
				["Critical Boost", 5], ["Agitator", 5], ["Weakness Exploit", 5], ["Attack Boost", 4], ["Maximum Might", 3],
			],
		},
		{
			weapon: "Sword & Shield",
			name: "Gog-Guts Elemental SnS",
			skills: [
				["Gogmapocalypse", 2], ["Lord's Soul", 1],
				["Agitator", 5], ["Weakness Exploit", 5], ["Peak Performance", 5], ["Critical Boost", 3], ["Fire Attack", 3],
			],
		},
		{
			weapon: "Dual Blades",
			name: "Arkveld Gammapocalypse DB",
			skills: [
				["Gogmapocalypse", 2], ["Arkveld's Hunger", 1], ["Lord's Soul", 1],
				["Agitator", 5], ["Weakness Exploit", 5], ["Dragon Attack", 3], ["Focus", 3], ["Power Prolonger", 3],
			],
		},
		{
			weapon: "Hammer",
			name: "Dosha-Gogma Guts Hammer",
			skills: [
				["Gogmapocalypse", 1], ["Fulgur Anjanath's Will", 1], ["Doshaguma's Might", 1], ["Lord's Soul", 1],
				["Attack Boost", 5], ["Agitator", 5], ["Weakness Exploit", 5], ["Critical Boost", 3], ["Charge Up", 1],
			],
		},
		{
			weapon: "Hunting Horn",
			name: "Agi-Burst Gogma II HH",
			skills: [
				["Gogmapocalypse", 2], ["Lord's Soul", 1],
				["Attack Boost", 5], ["Agitator", 5], ["Burst", 5], ["Dragon Attack", 3], ["Mind's Eye", 3],
			],
		},
		{
			weapon: "Lance",
			name: "Agi-WEX-Flayer Lance",
			skills: [
				["Arkveld's Hunger", 2], ["Gore Magala's Tyranny", 1], ["Lord's Soul", 1],
				["Agitator", 5], ["Flayer", 5], ["Weakness Exploit", 5], ["Critical Boost", 3], ["Guard Up", 3],
			],
		},
		{
			weapon: "Gunlance",
			name: "Max Burst Boost Dahaad Guts GL",
			skills: [
				["Ebony Odogaron's Power", 2], ["Jin Dahaad's Revolt", 1], ["Lord's Soul", 1],
				["Agitator", 5], ["Burst", 5], ["Offensive Guard", 3], ["Artillery", 3], ["Counterstrike", 3],
			],
		},
		{
			weapon: "Switch Axe",
			name: "Arkveld Gamma WEX-Agi SA",
			skills: [
				["Arkveld's Hunger", 2], ["Leviathan's Fury", 1], ["Lord's Soul", 1],
				["Agitator", 5], ["Weakness Exploit", 5], ["Flayer", 4], ["Power Prolonger", 3], ["Razor Sharp", 3],
			],
		},
		{
			weapon: "Charge Blade",
			name: "Gog Magala Elemental CB",
			skills: [
				["Gogmapocalypse", 2], ["Gore Magala's Tyranny", 1],
				["Burst", 5], ["Dragon Attack", 3], ["Power Prolonger", 3], ["Antivirus", 3], ["Coalescence", 3],
			],
		},
		{
			weapon: "Insect Glaive",
			name: "Arkveld-Gore Affinity IG",
			skills: [
				["Arkveld's Hunger", 1], ["Gore Magala's Tyranny", 1], ["Fulgur Anjanath's Will", 1], ["Lord's Soul", 1],
				["Agitator", 5], ["Weakness Exploit", 5], ["Critical Boost", 3], ["Antivirus", 3], ["Counterstrike", 3],
			],
		},
		{
			weapon: "Bow",
			name: "Gogma Gore Bow",
			skills: [
				["Gogmapocalypse", 1], ["Gore Magala's Tyranny", 1], ["Lord's Soul", 1],
				["Agitator", 5], ["Critical Boost", 3], ["Tetrad Shot", 3], ["Dragon Attack", 3], ["Counterstrike", 3],
			],
		},
		{
			weapon: "Light Bowgun",
			name: "Gogma Guts Elemental LBG",
			skills: [
				["Gogmapocalypse", 2], ["Lord's Soul", 1],
				["Attack Boost", 4], ["Agitator", 5], ["Peak Performance", 5], ["Critical Element", 3], ["Fire Attack", 3],
			],
		},
	],
};
