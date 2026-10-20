// Packs a build into a short code for a share link, and unpacks it again.
// Works in the browser (window.WildsShare) and in Node 18+ (for tests).
//
// The whole build travels inside the link (after "#share="), so nothing is uploaded
// anywhere. The part after # never even reaches the web server.
//
// A link can be edited by anyone, so everything unpacked goes through cleanView():
// only known fields, the right types, and sensible lengths survive. The page shows
// the text with textContent, never as HTML, so a link cannot inject code.

(function (root) {
	"use strict";

	// Size limits for what a shared build may contain.
	const MAX_TEXT = 200;
	const MAX_WEAR_ROWS = 8;
	const MAX_JEWEL_ROWS = 40;
	const MAX_SLOTS = 20;
	const MAX_NOTES = 4;

	// Bytes to text that is safe in a link: A-Z a-z 0-9 - _
	function toBase64Url(bytes) {
		let binary = "";
		for (const b of bytes) {
			binary += String.fromCharCode(b);
		}
		return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	function fromBase64Url(text) {
		const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64 + "===".slice((base64.length + 3) % 4);
		const binary = atob(padded);
		return Uint8Array.from(binary, (c) => c.charCodeAt(0));
	}

	async function runThrough(bytes, transform) {
		const stream = new Blob([bytes]).stream().pipeThrough(transform);
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}

	// "z" + squeezed data when the browser can compress (shorter links), else "j" + plain.
	async function encode(payload) {
		const bytes = new TextEncoder().encode(JSON.stringify(payload));
		if (typeof CompressionStream === "function") {
			try {
				return "z" + toBase64Url(await runThrough(bytes, new CompressionStream("deflate-raw")));
			} catch (error) {
				// fall through to the plain form
			}
		}
		return "j" + toBase64Url(bytes);
	}

	// Throws when the code is broken or cut off; the page then says so.
	async function decode(code) {
		const kind = code.charAt(0);
		let bytes = fromBase64Url(code.slice(1));
		if (kind === "z") {
			bytes = await runThrough(bytes, new DecompressionStream("deflate-raw"));
		} else if (kind !== "j") {
			throw new Error("Unknown share code");
		}
		return JSON.parse(new TextDecoder().decode(bytes));
	}

	function text(value, max) {
		return typeof value === "string" ? value.slice(0, max || MAX_TEXT) : "";
	}

	function slotSizes(list) {
		return (Array.isArray(list) ? list : [])
			.map(Number)
			.filter((s) => s >= 1 && s <= 3)
			.slice(0, MAX_SLOTS);
	}

	// Keeps only what a build view is allowed to hold. Returns null when it is not a build.
	function cleanView(raw) {
		if (!raw || typeof raw !== "object" || !Array.isArray(raw.wear) || !Array.isArray(raw.jewels)) {
			return null;
		}
		return {
			numbers: (Array.isArray(raw.numbers) ? raw.numbers : []).slice(0, 3).map((n) => ({
				label: text(n && n.label, 30),
				value: text(n && n.value, 30),
				sub: text(n && n.sub, 60),
			})),
			situations: text(raw.situations),
			defense: Math.max(0, Math.min(9999, Math.round(Number(raw.defense) || 0))),
			wear: raw.wear.slice(0, MAX_WEAR_ROWS).map((w) => ({
				key: text(w && w.key, 40),
				label: text(w && w.label, 20),
				name: text(w && w.name, 80),
				extra: text(w && w.extra),
				armorSlots: slotSizes(w && w.armorSlots),
				weaponSlots: slotSizes(w && w.weaponSlots),
			})),
			jewels: raw.jewels.slice(0, MAX_JEWEL_ROWS).map((j) => ({
				key: text(j && j.key, 40),
				slot: Math.max(1, Math.min(3, Math.round(Number(j && j.slot) || 1))),
				kind: j && j.kind === "weapon" ? "weapon" : "armor",
				name: text(j && j.name, 80),
				extra: text(j && j.extra),
				needed: !!(j && j.needed),
				gain: text(j && j.gain, 30),
			})),
			leftArmor: slotSizes(raw.leftArmor),
			leftWeapon: slotSizes(raw.leftWeapon),
			notes: (Array.isArray(raw.notes) ? raw.notes : []).slice(0, MAX_NOTES).map((n) => text(n, 300)),
		};
	}

	const api = {
		encode: encode,
		decode: decode,
		cleanView: cleanView,
		text: text,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	} else {
		root.WildsShare = api;
	}
})(typeof window !== "undefined" ? window : globalThis);
