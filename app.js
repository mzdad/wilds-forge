// The page: wish list on the left, found sets on the right, popular builds on a second tab.
// All the searching happens in solver.js; this file only shows things and reacts to clicks.

(function () {
	"use strict";

	const data = window.WILDS_DATA;
	const popular = window.WILDS_POPULAR;
	const effects = window.WILDS_EFFECTS;
	const Solver = window.WildsSolver;
	const Stats = window.WildsStats;
	const Share = window.WildsShare;
	const index = Solver.makeIndex(data);
	const SITUATION_LABEL = Object.fromEntries(effects.situations.map((s) => [s.id, s.label]));

	const STORAGE_KEY = "wilds-build-forge-v1";
	const SUGGESTION_LIMIT = 8;
	const ARMOR_PIECES_SHOWN = 8;
	// Wait this long after the last click before searching, so fast clicking stays smooth.
	const SEARCH_DELAY_MS = 120;

	const QUICK_PICKS = ["Heroics", "Weakness Exploit", "Agitator", "Lord's Soul", "Burst", "Critical Boost", "Divine Blessing"];
	const WEAPON_TYPES = [
		"Great Sword", "Long Sword", "Sword & Shield", "Dual Blades", "Hammer", "Hunting Horn", "Lance",
		"Gunlance", "Switch Axe", "Charge Blade", "Insect Glaive", "Bow", "Light Bowgun", "Heavy Bowgun",
	];
	const ELEMENTS = ["None", "Fire", "Water", "Thunder", "Ice", "Dragon", "Poison", "Paralysis", "Sleep", "Blast"];
	const KIND_LABEL = { armor: "Armor skill", weapon: "Weapon skill", set: "Set bonus", group: "Group skill" };
	const PIECE_LABEL = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };

	// Everything the page remembers. Saved in this browser only.
	const state = {
		tab: "build",
		targets: [], // [{ skillId, level }]
		weaponSlots: [3, 3, 3],
		gogmaWeapon: true,
		weaponAffinity: 0, // the weapon's own affinity in %, added to the skills
		// Charms you own (appraised ones have their own skills and slots):
		// { id, name, rarity, skills: [[skillId, level]], armorSlots, weaponSlots, buildAround }
		myCharms: [],
		// Your Gogma Artian weapon. Only used while "I have a Gogma Artian weapon" is ticked.
		gogma: defaultGogma(),
		situations: effects.defaultSituations.slice(), // fight situations switched on
		openInfo: null, // skill id whose "where to get it" is open
	};

	// ---------- Small helpers ----------

	function el(tag, attributes, children) {
		const node = document.createElement(tag);
		for (const key in attributes || {}) {
			const value = attributes[key];
			if (value === null || value === undefined || value === false) {
				continue;
			}
			if (key === "class") {
				node.className = value;
			} else if (key === "text") {
				node.textContent = value;
			} else if (key.startsWith("on")) {
				node.addEventListener(key.slice(2), value);
			} else {
				node.setAttribute(key, value === true ? "" : value);
			}
		}
		for (const child of [].concat(children || [])) {
			if (child === null || child === undefined || child === false) {
				continue;
			}
			node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
		}
		return node;
	}

	function skillByName(name) {
		const wanted = name.toLowerCase();
		return data.skills.find((s) => s.name.toLowerCase() === wanted) || null;
	}

	function kindTag(skill) {
		return el("span", { class: "kind " + skill.kind, text: KIND_LABEL[skill.kind] });
	}

	// Round badges are armor slots. With kind "weapon" they are square, like weapon slots.
	function slotBadges(slots, kind) {
		const weapon = kind === "weapon";
		const shown = slots.length ? slots : [];
		const what = weapon ? "Weapon slots " : "Jewel slots ";
		return el("span", { class: "slots", "aria-label": shown.length ? what + shown.join(", ") : "No jewel slots" },
			shown.length
				? shown.map((s) => el("span", { class: "slot s" + s + (weapon ? " weapon" : ""), text: String(s) }))
				: [el("span", { class: "slot none", text: "–" })]);
	}

	// Armor badges, then weapon badges, side by side. Used where both kinds can be free.
	function mixedSlotBadges(armorSlots, weaponSlots) {
		const parts = [];
		if (armorSlots.length) {
			parts.push(slotBadges(armorSlots));
		}
		if (weaponSlots.length) {
			parts.push(slotBadges(weaponSlots, "weapon"));
		}
		return el("span", { class: "slot-groups" }, parts.length ? parts : [slotBadges([])]);
	}

	function staticPips(level, max) {
		const pips = [];
		for (let i = 1; i <= max; i++) {
			pips.push(el("span", { class: "pip" + (i <= level ? " on" : "") }));
		}
		return el("span", { class: "pips static", "aria-hidden": "true" }, pips);
	}

	// "Black Eclipse I (2 pieces)" for set bonuses, "Level 3 of 5" for normal skills.
	function levelText(skill, level) {
		const rank = skill.ranks.find((r) => r.level === level);
		if (Solver.isPieceCountSkill(skill)) {
			return rank ? rank.name + " · " + rank.pieces + " pieces" : "";
		}
		return "Level " + level + " of " + Solver.maxLevel(skill) + (rank ? ": " + rank.desc : "");
	}

	// ---------- Saving and loading ----------

	function save() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({
				tab: state.tab,
				targets: state.targets,
				weaponSlots: state.weaponSlots,
				gogmaWeapon: state.gogmaWeapon,
				weaponAffinity: state.weaponAffinity,
				situations: state.situations,
				myCharms: state.myCharms,
				gogma: state.gogma,
			}));
		} catch (error) {
			// Storage can be blocked (private window). The page still works, it just forgets.
		}
	}

	function load() {
		let saved = null;
		try {
			saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
		} catch (error) {
			saved = null;
		}
		if (saved && Array.isArray(saved.targets)) {
			state.tab = ["build", "saved", "popular"].includes(saved.tab) ? saved.tab : "build";
			state.targets = saved.targets.filter((t) => index.skillById.has(t.skillId));
			state.weaponSlots = Array.isArray(saved.weaponSlots) ? saved.weaponSlots : [3, 3, 3];
			state.gogmaWeapon = saved.gogmaWeapon !== false;
			state.weaponAffinity = Number(saved.weaponAffinity) || 0;
			state.gogma = cleanGogma(saved.gogma);
			if (Array.isArray(saved.myCharms)) {
				state.myCharms = saved.myCharms.map(cleanCharm).filter(Boolean);
			}
			if (Array.isArray(saved.situations)) {
				state.situations = saved.situations.filter((id) => SITUATION_LABEL[id]);
			} else {
				// Saved by version 1.0, before situations existed: switch on what the wished skills need.
				for (const target of state.targets) {
					switchOnSituationFor(index.skillById.get(target.skillId));
				}
			}
		} else {
			// First visit: start with the example from the original idea.
			const heroics = skillByName("Heroics");
			if (heroics) {
				state.targets = [{ skillId: heroics.id, level: Solver.maxLevel(heroics) }];
				switchOnSituationFor(heroics);
			}
		}
	}

	// setId / groupId null means "Any": the forge may pick whichever helps.
	function defaultGogma() {
		return { type: "", element: "None", attack: 0, affinity: 0, setId: null, groupId: null, slots: [3, 3, 3] };
	}

	function clampNumber(value, low, high) {
		const n = Number(value);
		return Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : 0;
	}

	function cleanGogma(saved) {
		if (!saved || typeof saved !== "object") {
			return defaultGogma();
		}
		const skillOfKind = (id, kind) => {
			const skill = index.skillById.get(Number(id));
			return skill && skill.kind === kind ? skill.id : null;
		};
		return {
			type: WEAPON_TYPES.includes(saved.type) ? saved.type : "",
			element: ELEMENTS.includes(saved.element) ? saved.element : "None",
			attack: clampNumber(saved.attack, 0, 999),
			affinity: clampNumber(saved.affinity, -100, 100),
			setId: skillOfKind(saved.setId, "set"),
			groupId: skillOfKind(saved.groupId, "group"),
			slots: Array.isArray(saved.slots)
				? saved.slots.map(Number).filter((s) => s >= 1 && s <= 3).sort((a, b) => b - a)
				: [3, 3, 3],
		};
	}

	// While the Gogma box is ticked, your Gogma weapon's slots, affinity and attack count.
	// Otherwise the plain "Weapon jewel slots" and "Weapon affinity" fields do.
	function weaponSlotsNow() {
		return state.gogmaWeapon ? state.gogma.slots : state.weaponSlots;
	}

	function weaponAffinityNow() {
		return state.gogmaWeapon ? state.gogma.affinity : state.weaponAffinity;
	}

	function weaponAttackNow() {
		return state.gogmaWeapon ? state.gogma.attack : 0; // 0 = not known, assume a typical weapon
	}

	// A saved charm could be from an older page or hand-edited storage, so only keep
	// what makes sense: known skills, slot sizes 1 to 3.
	function cleanCharm(charm) {
		if (!charm || typeof charm.id !== "string") {
			return null;
		}
		const sizes = (list) => (Array.isArray(list) ? list : []).map(Number).filter((s) => s >= 1 && s <= 3).sort((a, b) => b - a);
		return {
			id: charm.id,
			name: String(charm.name || "My charm").slice(0, 40),
			rarity: Math.max(1, Math.min(8, Number(charm.rarity) || 8)),
			skills: (Array.isArray(charm.skills) ? charm.skills : [])
				.filter((pair) => Array.isArray(pair) && index.skillById.has(pair[0]))
				.map((pair) => [pair[0], Math.max(1, Math.min(Solver.maxLevel(index.skillById.get(pair[0])), Number(pair[1]) || 1))]),
			armorSlots: sizes(charm.armorSlots),
			weaponSlots: sizes(charm.weaponSlots),
			buildAround: !!charm.buildAround,
		};
	}

	// ---------- Changing the wish list ----------

	function defaultLevel(skill) {
		// Set bonuses start at the 2-piece step; normal skills at their highest level.
		return Solver.isPieceCountSkill(skill) ? 1 : Solver.maxLevel(skill);
	}

	function addSkill(skill) {
		if (!state.targets.some((t) => t.skillId === skill.id)) {
			state.targets.push({ skillId: skill.id, level: defaultLevel(skill) });
		}
		switchOnSituationFor(skill);
		changed();
	}

	// Wanting Heroics means you plan to fight at low health, so show the numbers for that.
	// Only the skill's main situation is switched on (for Weakness Exploit: weak points, not wounds).
	function switchOnSituationFor(skill) {
		const parts = effects.skills[skill.name];
		if (!parts || parts[0].when === "always") {
			return;
		}
		switchSituationOn(parts[0].when);
	}

	// Some situations cannot happen together (full health and low health), so switching
	// one on switches the others off.
	function switchSituationOn(id) {
		const situation = effects.situations.find((s) => s.id === id);
		const excludes = (situation && situation.excludes) || [];
		state.situations = state.situations.filter((other) => !excludes.includes(other) && other !== id);
		state.situations.push(id);
	}

	function removeSkill(skillId) {
		state.targets = state.targets.filter((t) => t.skillId !== skillId);
		if (state.openInfo === skillId) {
			state.openInfo = null;
		}
		changed();
	}

	function setLevel(skillId, level) {
		const target = state.targets.find((t) => t.skillId === skillId);
		if (target) {
			target.level = level;
		}
		changed();
	}

	function changed() {
		save();
		renderWishes();
		renderQuickPicks();
		renderOnlineLinks();
		scheduleSearch();
	}

	// ---------- Step 1: search box ----------

	const searchInput = document.getElementById("skill-search");
	const suggestionList = document.getElementById("suggestions");
	let suggestionItems = [];
	let activeSuggestion = 0;

	function findSkills(query) {
		const q = query.trim().toLowerCase();
		if (!q) {
			return [];
		}
		const chosen = new Set(state.targets.map((t) => t.skillId));
		const matches = [];
		for (const skill of data.skills) {
			if (chosen.has(skill.id)) {
				continue;
			}
			const name = skill.name.toLowerCase();
			// Set bonuses are often known by their effect name ("Guts", "Black Eclipse"), so search those too.
			const rankNames = skill.ranks.map((r) => (r.name || "").toLowerCase()).join(" ");
			let score = -1;
			if (name.startsWith(q)) {
				score = 3;
			} else if (name.includes(q)) {
				score = 2;
			} else if (rankNames.includes(q)) {
				score = 1;
			}
			if (score >= 0) {
				matches.push({ skill: skill, score: score });
			}
		}
		matches.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
		return matches.slice(0, SUGGESTION_LIMIT).map((m) => m.skill);
	}

	function subtitleFor(skill) {
		if (Solver.isPieceCountSkill(skill)) {
			return KIND_LABEL[skill.kind] + " · " + skill.ranks.map((r) => r.name).join(" / ");
		}
		return KIND_LABEL[skill.kind] + " · " + (skill.desc || "");
	}

	function renderSuggestions() {
		suggestionItems = findSkills(searchInput.value);
		suggestionList.replaceChildren();
		if (suggestionItems.length === 0) {
			suggestionList.hidden = !searchInput.value.trim();
			if (searchInput.value.trim()) {
				suggestionList.appendChild(el("li", {}, el("button", { type: "button", disabled: true }, [
					el("span", { text: "No skill with that name" }),
					el("span", { class: "sub", text: "Try part of the name, like \"crit\" or \"guts\"." }),
				])));
			}
			return;
		}
		activeSuggestion = Math.min(activeSuggestion, suggestionItems.length - 1);
		suggestionItems.forEach((skill, i) => {
			suggestionList.appendChild(el("li", {}, el("button", {
				type: "button",
				class: i === activeSuggestion ? "active" : "",
				onmousedown: (event) => event.preventDefault(), // keep focus in the box
				onclick: () => pickSuggestion(skill),
			}, [
				el("span", { text: skill.name }),
				el("span", { class: "sub", text: subtitleFor(skill) }),
			])));
		});
		suggestionList.hidden = false;
	}

	function pickSuggestion(skill) {
		searchInput.value = "";
		suggestionList.hidden = true;
		activeSuggestion = 0;
		addSkill(skill);
	}

	searchInput.addEventListener("input", () => {
		activeSuggestion = 0;
		renderSuggestions();
	});
	searchInput.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (suggestionItems.length) {
				const step = event.key === "ArrowDown" ? 1 : -1;
				activeSuggestion = (activeSuggestion + step + suggestionItems.length) % suggestionItems.length;
				renderSuggestions();
			}
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (suggestionItems[activeSuggestion]) {
				pickSuggestion(suggestionItems[activeSuggestion]);
			}
		} else if (event.key === "Escape") {
			suggestionList.hidden = true;
		}
	});
	searchInput.addEventListener("blur", () => {
		suggestionList.hidden = true;
	});
	searchInput.addEventListener("focus", renderSuggestions);

	function renderQuickPicks() {
		const box = document.getElementById("quick-picks");
		box.replaceChildren(el("span", { class: "label", text: "Popular" }));
		const chosen = new Set(state.targets.map((t) => t.skillId));
		for (const name of QUICK_PICKS) {
			const skill = skillByName(name);
			if (!skill || chosen.has(skill.id)) {
				continue;
			}
			// Lord's Soul is the skill most guides call "Guts", so say both.
			const text = name === "Lord's Soul" ? "+ Lord's Soul (Guts)" : "+ " + name;
			box.appendChild(el("button", { type: "button", class: "chip-btn", text: text, onclick: () => addSkill(skill) }));
		}
	}

	// ---------- Step 1: the wish list ----------

	function levelControl(skill, level) {
		if (Solver.isPieceCountSkill(skill)) {
			return el("span", { class: "steps", role: "group", "aria-label": "Bonus step" },
				skill.ranks.map((rank) => el("button", {
					type: "button",
					class: "step " + skill.kind + (rank.level === level ? " on" : ""),
					"aria-pressed": rank.level === level ? "true" : "false",
					text: rank.pieces + " pieces",
					onclick: () => setLevel(skill.id, rank.level),
				})));
		}
		const pips = [];
		for (let i = 1; i <= Solver.maxLevel(skill); i++) {
			pips.push(el("button", {
				type: "button",
				class: "pip" + (i <= level ? " on" : ""),
				"aria-label": "Level " + i,
				"aria-pressed": i <= level ? "true" : "false",
				onclick: () => setLevel(skill.id, i),
			}));
		}
		return el("span", { class: "pips", role: "group", "aria-label": "Skill level" }, pips);
	}

	function renderWishes() {
		const box = document.getElementById("wishes");
		box.replaceChildren();
		if (state.targets.length === 0) {
			box.appendChild(el("p", { class: "muted", text: "No skills yet. Search above or tap one of the suggestions." }));
			return;
		}
		for (const target of state.targets) {
			const skill = index.skillById.get(target.skillId);
			const open = state.openInfo === skill.id;
			box.appendChild(el("div", { class: "wish" }, [
				el("div", { class: "wish-top" }, [
					el("div", { class: "wish-title" }, [
						el("span", { class: "wish-name", text: skill.name }),
						Solver.isPieceCountSkill(skill) ? kindTag(skill) : null,
					]),
					el("button", {
						type: "button", class: "remove", "aria-label": "Remove " + skill.name, text: "×",
						onclick: () => removeSkill(skill.id),
					}),
				]),
				el("div", { class: "level-row" }, [
					levelControl(skill, target.level),
					el("span", { class: "level-text", text: levelText(skill, target.level) }),
				]),
				el("div", {}, el("button", {
					type: "button", class: "linkish", "aria-expanded": open ? "true" : "false",
					text: open ? "Hide where to get it" : "Where to get it",
					onclick: () => {
						state.openInfo = open ? null : skill.id;
						renderWishes();
					},
				})),
				open ? whereToGet(skill) : null,
			]));
		}
	}

	// "Your charms: My charm (level 3)" lines for the where-to-get-it list, or nothing.
	function myCharmsWith(skill) {
		const names = state.myCharms
			.filter((c) => c.skills.some((pair) => pair[0] === skill.id))
			.map((c) => c.name + " (level " + c.skills.find((pair) => pair[0] === skill.id)[1] + ")");
		if (!names.length) {
			return [];
		}
		return [el("span", { class: "label", text: "Your charms" }), el("p", { text: names.join(", ") })];
	}

	// The "where to get it" list: armor pieces, jewels and charms with this skill.
	function whereToGet(skill) {
		const parts = [];

		if (skill.kind === "weapon") {
			const singles = data.decorations.filter((d) => d.kind === "weapon" && d.skills.length === 1 && d.skills[0][0] === skill.id);
			const combos = data.decorations.filter((d) => d.kind === "weapon" && d.skills.length > 1 && d.skills.some((p) => p[0] === skill.id));
			parts.push(el("span", { class: "label", text: "Weapon jewels" }));
			parts.push(singles.length
				? el("ul", {}, singles.sort((a, b) => a.slot - b.slot).map((d) => el("li", {}, el("span", { class: "row" }, [
					d.name, " gives level " + d.skills[0][1], slotBadges([d.slot]),
				]))))
				: el("p", { class: "muted", text: "No single-skill jewel." }));
			if (combos.length) {
				parts.push(el("p", { class: "muted", text: "Also on " + combos.length + " two-skill jewels, such as " + combos.slice(0, 3).map((d) => d.name).join(", ") + "." }));
			}
			parts.push(el("p", { class: "muted", text: "Many weapons also have weapon skills built in." }));
			parts.push(...myCharmsWith(skill));
			return el("div", { class: "where" }, parts);
		}

		const pieces = data.armor
			.filter((p) => p.rank === "high" && p.skills.some((pair) => pair[0] === skill.id))
			.map((p) => ({ piece: p, level: p.skills.find((pair) => pair[0] === skill.id)[1] }))
			.sort((a, b) => b.level - a.level || b.piece.defense - a.piece.defense);

		parts.push(el("span", { class: "label", text: "Armor pieces (high rank) · " + pieces.length }));
		if (pieces.length === 0) {
			parts.push(el("p", { class: "muted", text: "No high rank armor has this skill." }));
		} else {
			const isCount = Solver.isPieceCountSkill(skill);
			const listItems = pieces.slice(0, ARMOR_PIECES_SHOWN).map((entry) => el("li", {}, el("span", { class: "row" }, [
				entry.piece.name,
				el("span", { class: "muted", text: "· " + PIECE_LABEL[entry.piece.kind] + (isCount ? "" : " · level " + entry.level) +
					(effects.wholeSetOnly.includes(entry.piece.set) ? " · whole " + entry.piece.set + " set only" : "") }),
				slotBadges(entry.piece.slots),
			])));
			parts.push(el("ul", {}, listItems));
			if (pieces.length > ARMOR_PIECES_SHOWN) {
				const rest = pieces.slice(ARMOR_PIECES_SHOWN).map((entry) => entry.piece.name + (isCount ? "" : " (" + entry.level + ")") +
					(effects.wholeSetOnly.includes(entry.piece.set) ? " [whole set only]" : ""));
				parts.push(el("details", { class: "more" }, [
					el("summary", { text: "Show " + rest.length + " more" }),
					el("p", { class: "muted", text: rest.join(", ") }),
				]));
			}
		}

		if (!Solver.isPieceCountSkill(skill)) {
			const jewel = index.armorJewelBySkill.get(skill.id);
			parts.push(el("span", { class: "label", text: "Jewel" }));
			parts.push(jewel
				? el("span", { class: "row" }, [jewel.name, " gives 1 level", slotBadges([jewel.slot])])
				: el("p", { class: "muted", text: "No jewel exists. Only armor and charms give this skill." }));

			const charms = data.charms.filter((c) => c.skills.some((pair) => pair[0] === skill.id));
			if (charms.length) {
				parts.push(el("span", { class: "label", text: "Charms" }));
				parts.push(el("p", {}, charms.map((c) => c.name + " (level " + c.skills.find((pair) => pair[0] === skill.id)[1] + ")").join(", ")));
			}
			parts.push(...myCharmsWith(skill));
		} else {
			parts.push(el("p", { class: "muted", text: "Set bonuses and group skills come only from wearing enough pieces. A Gogma Artian weapon can count as one extra piece." }));
		}
		return el("div", { class: "where" }, parts);
	}

	// ---------- Step 1: options ----------

	const weaponSelect = document.getElementById("weapon-slots");
	const gogmaBox = document.getElementById("gogma");

	weaponSelect.addEventListener("change", () => {
		state.weaponSlots = weaponSelect.value ? weaponSelect.value.split(",").map(Number) : [];
		changed();
	});
	gogmaBox.addEventListener("change", () => {
		state.gogmaWeapon = gogmaBox.checked;
		renderGogmaPanel();
		changed();
	});

	// ---------- Step 1: your Gogma weapon ----------

	function fillSelect(select, choices, selected) {
		select.replaceChildren(...choices.map(([value, text]) =>
			el("option", { value: value, text: text, selected: value === selected ? true : null })));
	}

	// "Lord's Soul · Guts (Tenacity)" helps people who know the bonus by its effect name.
	function bonusChoices(kind) {
		const skills = data.skills.filter((s) => s.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
		return [["", "Any (the forge picks)"]].concat(skills.map((s) => [String(s.id), s.name + " · " + s.ranks[0].name.replace(/ I$/, "")]));
	}

	// Fills in the fields from what is saved, and listens for changes. Runs once at start.
	function setupGogmaPanel() {
		const g = state.gogma;
		fillSelect(document.getElementById("gogma-type"), [["", "Pick a type"]].concat(WEAPON_TYPES.map((t) => [t, t])), g.type);
		fillSelect(document.getElementById("gogma-element"), ELEMENTS.map((e) => [e, e]), g.element);
		fillSelect(document.getElementById("gogma-set"), bonusChoices("set"), g.setId ? String(g.setId) : "");
		fillSelect(document.getElementById("gogma-group"), bonusChoices("group"), g.groupId ? String(g.groupId) : "");
		for (let i = 0; i < 3; i++) {
			fillSelect(document.getElementById("gogma-slot-" + i), [["", "–"], ["1", "1"], ["2", "2"], ["3", "3"]], g.slots[i] ? String(g.slots[i]) : "");
		}
		document.getElementById("gogma-attack").value = g.attack ? String(g.attack) : "";
		document.getElementById("gogma-affinity").value = String(g.affinity);

		// Type and element are only shown on the sets: redraw, no new search.
		for (const [id, field] of [["gogma-type", "type"], ["gogma-element", "element"]]) {
			document.getElementById(id).addEventListener("change", (event) => {
				g[field] = event.target.value;
				save();
				renderResults();
			});
		}
		// Attack and affinity change the numbers, not which armor fits: redraw, no new search.
		document.getElementById("gogma-attack").addEventListener("input", (event) => {
			g.attack = clampNumber(event.target.value, 0, 999);
			save();
			renderResults();
		});
		document.getElementById("gogma-affinity").addEventListener("input", (event) => {
			g.affinity = clampNumber(event.target.value, -100, 100);
			save();
			renderResults();
		});
		// Set bonus, group skill and slots change which sets work: search again.
		document.getElementById("gogma-set").addEventListener("change", (event) => {
			g.setId = Number(event.target.value) || null;
			changed();
		});
		document.getElementById("gogma-group").addEventListener("change", (event) => {
			g.groupId = Number(event.target.value) || null;
			changed();
		});
		for (let i = 0; i < 3; i++) {
			document.getElementById("gogma-slot-" + i).addEventListener("change", () => {
				g.slots = [0, 1, 2]
					.map((n) => Number(document.getElementById("gogma-slot-" + n).value))
					.filter((s) => s > 0)
					.sort((a, b) => b - a);
				changed();
			});
		}
	}

	// The Gogma box shows only while the box is ticked. Its slots and affinity then
	// replace the plain weapon fields, so those hide to avoid two answers to one question.
	function renderGogmaPanel() {
		document.getElementById("gogma-box").hidden = !state.gogmaWeapon;
		document.getElementById("weapon-slots-row").hidden = state.gogmaWeapon;
		document.getElementById("weapon-affinity-row").hidden = state.gogmaWeapon;
	}

	// ---------- Step 1: your own charms ----------

	const CHARM_SKILL_ROWS = 3;
	const CHARM_SLOT_ROWS = 3; // per kind: up to three armor and three weapon slots
	const CHARM_RARITIES = [8, 7, 6, 5, 4, 3, 2, 1];
	// Skills a charm can carry: armor and weapon skills (no set bonuses), A to Z.
	const CHARM_SKILL_CHOICES = data.skills
		.filter((s) => s.kind === "armor" || s.kind === "weapon")
		.sort((a, b) => a.name.localeCompare(b.name));

	// null = form closed, "new" = adding a charm, otherwise the id of the charm being edited.
	let editingCharmId = null;

	const charmForm = document.getElementById("charm-form");
	const addCharmButton = document.getElementById("add-charm");

	function renderMyCharms() {
		const list = document.getElementById("my-charms");
		list.replaceChildren(...state.myCharms.map(charmCard));
		addCharmButton.hidden = editingCharmId !== null;
		charmForm.hidden = editingCharmId === null;
		if (editingCharmId !== null) {
			fillCharmForm(state.myCharms.find((c) => c.id === editingCharmId) || null);
		}
	}

	function charmCard(charm) {
		const skillText = charm.skills.length
			? charm.skills.map(([id, level]) => index.skillById.get(id).name + " " + level).join(" · ")
			: "No skills";
		return el("div", { class: "wish" }, [
			el("div", { class: "wish-top" }, [
				el("div", { class: "wish-title" }, [
					el("span", { class: "wish-name", text: charm.name }),
					el("span", { class: "kind mine", text: "Rarity " + charm.rarity }),
				]),
				el("span", { class: "row" }, [
					el("button", {
						type: "button", class: "linkish", text: "Edit",
						onclick: () => {
							editingCharmId = charm.id;
							renderMyCharms();
						},
					}),
					el("button", {
						type: "button", class: "remove", "aria-label": "Remove " + charm.name, text: "×",
						onclick: () => removeCharm(charm.id),
					}),
				]),
			]),
			el("span", { text: skillText }),
			el("span", { class: "row" }, ["Slots", mixedSlotBadges(charm.armorSlots, charm.weaponSlots)]),
			el("label", { class: "option" }, [
				el("input", {
					type: "checkbox", id: "around-" + charm.id, checked: charm.buildAround ? true : null,
					onchange: (event) => setBuildAround(charm.id, event.target.checked),
				}),
				"Always use this charm",
			]),
		]);
	}

	// Only one charm can be the one every set is built around.
	function setBuildAround(charmId, on) {
		for (const charm of state.myCharms) {
			charm.buildAround = on && charm.id === charmId;
		}
		renderMyCharms();
		changed();
	}

	function removeCharm(charmId) {
		state.myCharms = state.myCharms.filter((c) => c.id !== charmId);
		if (editingCharmId === charmId) {
			editingCharmId = null;
		}
		renderMyCharms();
		changed();
	}

	function skillSelect(id, selectedId) {
		const select = el("select", { id: id, "aria-label": "Charm skill" });
		select.appendChild(el("option", { value: "", text: "No skill" }));
		for (const [kind, label] of [["armor", "Armor skills"], ["weapon", "Weapon skills"]]) {
			select.appendChild(el("optgroup", { label: label }, CHARM_SKILL_CHOICES
				.filter((s) => s.kind === kind)
				.map((s) => el("option", { value: String(s.id), text: s.name, selected: s.id === selectedId ? true : null }))));
		}
		return select;
	}

	// Levels 1 to the skill's max. A new skill starts at its max, since charms often have that.
	function fillLevels(select, skillId, level) {
		const skill = index.skillById.get(Number(skillId));
		const max = skill ? Solver.maxLevel(skill) : 1;
		const chosen = Math.min(level || max, max);
		select.replaceChildren();
		for (let i = 1; i <= max; i++) {
			select.appendChild(el("option", { value: String(i), text: "Level " + i, selected: i === chosen ? true : null }));
		}
		select.disabled = !skill;
	}

	function slotSelect(id, size, label) {
		return el("select", { id: id, "aria-label": label },
			[["", "–"], ["1", "1"], ["2", "2"], ["3", "3"]].map(([value, text]) =>
				el("option", { value: value, text: text, selected: String(size || "") === value ? true : null })));
	}

	function fillCharmForm(charm) {
		const skillRows = [];
		for (let i = 0; i < CHARM_SKILL_ROWS; i++) {
			const pair = charm ? charm.skills[i] : null;
			const skillBox = skillSelect("charm-skill-" + i, pair ? pair[0] : null);
			const levelBox = el("select", { id: "charm-level-" + i, "aria-label": "Skill level" });
			fillLevels(levelBox, pair ? pair[0] : null, pair ? pair[1] : null);
			skillBox.addEventListener("change", () => fillLevels(levelBox, skillBox.value, null));
			skillRows.push(el("div", { class: "form-pair" }, [skillBox, levelBox]));
		}
		const slotRow = (kind, label, sizes) => {
			const selects = [];
			for (let i = 0; i < CHARM_SLOT_ROWS; i++) {
				selects.push(slotSelect("charm-" + kind + "-" + i, sizes[i], label + " " + (i + 1)));
			}
			return el("div", { class: "form-row" }, [el("span", { text: label }), el("span", { class: "row" }, selects)]);
		};

		charmForm.replaceChildren(
			el("span", { class: "label", text: charm ? "Edit charm" : "New charm" }),
			el("div", { class: "form-row" }, [
				el("label", { for: "charm-name", text: "Name" }),
				el("input", { id: "charm-name", type: "text", maxlength: "40", placeholder: "My charm", value: charm ? charm.name : "" }),
			]),
			el("div", { class: "form-row" }, [
				el("label", { for: "charm-rarity", text: "Rarity" }),
				el("select", { id: "charm-rarity" }, CHARM_RARITIES.map((r) =>
					el("option", { value: String(r), text: String(r), selected: (charm ? charm.rarity : 8) === r ? true : null }))),
			]),
			el("div", { class: "form-row" }, [el("span", { text: "Skills" }), el("div", { class: "form-stack" }, skillRows)]),
			slotRow("armor", "Armor slots", charm ? charm.armorSlots : []),
			slotRow("weapon", "Weapon slots", charm ? charm.weaponSlots : []),
			el("p", { id: "charm-message", class: "status warn", "aria-live": "polite" }),
			el("div", { class: "row" }, [
				el("button", { type: "submit", class: "btn primary small", text: "Save charm" }),
				el("button", {
					type: "button", class: "btn small", text: "Cancel",
					onclick: () => {
						editingCharmId = null;
						renderMyCharms();
					},
				}),
			]),
		);
	}

	function readSlots(prefix) {
		const sizes = [];
		for (let i = 0; i < CHARM_SLOT_ROWS; i++) {
			const value = Number(document.getElementById(prefix + i).value);
			if (value) {
				sizes.push(value);
			}
		}
		return sizes.sort((a, b) => b - a);
	}

	charmForm.addEventListener("submit", (event) => {
		event.preventDefault();
		const skills = [];
		for (let i = 0; i < CHARM_SKILL_ROWS; i++) {
			const skillId = Number(document.getElementById("charm-skill-" + i).value);
			// The same skill picked twice: keep the first row.
			if (skillId && !skills.some((pair) => pair[0] === skillId)) {
				skills.push([skillId, Number(document.getElementById("charm-level-" + i).value)]);
			}
		}
		const armorSlots = readSlots("charm-armor-");
		const weaponSlots = readSlots("charm-weapon-");
		if (!skills.length && !armorSlots.length && !weaponSlots.length) {
			document.getElementById("charm-message").textContent = "Add at least one skill or slot, then save.";
			return;
		}
		const fields = {
			name: document.getElementById("charm-name").value.trim().slice(0, 40) || "My charm",
			rarity: Number(document.getElementById("charm-rarity").value),
			skills: skills,
			armorSlots: armorSlots,
			weaponSlots: weaponSlots,
		};
		if (editingCharmId === "new") {
			// A charm you just added is most likely the one you want to use.
			const charm = Object.assign({ id: "mine-" + Date.now(), buildAround: true }, fields);
			state.myCharms.forEach((c) => {
				c.buildAround = false;
			});
			state.myCharms.push(charm);
		} else {
			Object.assign(state.myCharms.find((c) => c.id === editingCharmId), fields);
		}
		editingCharmId = null;
		renderMyCharms();
		changed();
	});

	addCharmButton.addEventListener("click", () => {
		editingCharmId = "new";
		renderMyCharms();
		document.getElementById("charm-skill-0").focus();
	});

	// Weapon affinity only changes the numbers, not which armor fits, so no new search.
	const affinityInput = document.getElementById("weapon-affinity");
	affinityInput.addEventListener("input", () => {
		const value = Number(affinityInput.value);
		state.weaponAffinity = Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0;
		save();
		renderResults();
	});

	// ---------- Step 2: searching and showing sets ----------

	let searchTimer = null;
	let lastAnswer = null;

	function scheduleSearch() {
		clearTimeout(searchTimer);
		document.getElementById("status").className = "status muted";
		document.getElementById("status").textContent = "Looking for sets…";
		searchTimer = setTimeout(runSearch, SEARCH_DELAY_MS);
	}

	function runSearch() {
		if (state.targets.length === 0) {
			lastAnswer = null;
			renderResults();
			return;
		}
		const around = state.myCharms.find((charm) => charm.buildAround);
		startOverAtBestBuild();
		lastAnswer = Solver.findSets(index, {
			targets: state.targets,
			weaponSlots: weaponSlotsNow(),
			gogmaWeapon: state.gogmaWeapon,
			gogmaSet: state.gogma.setId,
			gogmaGroup: state.gogma.groupId,
			wholeSets: effects.wholeSetOnly,
			customCharms: state.myCharms.map(toSolverCharm),
			onlyCharm: around ? around.id : null,
		});
		renderResults();
	}

	// The solver wants the charm without the page-only "build around" flag.
	function toSolverCharm(charm) {
		return {
			id: charm.id,
			name: charm.name,
			rarity: charm.rarity,
			skills: charm.skills,
			armorSlots: charm.armorSlots,
			weaponSlots: charm.weaponSlots,
			custom: true,
		};
	}

	// Which build is on screen (0 = the best one), which to-do rows are ticked, and
	// whether the fight-situation switches and the details are open. A new search
	// starts again at the best build with nothing ticked.
	let shownBuild = 0;
	let ticked = new Set();
	let situationsOpen = false;
	let detailsOpen = false;

	function startOverAtBestBuild() {
		shownBuild = 0;
		ticked = new Set();
	}

	function renderGearSummary() {
		const parts = [];
		if (state.gogmaWeapon) {
			parts.push("Gogma " + (state.gogma.type || "weapon"));
		}
		const around = state.myCharms.find((charm) => charm.buildAround);
		if (around) {
			parts.push(around.name);
		} else if (state.myCharms.length) {
			parts.push(state.myCharms.length === 1 ? "1 charm" : state.myCharms.length + " charms");
		}
		document.getElementById("gear-summary").textContent = parts.length ? parts.join(" · ") : "Optional: your weapon and charm";
	}

	function renderResults() {
		renderGearSummary();
		const status = document.getElementById("status");
		const box = document.getElementById("results");
		box.replaceChildren();

		if (!lastAnswer) {
			status.className = "status muted";
			status.replaceChildren(
				"Pick a skill in step 1, or ",
				el("button", { type: "button", class: "linkish", text: "start from a ready-made build", onclick: () => showTab("popular") }),
				".");
			return;
		}

		const answer = lastAnswer;
		const count = answer.results.length;
		if (count === 0) {
			status.className = "status warn";
			status.textContent = "No build has all of these skills. Lower a level or remove a skill.";
			return;
		}
		status.className = "status";
		status.textContent = "";

		shownBuild = Math.min(shownBuild, count - 1);
		const result = answer.results[shownBuild];
		const visible = visibleSituations([result]);
		// A switch that is not on screen must not change anything, so only count visible ones.
		const situationsOn = new Set(state.situations.filter((id) => visible.has(id)));
		const analysis = analyseSet(result, situationsOn);

		box.appendChild(pager(count));
		box.appendChild(buildCard(analysis, visible, situationsOn));
	}

	// "‹  Build 1 of 8  ›": flip through the builds one at a time.
	function pager(count) {
		const go = (step) => {
			shownBuild = (shownBuild + step + count) % count;
			ticked = new Set();
			renderResults();
		};
		const single = count < 2;
		return el("div", { class: "pager" }, [
			el("button", { type: "button", class: "btn pager-btn", "aria-label": "Previous build", text: "‹", disabled: single ? true : null, onclick: () => go(-1) }),
			el("div", { class: "pager-text" }, [
				el("b", { text: "Build " + (shownBuild + 1) + " of " + count }),
				el("span", { class: "muted small", text: shownBuild === 0 ? "Best: most room for extra jewels" : "Another way to get your skills" }),
			]),
			el("button", { type: "button", class: "btn pager-btn", "aria-label": "Next build", text: "›", disabled: single ? true : null, onclick: () => go(1) }),
		]);
	}

	function buildCard(analysis, visible, situationsOn) {
		const view = buildView(analysis, situationsOn);
		return el("article", { class: "build" }, [
			renderNumbers(view.numbers),
			situationLine(visible, situationsOn),
			...renderLists(view, "live-"),
			...buildActions(view),
			moreDetails(analysis),
		]);
	}

	// Everything a build shows, as plain data (no page elements). The live build is drawn
	// from it, and "Save this build" stores exactly this, so a saved build looks the same later.
	function buildView(analysis, situationsOn) {
		const names = effects.situations.filter((s) => situationsOn.has(s.id)).map((s) => s.short || s.label);
		const jewels = jewelData(analysis);
		return {
			numbers: numbersData(analysis.smart.stats),
			situations: names.length ? names.join(", ") : "normal hits",
			defense: analysis.result.defense,
			wear: wearData(analysis.result),
			jewels: jewels.jewels,
			leftArmor: jewels.leftArmor,
			leftWeapon: jewels.leftWeapon,
			notes: jewels.notes,
		};
	}

	// ---------- The three big numbers ----------

	function percent(fraction) {
		return (fraction >= 0 ? "+" : "") + Math.round(fraction * 100) + "%";
	}

	function attackText(stats) {
		const parts = [];
		if (stats.attack) {
			parts.push("+" + stats.attack);
		}
		if (stats.attackPct) {
			parts.push("+" + stats.attackPct + "%");
		}
		return parts.length ? parts.join(" & ") : "+0";
	}

	function numbersData(stats) {
		const critSub = stats.affinity > 100
			? "capped at 100%"
			: "crits hit +" + stats.critDamage + "%";
		// With your weapon's attack known, show the attack you actually hit with.
		const attack = stats.weaponAttackKnown
			? { label: "Attack", value: String(stats.totalAttack), sub: "weapon " + stats.weaponAttack + " " + attackText(stats) }
			: { label: "Attack", value: attackText(stats), sub: "from skills" };
		return [
			{ label: "Crit chance", value: stats.affinityShown + "%", sub: critSub },
			attack,
			{ label: "Damage", value: percent(stats.damageGain), sub: "vs no skills" },
		];
	}

	function renderNumbers(numbers) {
		return el("div", { class: "stat-tiles" }, numbers.map((n) => el("div", { class: "stat" }, [
			el("span", { class: "label", text: n.label }),
			el("span", { class: "stat-value", text: n.value }),
			n.sub ? el("span", { class: "stat-sub", text: n.sub }) : null,
		])));
	}

	// ---------- Fight situations ----------

	// Situations worth a switch: the common ones, the ones your wished skills
	// are built for, and the ones this build's skills use.
	function visibleSituations(results) {
		const visible = new Set(effects.alwaysShown.concat(effects.defaultSituations));
		for (const target of state.targets) {
			const skill = index.skillById.get(target.skillId);
			for (const part of effects.skills[skill.name] || []) {
				if (part.when !== "always") {
					visible.add(part.when);
				}
			}
		}
		for (const result of results) {
			const levels = new Map(Solver.totalSkills(index, result).map((e) => [e.skill.id, e.level]));
			for (const id of Stats.situationsUsed(index, effects, levels)) {
				visible.add(id);
			}
		}
		return visible;
	}

	// "Numbers for: weak points, enraged monster · Change". The switches stay hidden until asked for.
	function situationLine(visible, situationsOn) {
		const names = effects.situations.filter((s) => situationsOn.has(s.id)).map((s) => s.short || s.label);
		const line = el("p", { class: "situation-line" }, [
			"Numbers for: ",
			el("b", { text: names.length ? names.join(", ") : "normal hits" }),
			" ",
			el("button", {
				type: "button", class: "linkish", "aria-expanded": situationsOpen ? "true" : "false",
				text: situationsOpen ? "Done" : "Change",
				onclick: () => {
					situationsOpen = !situationsOpen;
					renderResults();
				},
			}),
		]);
		if (!situationsOpen) {
			return line;
		}
		const row = el("div", { class: "situation-row" });
		for (const situation of effects.situations) {
			if (!visible.has(situation.id)) {
				continue;
			}
			const on = state.situations.includes(situation.id);
			row.appendChild(el("button", {
				type: "button",
				class: "situation" + (on ? " on" : ""),
				"aria-pressed": on ? "true" : "false",
				text: situation.label,
				onclick: () => {
					if (on) {
						state.situations = state.situations.filter((id) => id !== situation.id);
					} else {
						switchSituationOn(situation.id);
					}
					save();
					renderResults();
				},
			}));
		}
		return el("div", { class: "situations" }, [
			line,
			el("p", { class: "hint", text: "Tap what happens in your fights. The numbers and extra jewels follow." }),
			row,
		]);
	}

	// ---------- To-do lists ----------

	// "Wear these" and "Put in these jewels", drawn from a build's plain data.
	// tickPrefix keeps ticks of the live build and of each saved build apart.
	function renderLists(view, tickPrefix) {
		const parts = [
			el("h3", { class: "todo-title" }, ["Wear these", el("span", { class: "muted small", text: "Defense " + view.defense })]),
			checklist(view.wear.map((w) => ({
				key: w.key,
				label: w.label,
				name: w.name,
				extra: w.extra,
				side: w.armorSlots.length || w.weaponSlots.length ? mixedSlotBadges(w.armorSlots, w.weaponSlots) : null,
			})), tickPrefix),
			el("h3", { class: "todo-title" }, ["Put in these jewels"]),
		];
		parts.push(view.jewels.length
			? checklist(view.jewels.map((j) => ({
				key: j.key,
				label: slotBadges([j.slot], j.kind),
				name: j.name,
				extra: j.extra,
				side: j.needed ? el("span", { class: "pill", text: "Needed" }) : el("span", { class: "gain", text: j.gain }),
			})), tickPrefix)
			: el("p", { class: "muted", text: "No jewels needed." }));
		if (view.leftArmor.length || view.leftWeapon.length) {
			parts.push(el("p", { class: "muted small" }, [
				"Free slots left ",
				mixedSlotBadges(view.leftArmor, view.leftWeapon),
				" Use them for anything you like, such as Divine Blessing or Evade Window.",
			]));
		}
		for (const note of view.notes) {
			parts.push(el("p", { class: "note", text: note }));
		}
		return parts;
	}

	// Rows you can tick off while you set it up in the game. Ticking only changes the
	// look of the row, so the page does not redraw and keyboard focus stays put.
	function checklist(items, tickPrefix) {
		return el("ul", { class: "checklist" }, items.map((item) => {
			const key = tickPrefix + item.key;
			const row = el("li", { class: ticked.has(key) ? "done" : "" });
			const box = el("input", {
				type: "checkbox",
				checked: ticked.has(key) ? true : null,
				"aria-label": "Done: " + item.name,
				onchange: () => {
					if (box.checked) {
						ticked.add(key);
					} else {
						ticked.delete(key);
					}
					row.classList.toggle("done", box.checked);
				},
			});
			// append() would write a missing side as the word "null", so only add what exists.
			row.append(...[
				el("label", { class: "check" }, [
					box,
					typeof item.label === "string" ? el("span", { class: "check-kind label", text: item.label }) : el("span", { class: "check-kind" }, item.label),
					el("span", { class: "check-main" }, [
						el("span", { class: "piece-name", text: item.name }),
						item.extra ? el("span", { class: "muted small", text: item.extra }) : null,
					]),
				]),
				item.side ? el("span", { class: "check-side" }, item.side) : null,
			].filter(Boolean));
			return row;
		}));
	}

	// The "Wear these" rows as plain data: what to wear and its slots.
	function wearData(result) {
		const rows = [];
		if (state.gogmaWeapon) {
			const g = state.gogma;
			const details = [];
			if (g.element && g.element !== "None") {
				details.push(g.element);
			}
			const adds = [result.weaponBonus.set, result.weaponBonus.group].filter(Boolean).map((s) => s.name);
			if (adds.length) {
				details.push("adds " + adds.join(" + "));
			}
			rows.push({ key: "weapon", label: "Weapon", name: "Gogma " + (g.type || "Artian weapon"), extra: details.join(" · "), armorSlots: [], weaponSlots: g.slots.slice() });
		} else if (weaponSlotsNow().length) {
			rows.push({ key: "weapon", label: "Weapon", name: "Any weapon with these slots", extra: "", armorSlots: [], weaponSlots: weaponSlotsNow().slice() });
		}
		for (const piece of result.pieces) {
			// The game wears the whole set at once, so say so on every piece of it.
			const whole = effects.wholeSetOnly.includes(piece.set) ? piece.set + " set, always worn as a whole" : "";
			rows.push({ key: "piece-" + piece.id, label: PIECE_LABEL[piece.kind], name: piece.name, extra: whole, armorSlots: piece.slots.slice(), weaponSlots: [] });
		}
		const charm = result.charm;
		rows.push(charm
			? {
				key: "charm", label: "Charm", name: charm.name, extra: charm.custom ? "your own charm" : "",
				armorSlots: charm.custom ? charm.armorSlots.slice() : [], weaponSlots: charm.custom ? charm.weaponSlots.slice() : [],
			}
			: { key: "charm", label: "Charm", name: "Any charm you like", extra: "", armorSlots: [], weaponSlots: [] });
		return rows;
	}

	// The slot badge already shows the size, so drop the "[2]" from the name.
	function jewelName(entry) {
		return (entry.count > 1 ? entry.count + "× " : "") + entry.deco.name.replace(/\s*\[\d\]$/, "");
	}

	function levelChange(entry) {
		return entry.deco.skills.map((pair) => {
			const skill = index.skillById.get(pair[0]);
			return skill.name + " " + (entry.from.get(pair[0]) || 0) + " → " + entry.to.get(pair[0]);
		}).join(", ");
	}

	// Every jewel slot in the build, with the name of the piece it is on.
	// The charm's slots are named after the charm, so "In My neck (charm)" is clear.
	function slotsOf(result) {
		const charm = result.charm;
		const charmPlace = charm ? charm.name + " (charm)" : "";
		const armor = [];
		for (const piece of result.pieces) {
			for (const size of piece.slots) {
				armor.push({ size: size, place: piece.name });
			}
		}
		for (const size of (charm && charm.armorSlots) || []) {
			armor.push({ size: size, place: charmPlace });
		}
		const weaponPlace = state.gogmaWeapon ? "Gogma " + (state.gogma.type || "weapon") : "your weapon";
		const weapon = weaponSlotsNow().map((size) => ({ size: size, place: weaponPlace }));
		for (const size of (charm && charm.weaponSlots) || []) {
			weapon.push({ size: size, place: charmPlace });
		}
		return { armor: armor, weapon: weapon };
	}

	// "Orion Cap α ×2, Udra Miremail γ"
	function placesText(places) {
		const counts = new Map();
		for (const place of places) {
			counts.set(place, (counts.get(place) || 0) + 1);
		}
		return [...counts].map(([place, n]) => (place || "no free slot") + (n > 1 ? " ×" + n : "")).join(", ");
	}

	// The jewel list as plain data: the jewels your skills need first, then extras for
	// more damage (the biggest boost on top). Each one says exactly which piece it goes in.
	function jewelData(analysis) {
		const result = analysis.result;
		const smart = analysis.smart;

		const entries = [];
		for (const entry of result.jewels.concat(result.weapon.jewels)) {
			const gives = entry.deco.skills.map((pair) => index.skillById.get(pair[0]).name).join(" + ");
			entries.push({ deco: entry.deco, count: entry.count, key: "need-" + entry.deco.id, what: "for " + gives, needed: true, gain: "" });
		}
		for (const entry of smart.picks.slice().sort((a, b) => b.gain - a.gain)) {
			entries.push({ deco: entry.deco, count: entry.count, key: "extra-" + entry.deco.id, what: levelChange(entry), needed: false, gain: percent(entry.gain) + " damage" });
		}

		// Armor jewels go in armor slots (and the charm's), weapon jewels in weapon slots (and the charm's).
		const slots = slotsOf(result);
		const armorEntries = entries.filter((e) => e.deco.kind !== "weapon");
		const weaponEntries = entries.filter((e) => e.deco.kind === "weapon");
		const armorPlaced = Solver.placeJewels(armorEntries, slots.armor);
		const weaponPlaced = Solver.placeJewels(weaponEntries, slots.weapon);
		armorEntries.forEach((e, i) => {
			e.places = armorPlaced.places[i];
		});
		weaponEntries.forEach((e, i) => {
			e.places = weaponPlaced.places[i];
		});

		const notes = [];
		if (result.weapon.missing.length) {
			notes.push("Your weapon has no room for: " +
				result.weapon.missing.map((m) => m.skill.name + " +" + m.levels).join(", ") +
				". Pick a weapon that has it built in.");
		}
		// Bonuses left on "Any" that this build relies on: your weapon must roll these.
		const bonusNeeded = [];
		if (result.weaponBonus.set && !result.weaponBonus.setFixed) {
			bonusNeeded.push("set bonus " + result.weaponBonus.set.name);
		}
		if (result.weaponBonus.group && !result.weaponBonus.groupFixed) {
			bonusNeeded.push("group skill " + result.weaponBonus.group.name);
		}
		if (bonusNeeded.length) {
			notes.push("Your Gogma weapon needs " + bonusNeeded.join(" and ") + ".");
		}

		return {
			jewels: entries.map((e) => ({
				key: e.key,
				slot: e.deco.slot,
				kind: e.deco.kind,
				name: jewelName(e),
				extra: "In " + placesText(e.places) + " · " + e.what,
				needed: e.needed,
				gain: e.gain,
			})),
			leftArmor: armorPlaced.left.map((s) => s.size).sort((a, b) => b - a),
			leftWeapon: weaponPlaced.left.map((s) => s.size).sort((a, b) => b - a),
			notes: notes,
		};
	}

	// ---------- Saved builds ("My builds") ----------

	// Saved builds live in this browser's storage (like cookies): only on this device.
	const SAVED_KEY = "wilds-build-forge-saved-v1";
	// Newest first: [{ id, name, savedAt, targets, view }]
	let savedBuilds = loadSaved();
	let openSavedId = null; // the saved build that is unfolded on My builds
	let deletingSavedId = null; // the saved build showing "Delete for good?"

	function loadSaved() {
		try {
			const list = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
			if (!Array.isArray(list)) {
				return [];
			}
			return list
				.filter((b) => b && typeof b.id === "string" && Share.cleanView(b.view))
				.map((b) => ({
					id: b.id,
					name: Share.text(b.name, 60) || "My build",
					savedAt: Share.text(b.savedAt, 40),
					targets: cleanTargets(b.targets),
					view: Share.cleanView(b.view),
				}));
		} catch (error) {
			return [];
		}
	}

	// Returns false when the browser does not allow saving (private window, blocked storage).
	function storeSaved() {
		try {
			localStorage.setItem(SAVED_KEY, JSON.stringify(savedBuilds));
			return true;
		} catch (error) {
			return false;
		}
	}

	// "Heroics 5 · Agitator 5 · Lord's Soul". Up to three skills, then "+2 more".
	function autoName() {
		const parts = state.targets.slice(0, 3).map((t) => {
			const skill = index.skillById.get(t.skillId);
			return Solver.isPieceCountSkill(skill) ? skill.name : skill.name + " " + t.level;
		});
		if (state.targets.length > 3) {
			parts.push("+" + (state.targets.length - 3) + " more");
		}
		return parts.join(" · ") || "My build";
	}

	// A second "Heroics 5" becomes "Heroics 5 (2)", so saved builds are easy to tell apart.
	function uniqueName(name) {
		const taken = new Set(savedBuilds.map((b) => b.name));
		if (!taken.has(name)) {
			return name;
		}
		let n = 2;
		while (taken.has(name + " (" + n + ")")) {
			n += 1;
		}
		return name + " (" + n + ")";
	}

	function sameView(a, b) {
		return JSON.stringify(a) === JSON.stringify(b);
	}

	function saveButton(view) {
		const already = savedBuilds.find((b) => sameView(b.view, view));
		if (already) {
			return el("p", { class: "saved-line" }, [
				"✓ Saved as ", el("b", { text: already.name }), " ",
				el("button", { type: "button", class: "linkish", text: "See My builds", onclick: () => showSaved(already.id) }),
			]);
		}
		return el("button", {
			type: "button", class: "btn primary wide", text: "☆ Save this build",
			onclick: () => {
				const build = {
					id: "build-" + Date.now(),
					name: uniqueName(autoName()),
					savedAt: new Date().toISOString(),
					targets: state.targets.map((t) => ({ skillId: t.skillId, level: t.level })),
					view: view,
				};
				savedBuilds.unshift(build);
				if (!storeSaved()) {
					savedBuilds.shift();
					document.getElementById("status").className = "status warn";
					document.getElementById("status").textContent = "This browser does not allow saving here (maybe a private window).";
					return;
				}
				updateSavedTab();
				renderResults();
			},
		});
	}

	function buildActions(view) {
		const share = shareControls(() => ({
			name: autoName(),
			targets: state.targets.map((t) => ({ skillId: t.skillId, level: t.level })),
			view: view,
		}));
		return [el("div", { class: "build-actions" }, [saveButton(view), share.button]), share.panel];
	}

	function updateSavedTab() {
		document.getElementById("tab-saved").textContent = savedBuilds.length ? "My builds (" + savedBuilds.length + ")" : "My builds";
	}

	// Go to My builds with one build unfolded.
	function showSaved(buildId) {
		openSavedId = buildId;
		deletingSavedId = null;
		showTab("saved");
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	function formatSavedDate(iso) {
		const date = new Date(iso);
		return isNaN(date) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
	}

	// "Saved 20 Oct 2026 · crit chance 42% · damage +64%": enough to compare builds at a glance.
	function savedSummary(build) {
		const parts = ["Saved " + formatSavedDate(build.savedAt)];
		for (const n of build.view.numbers) {
			if (n.label !== "Attack") {
				parts.push(n.label.toLowerCase() + " " + n.value);
			}
		}
		return parts.join(" · ");
	}

	function renderSaved() {
		updateSavedTab();
		const list = document.getElementById("saved-list");
		list.replaceChildren();
		if (!savedBuilds.length) {
			list.appendChild(el("p", { class: "muted" }, [
				"No saved builds yet. Make a build and tap ",
				el("b", { text: "☆ Save this build" }),
				".",
			]));
			return;
		}
		for (const build of savedBuilds) {
			list.appendChild(savedCard(build));
		}
	}

	function savedCard(build) {
		const open = openSavedId === build.id;
		const share = shareControls(() => build, "small");
		const nameField = el("input", {
			type: "text", class: "saved-name", id: "name-" + build.id, maxlength: "60",
			value: build.name, "aria-label": "Build name",
			onchange: () => {
				build.name = nameField.value.trim().slice(0, 60) || autoName();
				nameField.value = build.name;
				storeSaved();
			},
		});

		const actions = deletingSavedId === build.id
			? [
				el("span", { class: "small", text: "Delete for good?" }),
				el("button", {
					type: "button", class: "btn small danger", text: "Yes, delete",
					onclick: () => {
						savedBuilds = savedBuilds.filter((b) => b.id !== build.id);
						storeSaved();
						deletingSavedId = null;
						renderSaved();
					},
				}),
				el("button", {
					type: "button", class: "btn small", text: "Keep it",
					onclick: () => {
						deletingSavedId = null;
						renderSaved();
					},
				}),
			]
			: [
				el("button", {
					type: "button", class: "btn small" + (open ? "" : " primary"), text: open ? "Hide" : "Show",
					"aria-expanded": open ? "true" : "false",
					onclick: () => {
						openSavedId = open ? null : build.id;
						renderSaved();
					},
				}),
				el("button", { type: "button", class: "btn small", text: "Open in builder", onclick: () => openInBuilder(build) }),
				share.button,
				el("button", {
					type: "button", class: "btn small", text: "Delete",
					onclick: () => {
						deletingSavedId = build.id;
						renderSaved();
					},
				}),
			];

		return el("article", { class: "saved-card" + (open ? " open" : "") }, [
			nameField,
			el("span", { class: "muted small", text: savedSummary(build) }),
			el("div", { class: "row" }, actions),
			deletingSavedId === build.id ? null : share.panel,
			open
				? el("div", { class: "build" }, [
					renderNumbers(build.view.numbers),
					el("p", { class: "situation-line" }, ["Numbers for: ", el("b", { text: build.view.situations })]),
					...renderLists(build.view, build.id + "-"),
				])
				: null,
		]);
	}

	// Puts the saved build's skills back in step 1. The forge then searches with the
	// gear you have now, so the result can differ a little from the saved one.
	function openInBuilder(build) {
		state.targets = build.targets.filter((t) => index.skillById.has(t.skillId));
		for (const target of state.targets) {
			switchOnSituationFor(index.skillById.get(target.skillId));
		}
		state.openInfo = null;
		showTab("build");
		changed();
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	// ---------- Sharing ----------

	// Share links always point at the public site, so friends can open them. While
	// testing on this PC (localhost) they point here instead.
	const PUBLIC_SITE = "https://mzdad.github.io/wilds-forge/";

	function shareBase() {
		const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
		return local ? location.origin + location.pathname : PUBLIC_SITE;
	}

	async function shareLink(build) {
		const code = await Share.encode({ v: 1, name: build.name, targets: build.targets, view: build.view });
		return shareBase() + "#share=" + code;
	}

	function slotsText(armorSlots, weaponSlots) {
		const parts = [];
		if (armorSlots.length) {
			parts.push("slots " + armorSlots.join(" "));
		}
		if (weaponSlots.length) {
			parts.push("weapon slots " + weaponSlots.join(" "));
		}
		return parts.length ? " (" + parts.join(", ") + ")" : "";
	}

	// The build as plain text, for Discord or a chat message.
	function shareText(build, link) {
		const view = build.view;
		const lines = [build.name + " · Monster Hunter Wilds build"];
		lines.push(view.numbers.map((n) => n.label + " " + n.value).join(" · ") + " (" + view.situations + ")");
		lines.push("", "Wear:");
		for (const w of view.wear) {
			lines.push("- " + w.label + ": " + w.name + slotsText(w.armorSlots, w.weaponSlots));
		}
		lines.push("", "Jewels:");
		if (!view.jewels.length) {
			lines.push("- none needed");
		}
		for (const j of view.jewels) {
			lines.push("- " + j.name + " [" + j.slot + "] " + j.extra + (j.needed ? " (needed)" : " (" + j.gain + ")"));
		}
		for (const note of view.notes) {
			lines.push("", "Note: " + note);
		}
		lines.push("", "See it: " + link);
		return lines.join("\n");
	}

	// A Share button and its panel. The panel fills in when it opens, so the link and
	// text are ready before you tap Copy (copying must happen right in the tap).
	function shareControls(getBuild, size) {
		const panel = el("div", { class: "share-panel", hidden: true });
		const button = el("button", {
			type: "button", class: "btn" + (size ? " " + size : ""), text: "Share", "aria-expanded": "false",
			onclick: async () => {
				const opening = panel.hidden;
				panel.hidden = !opening;
				button.setAttribute("aria-expanded", opening ? "true" : "false");
				if (opening) {
					await fillSharePanel(panel, getBuild());
				}
			},
		});
		return { button: button, panel: panel };
	}

	async function fillSharePanel(panel, build) {
		panel.replaceChildren(el("p", { class: "muted small", text: "Making the link…" }));
		let link;
		try {
			link = await shareLink(build);
		} catch (error) {
			panel.replaceChildren(el("p", { class: "status warn", text: "Could not make a share link in this browser." }));
			return;
		}
		const text = shareText(build, link);
		const message = el("p", { class: "share-message", "aria-live": "polite" });
		// Shown only when copying is not allowed: then you copy from the box yourself.
		const fallback = el("textarea", { class: "share-text", readonly: true, rows: "6", "aria-label": "Text to copy", hidden: true });

		const copy = (value, done) => {
			const showBox = () => {
				fallback.value = value;
				fallback.hidden = false;
				fallback.focus();
				fallback.select();
				message.textContent = "Copy it from the box below.";
			};
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(value).then(() => {
					fallback.hidden = true;
					message.textContent = done;
				}, showBox);
			} else {
				showBox();
			}
		};

		const buttons = [
			el("button", { type: "button", class: "btn small primary", text: "Copy link", onclick: () => copy(link, "✓ Link copied. Paste it anywhere.") }),
			el("button", { type: "button", class: "btn small", text: "Copy as text", onclick: () => copy(text, "✓ Text copied. Paste it in Discord or a chat.") }),
		];
		// Phones have their own share menu (Messenger, Discord, ...).
		if (navigator.share) {
			buttons.push(el("button", {
				type: "button", class: "btn small", text: "Share…",
				onclick: () => {
					navigator.share({ title: build.name, text: build.name + " · Monster Hunter Wilds build", url: link }).catch(() => {});
				},
			}));
		}
		panel.replaceChildren(
			el("p", { class: "muted small", text: "Anyone with the link sees this build exactly like this. Nothing is uploaded: the build is inside the link." }),
			el("div", { class: "row" }, buttons),
			message,
			fallback,
		);
	}

	// Skills from a link or old storage: only real skills, levels within range.
	function cleanTargets(list) {
		return (Array.isArray(list) ? list : [])
			.filter((t) => t && index.skillById.has(t.skillId))
			.slice(0, 20)
			.map((t) => {
				const skill = index.skillById.get(t.skillId);
				return { skillId: skill.id, level: Math.max(1, Math.min(Solver.maxLevel(skill), Math.round(Number(t.level) || 1))) };
			});
	}

	// ---------- Opening a shared link ----------

	function shareCodeInAddress() {
		const match = location.hash.match(/^#share=([A-Za-z0-9_-]+)$/);
		return match ? match[1] : null;
	}

	// Takes the "#share=..." off the address, so going back to the forge stays there.
	function clearShareFromAddress() {
		if (shareCodeInAddress()) {
			history.replaceState(null, "", location.pathname + location.search);
		}
	}

	async function openSharedBuild(code) {
		let shared = null;
		try {
			const payload = await Share.decode(code);
			const view = Share.cleanView(payload && payload.view);
			if (view) {
				shared = {
					name: Share.text(payload.name, 60) || "Shared build",
					targets: cleanTargets(payload.targets),
					view: view,
				};
			}
		} catch (error) {
			shared = null;
		}
		renderShared(shared);
		showTab("shared");
		window.scrollTo({ top: 0 });
	}

	function backToForge() {
		clearShareFromAddress();
		showTab(state.tab === "shared" ? "build" : state.tab);
	}

	function renderShared(shared) {
		const box = document.getElementById("shared-build");
		const back = el("button", { type: "button", class: "btn", text: "Back to the forge", onclick: backToForge });
		if (!shared) {
			box.replaceChildren(
				el("p", { class: "status warn", text: "This share link is broken or cut off. Ask for the link again." }),
				el("div", {}, back));
			return;
		}

		const alreadySaved = savedBuilds.find((b) => sameView(b.view, shared.view));
		const saveShared = el("button", {
			type: "button", class: "btn primary", text: alreadySaved ? "✓ In My builds" : "☆ Save to My builds", disabled: alreadySaved ? true : null,
			onclick: () => {
				savedBuilds.unshift({
					id: "build-" + Date.now(),
					name: uniqueName(shared.name),
					savedAt: new Date().toISOString(),
					targets: shared.targets,
					view: shared.view,
				});
				if (storeSaved()) {
					saveShared.textContent = "✓ In My builds";
					saveShared.disabled = true;
					updateSavedTab();
				} else {
					savedBuilds.shift();
					saveShared.textContent = "This browser does not allow saving here";
				}
			},
		});
		const openButton = shared.targets.length
			? el("button", {
				type: "button", class: "btn", text: "Open in builder",
				onclick: () => {
					clearShareFromAddress();
					openInBuilder(shared);
				},
			})
			: null;

		box.replaceChildren(
			el("span", { class: "label", text: "A build someone shared with you" }),
			el("h2", { class: "shared-title", text: shared.name }),
			el("div", { class: "row" }, [saveShared, openButton, back]),
			el("div", { class: "build" }, [
				renderNumbers(shared.view.numbers),
				el("p", { class: "situation-line" }, ["Numbers for: ", el("b", { text: shared.view.situations })]),
				...renderLists(shared.view, "shared-"),
			]),
		);
	}

	// ---------- More details (closed until asked for) ----------

	function effectText(line) {
		const parts = [];
		if (line.attack) {
			parts.push("+" + line.attack + " attack");
		}
		if (line.attackPct) {
			parts.push("+" + line.attackPct + "% attack");
		}
		if (line.affinity) {
			parts.push("+" + line.affinity + "% crit chance");
		}
		if (line.critDamage) {
			parts.push("crits +" + line.critDamage + "%");
		}
		return parts.join(", ");
	}

	// One row per skill part: what it adds, and when. Switched-off rows are greyed out.
	function breakdown(stats) {
		const rows = stats.lines
			.filter((line) => effectText(line))
			.sort((a, b) => Number(b.active) - Number(a.active))
			.map((line) => el("li", { class: line.active ? "" : "off" }, [
				el("b", { text: line.skill.name + " " + line.level }),
				" " + effectText(line) + " · ",
				el("span", { class: "muted", text: line.when === "always" ? "always" : SITUATION_LABEL[line.when] + (line.active ? "" : " (switched off)") }),
			]));
		const children = [rows.length ? el("ul", { class: "lines" }, rows) : el("p", { class: "muted", text: "No skills here change attack or crit chance." })];
		if (stats.uncounted.length) {
			children.push(el("p", { class: "muted" },
				"Not in the numbers: " + stats.uncounted.map((s) => s.name).join(", ") +
				". They do add damage, but the game gives no exact number, it depends on the weapon, or it is element damage."));
		}
		children.push(el("p", { class: "muted" },
			(stats.weaponAttackKnown
				? "Damage is an estimate for your weapon (" + stats.weaponAttack + " attack)."
				: "Damage is an estimate for a typical endgame weapon (" + Stats.TYPICAL_WEAPON_ATTACK + " attack).") +
			" Element damage comes on top."));
		return children;
	}

	function skillChips(analysis) {
		const smart = analysis.smart;
		const wanted = new Set(state.targets.map((t) => t.skillId));
		// All skills, counting the extra jewels. Set bonuses keep their piece count.
		const totals = analysis.totals.map((entry) => Solver.isPieceCountSkill(entry.skill)
			? entry
			: { skill: entry.skill, level: smart.levels.get(entry.skill.id) || entry.level });
		for (const [skillId, level] of smart.levels) {
			if (!totals.some((entry) => entry.skill.id === skillId)) {
				totals.push({ skill: index.skillById.get(skillId), level: level });
			}
		}
		totals.sort((a, b) => (wanted.has(b.skill.id) ? 1 : 0) - (wanted.has(a.skill.id) ? 1 : 0) || b.level - a.level);
		return el("div", { class: "skill-chips" }, totals.map((entry) => {
			const isCount = Solver.isPieceCountSkill(entry.skill);
			const rank = entry.skill.ranks.find((r) => r.level === entry.level);
			return el("span", { class: "skill-chip" + (wanted.has(entry.skill.id) ? " wanted" : "") }, [
				isCount && rank ? entry.skill.name + ": " + rank.name : entry.skill.name,
				isCount
					? el("span", { class: "lv", text: entry.pieces + " pc" })
					: staticPips(entry.level, Solver.maxLevel(entry.skill)),
			]);
		}));
	}

	function moreDetails(analysis) {
		const before = analysis.before;
		const details = el("details", {
			class: "more", open: detailsOpen ? true : null,
			ontoggle: () => {
				detailsOpen = details.open;
			},
		}, [
			el("summary", { text: "More about this build" }),
			el("div", { class: "breakdown" }, [
				analysis.smart.picks.length
					? el("p", {}, "Without the extra jewels: crit chance " + before.affinityShown + "%, attack " +
						attackText(before) + ", damage " + percent(before.damageGain) + ".")
					: null,
				el("span", { class: "label", text: "All skills" }),
				skillChips(analysis),
				el("span", { class: "label", text: "Where the numbers come from" }),
				...breakdown(analysis.smart.stats),
			]),
		]);
		return details;
	}

	// Everything one build needs: skill levels, numbers before and after extra jewels.
	// Free weapon slots come with the build, because your own charm can add one.
	function analyseSet(result, situationsOn) {
		const totals = Solver.totalSkills(index, result).filter((e) => e.level > 0);
		const levels = new Map(totals.map((e) => [e.skill.id, e.level]));
		return {
			result: result,
			totals: totals,
			before: Stats.computeStats(index, effects, levels, situationsOn, weaponAffinityNow(), weaponAttackNow()),
			smart: Stats.suggestJewels(index, effects, levels, result.freeSlots, result.freeWeaponSlots, situationsOn,
				weaponAffinityNow(), weaponAttackNow()),
		};
	}

	// ---------- Looking it up online ----------

	function renderOnlineLinks() {
		const box = document.getElementById("online-links");
		box.replaceChildren();
		const names = state.targets.slice(0, 3).map((t) => index.skillById.get(t.skillId).name);
		const words = "monster hunter wilds " + names.join(" ") + " build";
		const q = encodeURIComponent(words);
		const links = [
			["Google", "https://www.google.com/search?q=" + q],
			["YouTube", "https://www.youtube.com/results?search_query=" + q],
			["Reddit", "https://www.reddit.com/r/MonsterHunter/search/?q=" + encodeURIComponent("wilds " + names.join(" ") + " build")],
		];
		for (const [label, url] of links) {
			box.appendChild(el("a", { class: "btn small", href: url, target: "_blank", rel: "noopener", text: "Search " + label }));
		}
		box.appendChild(el("button", { type: "button", class: "btn small", text: "Ready-made builds", onclick: () => showTab("popular") }));
	}

	// ---------- Popular builds tab ----------

	function renderPopular() {
		document.getElementById("popular-intro").textContent =
			"Top builds for each weapon (checked " + popular.checked + "). Tap one and the forge works out the armor.";

		const grid = document.getElementById("popular-grid");
		grid.replaceChildren();
		for (const build of popular.builds) {
			const known = build.skills.map(([name, level]) => ({ skill: skillByName(name), level: level })).filter((s) => s.skill);
			const bonuses = known.filter((s) => Solver.isPieceCountSkill(s.skill));
			const others = known.filter((s) => !Solver.isPieceCountSkill(s.skill));

			grid.appendChild(el("article", { class: "pop" }, [
				el("span", { class: "label", text: build.weapon }),
				el("h3", { text: build.name }),
				el("div", { class: "skill-chips" }, bonuses.map((s) => {
					const rank = s.skill.ranks.find((r) => r.level === s.level) || s.skill.ranks[0];
					return el("span", { class: "skill-chip" }, [el("span", { class: "kind " + s.skill.kind, text: s.skill.kind === "set" ? "Set" : "Group" }), rank.name]);
				})),
				el("div", { class: "skill-chips" }, others.map((s) => el("span", { class: "skill-chip" }, [
					s.skill.name, el("span", { class: "lv", text: String(s.level) }),
				]))),
				el("div", { class: "actions" }, el("button", {
					type: "button", class: "btn primary wide", text: "Use this build",
					onclick: () => {
						state.targets = known.map((s) => ({ skillId: s.skill.id, level: Math.min(s.level, Solver.maxLevel(s.skill)) }));
						known.forEach((s) => switchOnSituationFor(s.skill));
						state.openInfo = null;
										showTab("build");
						changed();
						// On a phone the sets are far below the wish list, so go straight to them.
						const narrow = window.matchMedia("(max-width: 959px)").matches;
						const target = narrow ? document.getElementById("found-title") : document.body;
						target.scrollIntoView({ behavior: "smooth", block: "start" });
					},
				})),
			]));
		}

		const sources = document.getElementById("popular-sources");
		sources.replaceChildren("Sources: ");
		popular.sources.forEach((source, i) => {
			if (i > 0) {
				sources.appendChild(document.createTextNode(" · "));
			}
			sources.appendChild(el("a", { href: source.url, target: "_blank", rel: "noopener", text: source.name }));
		});
	}

	// ---------- Tabs ----------

	// "shared" is the page for a build someone sent you. It is not a tab of its own,
	// and it is not remembered: next visit opens where you were before.
	function showTab(tab) {
		if (tab !== "shared") {
			state.tab = tab;
			save();
		}
		for (const button of document.querySelectorAll(".tab")) {
			button.setAttribute("aria-selected", button.dataset.tab === tab ? "true" : "false");
		}
		document.getElementById("view-build").hidden = tab !== "build";
		document.getElementById("view-saved").hidden = tab !== "saved";
		document.getElementById("view-popular").hidden = tab !== "popular";
		document.getElementById("view-shared").hidden = tab !== "shared";
		if (tab === "saved") {
			renderSaved();
		}
	}

	for (const button of document.querySelectorAll(".tab")) {
		button.addEventListener("click", () => {
			clearShareFromAddress();
			showTab(button.dataset.tab);
		});
	}

	// Pasting a share link into a tab that already has the forge open.
	window.addEventListener("hashchange", () => {
		const code = shareCodeInAddress();
		if (code) {
			openSharedBuild(code);
		}
	});

	// ---------- Start ----------

	function formatDate(iso) {
		const date = new Date(iso);
		return isNaN(date) ? iso : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
	}

	load();
	weaponSelect.value = state.weaponSlots.join(",");
	if (weaponSelect.value !== state.weaponSlots.join(",")) {
		weaponSelect.value = "3,3,3";
		state.weaponSlots = [3, 3, 3];
	}
	gogmaBox.checked = state.gogmaWeapon;
	affinityInput.value = String(state.weaponAffinity);
	setupGogmaPanel();
	renderGogmaPanel();
	document.getElementById("data-note").textContent =
		"Game data from the mhdb project, updated " + formatDate(data.version) + ". It includes the final big update (February 2026).";

	showTab(state.tab);
	updateSavedTab();
	renderPopular();
	renderWishes();
	renderQuickPicks();
	renderMyCharms();
	renderOnlineLinks();
	runSearch();

	// Opened from a share link: show that build first.
	const sharedCode = shareCodeInAddress();
	if (sharedCode) {
		openSharedBuild(sharedCode);
	}
})();
