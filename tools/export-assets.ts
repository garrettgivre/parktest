// Writes art/assets.json: every building the game draws, with footprint, zone
// and kind, so the Blender kit (art/build_park.py) always matches the park.
// npm run assets
import { writeFileSync } from "node:fs";
import { DECOR, LANDMARKS, LOCS, ZONES } from "../src/sim/park";

const sign = (name: string) => {
  const words = name.replace(/\(.*?\)/g, "").replace(/[^A-Za-z0-9'&!\- ]/g, "").trim().split(/\s+/);
  let out = "";
  for (const w of words) { if ((out + " " + w).trim().length > 16) break; out = (out + " " + w).trim(); }
  return (out || words[0]).toUpperCase();
};

const assets = [
  ...LOCS.map((l) => ({
    id: l.id, name: l.name, sign: sign(l.name), kind: l.kind, zone: l.zone, w: l.w, d: l.d, h: l.h,
    color: "#" + l.color.toString(16).padStart(6, "0"),
    tags: [l.headliner && "headliner", l.wet && "wet", l.vegan && "vegan", l.outdoor && "outdoor", l.mode].filter(Boolean),
  })),
  ...DECOR.map((d, k) => ({
    id: "decor" + k, name: d.label ?? "storefront", sign: d.label ? sign(d.label) : "", kind: d.label ? "backstage" : d.w < 0.5 || d.h < 0.7 ? "prop" : "storefront",
    zone: d.v > 0 && Math.abs(d.u) < 12 ? "depot" : "backstage", w: d.w, d: d.d, h: d.h,
    color: "#" + d.color.toString(16).padStart(6, "0"), tags: [],
  })),
  ...LANDMARKS.map((m, k) => ({
    id: "landmark" + k, name: m.icon, sign: "", kind: "landmark", zone: m.zone, w: 0.9, d: 0.9, h: m.h,
    color: "#" + m.color.toString(16).padStart(6, "0"), tags: [],
  })),
];
writeFileSync("art/assets.json", JSON.stringify({ zones: Object.fromEntries(Object.entries(ZONES).map(([k, z]) => [k, z.name])), assets }, null, 1));
console.log(`wrote ${assets.length} assets`);
