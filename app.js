// The page: wish list on the left, found sets on the right, popular builds on a second tab.
// All the searching happens in solver.js; this file only shows things and reacts to clicks.

(function () {
	"use strict";

	const data = window.WILDS_DATA;
	const popular = window.WILDS_POPULAR;
	const effects = window.WILDS_EFFECTS;
	const Solver = window.WildsSolver;
	const Stats = window.WildsStats;
	const index = Solver.makeIndex(data);
	const SITUATION_LABEL = Object.fromEntries(effects.situations.map((s) => [s.id, s.label]));

	const STORAGE_KEY = "wilds-build-forge-v1";
	const RESULTS_SHOWN_AT_FIRST = 3;
	const SUGGESTION_LIMIT = 8;
	const ARMOR_PIECES_SHOWN = 8;
	// Wait this long after the last click before searching, so fast clicking stays smooth.
	const SEARCH_DELAY_MS = 120;

	const QUICK_PICKS = ["Heroics", "Weakness Exploit", "Agitator", "Lord's Soul", "Burst", "Critical Boost", "Divine Blessing"];
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
		situations: effects.defaultSituations.slice(), // fight situations switched on
		openInfo: null, // skill id whose "where to get it" is open
		showAll: false,
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
			state.tab = saved.tab === "popular" ? "popular" : "build";
			state.targets = saved.targets.filter((t) => index.skillById.has(t.skillId));
			state.weaponSlots = Array.isArray(saved.weaponSlots) ? saved.weaponSlots : [3, 3, 3];
			state.gogmaWeapon = saved.gogmaWeapon !== false;
			state.weaponAffinity = Number(saved.weaponAffinity) || 0;
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
		state.showAll = false;
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
		box.replaceChildren(el("span", { class: "label", text: "Try" }));
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
						kindTag(skill),
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
				el("span", { class: "muted", text: "· " + PIECE_LABEL[entry.piece.kind] + (isCount ? "" : " · level " + entry.level) }),
				slotBadges(entry.piece.slots),
			])));
			parts.push(el("ul", {}, listItems));
			if (pieces.length > ARMOR_PIECES_SHOWN) {
				const rest = pieces.slice(ARMOR_PIECES_SHOWN).map((entry) => entry.piece.name + (isCount ? "" : " (" + entry.level + ")"));
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
		changed();
	});

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
				"Build around this charm (every set uses it)",
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
		lastAnswer = Solver.findSets(index, {
			targets: state.targets,
			weaponSlots: state.weaponSlots,
			gogmaWeapon: state.gogmaWeapon,
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

	function renderResults() {
		const status = document.getElementById("status");
		const list = document.getElementById("results");
		const more = document.getElementById("more-results");
		list.replaceChildren();
		more.replaceChildren();
		document.getElementById("situations").replaceChildren();

		if (!lastAnswer) {
			status.className = "status muted";
			status.textContent = "Add a skill in step 1 and sets show up here.";
			return;
		}

		const answer = lastAnswer;
		const count = answer.results.length;
		if (count === 0) {
			status.className = "status warn";
			status.textContent = answer.timedOut
				? "No set found after 3 seconds of trying. Five armor pieces probably cannot hold all of this. Lower a level or remove a skill."
				: "No armor combination reaches all of these skills. Lower a level or remove a skill and it will try again.";
		} else {
			status.className = "status";
			status.textContent = (count === 1 ? "1 set" : count + " sets") + " reach every armor skill" +
				(answer.timedOut ? " (best found in 3 seconds)." : ". Sets with the most free jewel slots come first.");
		}

		const shown = state.showAll ? answer.results : answer.results.slice(0, RESULTS_SHOWN_AT_FIRST);
		const visible = visibleSituations(shown);
		// A switch that is not on screen must not change anything, so only count visible ones.
		const situationsOn = new Set(state.situations.filter((id) => visible.has(id)));
		renderSituations(document.getElementById("situations"), visible);

		shown.forEach((result, i) => {
			const analysis = analyseSet(result, situationsOn);
			list.appendChild(resultCard(analysis, i));
		});

		if (count > RESULTS_SHOWN_AT_FIRST) {
			more.appendChild(el("button", {
				type: "button", class: "btn",
				text: state.showAll ? "Show fewer" : "Show " + (count - RESULTS_SHOWN_AT_FIRST) + " more sets",
				onclick: () => {
					state.showAll = !state.showAll;
					renderResults();
				},
			}));
		}
	}

	function jewelChip(entry) {
		// The slot badge already shows the size, so drop the "[2]" from the name.
		const name = entry.deco.name.replace(/\s*\[\d\]$/, "");
		return el("span", { class: "jewel" }, [slotBadges([entry.deco.slot], entry.deco.kind), (entry.count > 1 ? entry.count + "× " : "") + name]);
	}

	// Armor and weapon jewels look alike, so say where each one goes.
	function taggedJewel(entry) {
		return el("span", { class: "jewel" }, [
			el("span", { class: "where-tag", text: entry.deco.kind === "weapon" ? "Weapon" : "Armor" }),
			jewelChip(entry),
		]);
	}

	// ---------- Step 2: fight situations and damage numbers ----------

	// Situations worth a switch: the common ones, the ones your wished skills
	// are built for, and the ones the shown sets' skills use.
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

	function renderSituations(box, visible) {
		box.appendChild(el("span", { class: "label", text: "Fight situation" }));
		box.appendChild(el("p", { class: "hint", text: "Tap to switch on or off. The damage numbers and smart jewels below follow." }));
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
		box.appendChild(row);
	}

	// Everything one set card needs: skill levels, numbers before and after smart jewels.
	// Free weapon slots come with the set, because your own charm can add one.
	function analyseSet(result, situationsOn) {
		const totals = Solver.totalSkills(index, result).filter((e) => e.level > 0);
		const levels = new Map(totals.map((e) => [e.skill.id, e.level]));
		return {
			result: result,
			totals: totals,
			before: Stats.computeStats(index, effects, levels, situationsOn, state.weaponAffinity),
			smart: Stats.suggestJewels(index, effects, levels, result.freeSlots, result.freeWeaponSlots, situationsOn, state.weaponAffinity),
		};
	}

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

	function statTile(label, value, sub) {
		return el("div", { class: "stat" }, [
			el("span", { class: "label", text: label }),
			el("span", { class: "stat-value", text: value }),
			sub ? el("span", { class: "stat-sub", text: sub }) : null,
		]);
	}

	function statTiles(stats) {
		let affinitySub = state.weaponAffinity ? "includes weapon " + state.weaponAffinity + "%" : "";
		if (stats.affinity > 100) {
			affinitySub = stats.affinity + "% total, the game stops at 100%";
		}
		return el("div", { class: "stat-tiles" }, [
			statTile("Affinity (crit chance)", stats.affinityShown + "%", affinitySub),
			statTile("Crit hits", "+" + stats.critDamage + "%", stats.critDamage > Stats.BASE_CRIT_DAMAGE ? "normal is +25%" : "normal crit"),
			statTile("Attack", attackText(stats), "from skills"),
			statTile("Raw damage", percent(stats.damageGain), "compared to no skills"),
		]);
	}

	function effectText(line) {
		const parts = [];
		if (line.attack) {
			parts.push("+" + line.attack + " attack");
		}
		if (line.attackPct) {
			parts.push("+" + line.attackPct + "% attack");
		}
		if (line.affinity) {
			parts.push("+" + line.affinity + "% affinity");
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
		const children = [rows.length ? el("ul", { class: "lines" }, rows) : el("p", { class: "muted", text: "No skills here change attack or affinity." })];
		if (stats.uncounted.length) {
			children.push(el("p", { class: "muted" },
				"Not in the numbers: " + stats.uncounted.map((s) => s.name).join(", ") +
				". They do add damage, but the game gives no exact number, it depends on the weapon, or it is element damage."));
		}
		children.push(el("p", { class: "muted" },
			"Raw damage is an estimate for a typical endgame weapon (" + Stats.TYPICAL_WEAPON_ATTACK + " attack). Element damage comes on top."));
		return children;
	}

	function levelChange(entry) {
		return entry.deco.skills.map((pair) => {
			const skill = index.skillById.get(pair[0]);
			return skill.name + " " + (entry.from.get(pair[0]) || 0) + " → " + entry.to.get(pair[0]);
		}).join(", ");
	}

	function smartJewels(analysis) {
		const smart = analysis.smart;
		const children = [];
		if (smart.picks.length) {
			// Biggest gain on top, so the most worthwhile jewel is the first one you read.
			const byGain = smart.picks.slice().sort((a, b) => b.gain - a.gain);
			children.push(el("ul", { class: "smart-list" }, byGain.map((entry) => el("li", {}, [
				taggedJewel(entry),
				el("span", { class: "muted", text: levelChange(entry) }),
				el("span", { class: "gain", text: percent(entry.gain) }),
			]))));
		}
		const left = smart.leftArmorSlots.concat(smart.leftWeaponSlots);
		if (!smart.picks.length && !left.length) {
			children.push(el("p", { class: "muted", text: "No free slots left." }));
		} else if (left.length) {
			children.push(el("p", { class: "muted" }, [
				smart.picks.length ? "Still free: " : "Free: ",
				mixedSlotBadges(smart.leftArmorSlots, smart.leftWeaponSlots),
				" Nothing adds damage there in the switched-on situations. Switch on more above, or use them for comfort skills like Divine Blessing or Evade Window.",
			]));
		}
		return children;
	}

	// The jewels the wish list needs: armor ones, weapon ones, and any weapon skill
	// that does not fit at all.
	function neededJewels(result) {
		const all = result.jewels.concat(result.weapon.jewels);
		return el("div", { class: "weapon-box" }, [
			el("span", { class: "label", text: "Jewels you need for your skills" }),
			all.length
				? el("div", { class: "jewel-list" }, all.map(taggedJewel))
				: el("span", { class: "muted", text: "None needed. The armor and charm already do it." }),
			result.weapon.missing.length
				? el("p", { class: "note" },
					"Your weapon slots cannot hold everything. Still missing: " +
					result.weapon.missing.map((m) => m.skill.name + " +" + m.levels).join(", ") +
					". Pick a weapon that has these skills built in.")
				: null,
		]);
	}

	function resultCard(analysis, position) {
		const result = analysis.result;
		const smart = analysis.smart;
		const wanted = new Set(state.targets.map((t) => t.skillId));
		const rows = result.pieces.map((piece) => el("tr", {}, [
			el("td", { class: "slot-kind label", text: PIECE_LABEL[piece.kind] }),
			el("td", {}, el("span", { class: "piece-name", text: piece.name })),
			el("td", { class: "slot-cell" }, slotBadges(piece.slots)),
		]));
		const charm = result.charm;
		rows.push(el("tr", {}, [
			el("td", { class: "slot-kind label", text: "Charm" }),
			el("td", {}, charm
				? el("span", { class: "row" }, [
					el("span", { class: "piece-name", text: charm.name }),
					charm.custom ? el("span", { class: "kind mine", text: "Yours" }) : null,
				])
				: el("span", { class: "muted", text: "Any charm you like" })),
			el("td", { class: "slot-cell" }, charm && charm.custom
				? mixedSlotBadges(charm.armorSlots, charm.weaponSlots)
				: null),
		]));

		// All skills, counting the smart jewels. Set bonuses keep their piece count.
		const totals = analysis.totals.map((entry) => Solver.isPieceCountSkill(entry.skill)
			? entry
			: { skill: entry.skill, level: smart.levels.get(entry.skill.id) || entry.level });
		for (const [skillId, level] of smart.levels) {
			if (!totals.some((entry) => entry.skill.id === skillId)) {
				totals.push({ skill: index.skillById.get(skillId), level: level });
			}
		}
		totals.sort((a, b) => (wanted.has(b.skill.id) ? 1 : 0) - (wanted.has(a.skill.id) ? 1 : 0) || b.level - a.level);

		const chips = totals.map((entry) => {
			const isCount = Solver.isPieceCountSkill(entry.skill);
			const rank = entry.skill.ranks.find((r) => r.level === entry.level);
			return el("span", { class: "skill-chip" + (wanted.has(entry.skill.id) ? " wanted" : "") }, [
				isCount && rank ? entry.skill.name + ": " + rank.name : entry.skill.name,
				isCount
					? el("span", { class: "lv", text: entry.pieces + " pc" })
					: staticPips(entry.level, Solver.maxLevel(entry.skill)),
			]);
		});

		const bonusNeeded = [result.weaponBonus.set, result.weaponBonus.group].filter(Boolean);

		return el("article", { class: "result" + (position === 0 ? " best" : "") }, [
			el("div", { class: "result-head" }, [
				el("h3", { text: "Set " + (position + 1) }),
				position === 0 ? el("span", { class: "badge-best", text: "Best fit" }) : null,
				el("span", { class: "facts" }, [
					el("span", {}, ["Defense ", el("b", { text: String(result.defense) })]),
					el("span", {}, ["Free slots ", result.freeSlots.length || result.freeWeaponSlots.length
						? mixedSlotBadges(result.freeSlots, result.freeWeaponSlots)
						: el("b", { text: "none" })]),
				]),
			]),
			el("div", { style: "overflow-x:auto" }, el("table", { class: "pieces" }, el("tbody", {}, rows))),
			neededJewels(result),
			bonusNeeded.length
				? el("p", { class: "note" }, "Needs a Gogma Artian weapon that adds " +
					bonusNeeded.map((s) => s.name).join(" and ") + ".")
				: null,
			el("section", { class: "block" }, [
				el("span", { class: "label", text: "Damage, with the smart jewels" }),
				statTiles(smart.stats),
				smart.picks.length
					? el("p", { class: "muted small" },
						"Without the smart jewels: affinity " + analysis.before.affinityShown + "%, attack " +
						attackText(analysis.before) + ", raw damage " + percent(analysis.before.damageGain) + ".")
					: null,
				el("details", { class: "more" }, [
					el("summary", { text: "Where the numbers come from" }),
					el("div", { class: "breakdown" }, breakdown(smart.stats)),
				]),
			]),
			el("section", { class: "block" }, [
				el("span", { class: "label", text: "Smart jewels for the free slots" }),
				el("p", { class: "hint", text: "Picked one by one for the most damage in the switched-on situations." }),
				...smartJewels(analysis),
			]),
			el("details", { class: "more", open: position === 0 ? true : null }, [
				el("summary", { text: "All skills, with smart jewels (" + totals.length + ")" }),
				el("div", { class: "skill-chips" }, chips),
			]),
		]);
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
		box.appendChild(el("button", { type: "button", class: "btn small", text: "Popular builds", onclick: () => showTab("popular") }));
	}

	// ---------- Popular builds tab ----------

	function renderPopular() {
		document.getElementById("popular-intro").textContent =
			"What players run right now, one build per weapon (checked " + popular.checked + "). " +
			"Tap \"Use these skills\" and the forge works out the armor for you.";

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
					type: "button", class: "btn primary small", text: "Use these skills",
					onclick: () => {
						state.targets = known.map((s) => ({ skillId: s.skill.id, level: Math.min(s.level, Solver.maxLevel(s.skill)) }));
						known.forEach((s) => switchOnSituationFor(s.skill));
						state.openInfo = null;
						state.showAll = false;
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

	function showTab(tab) {
		state.tab = tab;
		save();
		for (const button of document.querySelectorAll(".tab")) {
			button.setAttribute("aria-selected", button.dataset.tab === tab ? "true" : "false");
		}
		document.getElementById("view-build").hidden = tab !== "build";
		document.getElementById("view-popular").hidden = tab !== "popular";
	}

	for (const button of document.querySelectorAll(".tab")) {
		button.addEventListener("click", () => showTab(button.dataset.tab));
	}

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
	document.getElementById("data-note").textContent =
		"Game data from the mhdb project, updated " + formatDate(data.version) + ". It includes the final big update (February 2026).";

	showTab(state.tab);
	renderPopular();
	renderWishes();
	renderQuickPicks();
	renderMyCharms();
	renderOnlineLinks();
	runSearch();
})();
