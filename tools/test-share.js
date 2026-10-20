// Checks share links: a build packed into a link comes back the same, and a broken
// or tampered link is caught instead of showing junk.
//   node tools/test-share.js
// Prints PASS/FAIL per check and exits with an error code if anything fails.

const Share = require("../share.js");

let failures = 0;
function check(name, ok, detail) {
	console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : ""));
	if (!ok) {
		failures += 1;
	}
}

// A realistic build, shaped like the page's buildView().
const view = {
	numbers: [
		{ label: "Crit chance", value: "42%", sub: "crits hit +25%" },
		{ label: "Attack", value: "+29 & +34%", sub: "from skills" },
		{ label: "Damage", value: "+64%", sub: "vs no skills" },
	],
	situations: "weak points, enraged monster, low health",
	defense: 430,
	wear: [
		{ key: "weapon", label: "Weapon", name: "Gogma Long Sword", extra: "Thunder · adds Lord's Soul", armorSlots: [], weaponSlots: [3, 3, 3] },
		{ key: "piece-1", label: "Head", name: "Orion Cap α", extra: "", armorSlots: [3, 3, 1], weaponSlots: [] },
		{ key: "piece-2", label: "Chest", name: "Udra Miremail γ", extra: "", armorSlots: [3, 3], weaponSlots: [] },
		{ key: "charm", label: "Charm", name: "attak/blessing", extra: "your own charm", armorSlots: [1, 1], weaponSlots: [1] },
	],
	jewels: [
		{ key: "need-5", slot: 2, kind: "armor", name: "Potential Jewel", extra: "In Orion Cap α · for Heroics", needed: true, gain: "" },
		{ key: "extra-9", slot: 3, kind: "armor", name: "4× Challenger Jewel", extra: "In Orion Cap α ×2, Udra Miremail γ ×2 · Agitator 1 → 5", needed: false, gain: "+13% damage" },
		{ key: "extra-12", slot: 1, kind: "weapon", name: "Critical Jewel", extra: "In attak/blessing (charm) · Critical Boost 0 → 1", needed: false, gain: "+2% damage" },
	],
	leftArmor: [2, 1],
	leftWeapon: [],
	notes: ["Your Gogma weapon needs set bonus Gore Magala's Tyranny."],
};
const payload = { v: 1, name: "Heroics 5 · Agitator 5", targets: [{ skillId: 87, level: 5 }], view: view };

(async () => {
	const code = await Share.encode(payload);
	check("a build packs into link-safe characters", /^[zj][A-Za-z0-9_-]+$/.test(code), code.length + " characters");
	check("the packed build is squeezed (short link)", code.startsWith("z") && code.length < 1200, code.length + " characters");

	const back = await Share.decode(code);
	check("unpacking gives the same build back", JSON.stringify(back) === JSON.stringify(payload));
	check("α, γ, × and → survive the trip", back.view.wear[1].name === "Orion Cap α" && back.view.jewels[1].extra.includes("→"));
	check("a clean build passes cleanView unchanged", JSON.stringify(Share.cleanView(back.view)) === JSON.stringify(view));

	// Broken links must fail loudly so the page can say "this link is broken".
	let cutOffFailed = false;
	try {
		await Share.decode(code.slice(0, Math.floor(code.length / 2)));
	} catch (error) {
		cutOffFailed = true;
	}
	check("a cut-off link is caught", cutOffFailed);
	let junkFailed = false;
	try {
		await Share.decode("q-not-a-build");
	} catch (error) {
		junkFailed = true;
	}
	check("a made-up link is caught", junkFailed);

	// Tampered content: wrong types, extra fields, huge values.
	const tampered = Share.cleanView({
		numbers: [{ label: "<b>x</b>", value: 5, sub: null, evil: "y" }],
		defense: "99999999",
		wear: [{ name: "A".repeat(500), armorSlots: [3, 9, -1, "2"], weaponSlots: "nope", onclick: "alert(1)" }],
		jewels: [{ slot: 7, kind: "script", name: "Jewel" }],
		notes: "not a list",
		secret: "dropped",
	});
	check("unknown fields are dropped", !("secret" in tampered) && !("onclick" in tampered.wear[0]) && !("evil" in tampered.numbers[0]));
	check("text is kept as plain text (shown with textContent, never as HTML)", tampered.numbers[0].label === "<b>x</b>");
	check("wrong types become empty", tampered.numbers[0].value === "" && tampered.wear[0].weaponSlots.length === 0 && tampered.notes.length === 0);
	check("long text is cut short", tampered.wear[0].name.length === 80);
	check("slot sizes outside 1-3 are dropped", tampered.wear[0].armorSlots.join(",") === "3,2");
	check("a jewel slot is kept between 1 and 3", tampered.jewels[0].slot === 3);
	check("a jewel's kind is armor or weapon only", tampered.jewels[0].kind === "armor");
	check("defense is capped", tampered.defense === 9999);
	check("something that is not a build is refused", Share.cleanView({ hello: 1 }) === null && Share.cleanView(null) === null);

	console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) failed.");
	process.exit(failures === 0 ? 0 : 1);
})();
