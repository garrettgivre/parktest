// The park: lands, walkable path network and attractions.
//
// Layout is authored in "screen-ish" units (u, v): u runs left->right, v runs
// top->bottom of the isometric view, one unit = half a tile diagonal. Tile coords
// used by the sim are i = (u + v) / 2, j = (v - u) / 2, so screen x = (i - j) * 64
// and screen y = (i + j) * 32 as before. The front gate is at the bottom.

export type LandId = "main" | "world" | "dino" | "space" | "future" | "rave" | "ocean";
export type Kind = "gate" | "ride" | "food" | "restroom" | "shop" | "show" | "relations";

export interface Land {
  id: LandId;
  name: string;
  ground: number;
  box: [number, number, number, number]; // u0, v0, u1, v1
  label: [number, number];
}

export interface PNode { id: string; u: number; v: number; i: number; j: number; land: LandId }

export interface LocDef {
  id: string;
  name: string;
  kind: Kind;
  land: LandId;
  node: string; // door: the path node you stand at to use it
  u: number;
  v: number;
  i: number;
  j: number;
  w: number;
  d: number;
  h: number;
  color: number;
  baseWait?: number;
  rideMin?: number;
  headliner?: boolean;
  wet?: boolean;
  vegan?: boolean;
  shows?: number[];
  showName?: string;
}

export const toIJ = (u: number, v: number) => ({ i: (u + v) / 2, j: (v - u) / 2 });

export const LANDS: Land[] = [
  { id: "main", name: "Main Street", ground: 0xb9a07e, box: [-12, 44, 12, 80], label: [0, 79] },
  { id: "world", name: "Around the World", ground: 0xd8b85e, box: [-46, 40, -12, 74], label: [-30, 56] },
  { id: "dino", name: "Prehistoric", ground: 0x7fae4e, box: [-48, 6, -14, 40], label: [-32, 22] },
  { id: "space", name: "Retro Space", ground: 0x8a7fb8, box: [-14, -4, 16, 24], label: [1, 12] },
  { id: "future", name: "Future Metropolis", ground: 0x8fd6e8, box: [16, 0, 46, 34], label: [32, 18] },
  { id: "rave", name: "Rave", ground: 0xc77fd0, box: [12, 34, 46, 66], label: [30, 50] },
  { id: "ocean", name: "Ocean", ground: 0x6fb3d9, box: [-14, 22, 16, 46], label: [1, 31] },
];

export const LAKE = { u: 1, v: 31, ru: 8, rv: 6 };

const N: [string, number, number, LandId][] = [
  ["G", 0, 74, "main"], ["M1", 0, 66, "main"], ["M2", 0, 58, "main"], ["H", 0, 50, "main"],
  ["A1", -14, 56, "world"], ["A2", -26, 62, "world"], ["A3", -32, 50, "world"], ["A4", -20, 46, "world"],
  ["P1", -24, 36, "dino"], ["P2", -34, 26, "dino"], ["P3", -22, 18, "dino"],
  ["S1", -8, 16, "space"], ["S2", 0, 8, "space"], ["S3", 10, 14, "space"],
  ["F1", 22, 22, "future"], ["F2", 30, 12, "future"], ["F3", 36, 26, "future"],
  ["R1", 18, 44, "rave"], ["R2", 32, 40, "rave"], ["R3", 26, 56, "rave"],
  ["O1", 0, 41, "ocean"], ["O2", -11, 31, "ocean"], ["O3", 12, 31, "ocean"],
];

const E: [string, string][] = [
  ["G", "M1"], ["M1", "M2"], ["M2", "H"], ["H", "O1"], ["H", "A1"], ["H", "R1"], ["M2", "R3"],
  ["A1", "A2"], ["A2", "A3"], ["A3", "A4"], ["A4", "A1"],
  ["A4", "P1"], ["P1", "P2"], ["P2", "P3"], ["P3", "P1"],
  ["P3", "S1"], ["O2", "P1"], ["O2", "S1"], ["O1", "O2"], ["O1", "O3"],
  ["S1", "S2"], ["S2", "S3"], ["O3", "S3"],
  ["S3", "F1"], ["F1", "F2"], ["F2", "F3"], ["F3", "F1"], ["O3", "F1"],
  ["F3", "R2"], ["R1", "R2"], ["R2", "R3"], ["R3", "R1"], ["O3", "R1"],
];

// [id, name, kind, land, node, u, v, w, d, h, color, extras]
type L = [string, string, Kind, LandId, string, number, number, number, number, number, number, Partial<LocDef>?];
const L_: L[] = [
  // Main Street
  ["gate", "Front Gate", "gate", "main", "G", 4.5, 75, 1.6, 1.6, 1.3, 0xc0392b],
  ["relations", "Guest Relations", "relations", "main", "G", -4.5, 75, 1.6, 1.4, 1.1, 0x2980b9],
  ["depot", "Union Depot Emporium", "shop", "main", "M1", -6.5, 66, 3, 2, 1.4, 0x8e44ad],
  ["bbq", "Burnt End Barbecue", "food", "main", "M1", 6.5, 65, 2.4, 2, 1.2, 0x9c4f2a],
  ["soda", "Soda Fountain", "food", "main", "M2", -6, 58, 1.8, 1.8, 1.1, 0xe58fa0],
  ["wc_main", "Main St. Restrooms", "restroom", "main", "M2", 5, 57.5, 1.2, 1.2, 0.8, 0x5d6d7e],
  ["barn", "Scare Barn", "ride", "main", "H", 8, 50, 2.4, 2.4, 1.6, 0x6e2c00, { baseWait: 30, rideMin: 8 }],
  // Around the World
  ["carousel", "Grand Carousel", "ride", "world", "A1", -14, 62, 2, 2, 1.2, 0xf4d03f, { baseWait: 10, rideMin: 4 }],
  ["balloon", "Balloon Race 'Round the World", "ride", "world", "A2", -28, 67, 2.6, 2.6, 1.8, 0xe67e22, { baseWait: 25, rideMin: 4 }],
  ["globalbites", "Global Bites Food Hall", "food", "world", "A3", -38, 50, 3, 2.4, 1.2, 0xd35400, { vegan: true }],
  ["bazaar", "Passport Bazaar", "shop", "world", "A4", -22, 41.5, 2, 1.6, 1.1, 0xaf7ac5],
  ["wc_world", "World Restrooms", "restroom", "world", "A2", -21, 60, 1.2, 1.2, 0.8, 0x5d6d7e],
  ["teacups", "Teacups of Europa", "ride", "world", "A4", -13, 48, 2, 2, 0.8, 0x76d7c4, { baseWait: 15, rideMin: 3 }],
  // Prehistoric
  ["raptor", "Raptor Run", "ride", "dino", "P2", -40, 26, 3, 2.4, 1.4, 0x27ae60, { baseWait: 20, rideMin: 2 }],
  ["trex", "T-Rex Trek", "ride", "dino", "P3", -24, 12, 3, 3, 1.9, 0x1e8449, { baseWait: 35, rideMin: 7, headliner: true }],
  ["bronto", "Bronto Burgers", "food", "dino", "P1", -30, 38, 2, 2, 1, 0xa04000],
  ["fossil", "Fossil Dig", "ride", "dino", "P1", -18, 30, 2.4, 2.4, 0.4, 0xc9a66b, { baseWait: 5, rideMin: 15 }],
  ["wc_dino", "Dino Restrooms", "restroom", "dino", "P2", -32, 20.5, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Retro Space
  ["rocket", "Rocket 88", "ride", "space", "S2", 0, 2, 4, 3, 2.4, 0xc0392b, { baseWait: 50, rideMin: 3, headliner: true }],
  ["satellite", "Satellite Spinner", "ride", "space", "S1", -13, 11, 2, 2, 1.6, 0x5dade2, { baseWait: 20, rideMin: 3 }],
  ["starlight", "Starlight Theater", "show", "space", "S3", 15, 8, 2.6, 2, 1.1, 0x34495e, { shows: [15 * 60, 18 * 60], showName: "Pumpkin Revue" }],
  ["lunar", "Lunar Lunch", "food", "space", "S1", -2, 19, 2, 1.8, 1, 0x7d3c98],
  ["wc_space", "Space Restrooms", "restroom", "space", "S3", 5, 12.5, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Future Metropolis
  ["aero", "AeroGlide", "ride", "future", "F2", 32, 5, 4, 3, 2.5, 0x3498db, { baseWait: 55, rideMin: 3, headliner: true }],
  ["bubble", "Bubble Pods", "ride", "future", "F3", 42, 27, 2, 2, 1.4, 0xaed6f1, { baseWait: 20, rideMin: 4 }],
  ["cloud", "Cloud Café", "food", "future", "F1", 21, 15.5, 2, 2, 1.2, 0xd6eaf8, { vegan: true }],
  ["wc_future", "Future Restrooms", "restroom", "future", "F1", 28, 25, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Rave
  ["glitter", "Glitter Drop", "ride", "rave", "R2", 38, 40, 1.6, 1.6, 3.2, 0xff66cc, { baseWait: 35, rideMin: 2, headliner: true }],
  ["inferno", "Disco Inferno", "ride", "rave", "R1", 17, 37.5, 2.2, 2.2, 1, 0xe74c3c, { baseWait: 20, rideMin: 3 }],
  ["mirrorball", "Club Mirrorball", "show", "rave", "R3", 33, 57, 3, 2.4, 1.3, 0x9b59b6, { shows: [20 * 60], showName: "Disco Diva Revue" }],
  ["neon", "Neon Snack Shack", "food", "rave", "R1", 23, 49, 1.8, 1.6, 1, 0x1abc9c, { vegan: true }],
  ["wc_rave", "Rave Restrooms", "restroom", "rave", "R2", 31, 46, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Ocean
  ["riptide", "Riptide Flume", "ride", "ocean", "O2", -9, 37, 2.8, 1.8, 1, 0x16a085, { baseWait: 25, rideMin: 6, wet: true }],
  ["leviathan", "Leviathan", "ride", "ocean", "O3", 11, 37, 3, 2.4, 2, 0x2471a3, { baseWait: 40, rideMin: 4, headliner: true, wet: true }],
  ["swings", "Sea Swings", "ride", "ocean", "O1", 6, 41.5, 1.8, 1.8, 1.6, 0x48c9b0, { baseWait: 15, rideMin: 3 }],
  ["shrimp", "Shipwreck Shrimp Shack", "food", "ocean", "O1", -6, 43, 2, 1.6, 1, 0x935116],
  ["wc_ocean", "Ocean Restrooms", "restroom", "ocean", "O2", -15, 27, 1.2, 1.2, 0.8, 0x5d6d7e],
];

export const NODES: Record<string, PNode> = {};
for (const [id, u, v, land] of N) NODES[id] = { id, u, v, land, ...toIJ(u, v) };

export const ADJ: Record<string, { to: string; len: number }[]> = {};
for (const id of Object.keys(NODES)) ADJ[id] = [];
for (const [a, b] of E) {
  const len = Math.hypot(NODES[a].i - NODES[b].i, NODES[a].j - NODES[b].j);
  ADJ[a].push({ to: b, len });
  ADJ[b].push({ to: a, len });
}
export const EDGES = E;

// Staff-only service roads: the worker (and Brad) can cut through backstage.
export const SERVICE: [string, string][] = [["M1", "A1"], ["G", "R3"], ["P2", "A3"], ["S2", "F2"], ["O2", "A4"]];
export const ADJ_STAFF: Record<string, { to: string; len: number }[]> = {};
for (const id of Object.keys(ADJ)) ADJ_STAFF[id] = [...ADJ[id]];
for (const [a, b] of SERVICE) {
  const len = Math.hypot(NODES[a].i - NODES[b].i, NODES[a].j - NODES[b].j);
  ADJ_STAFF[a].push({ to: b, len });
  ADJ_STAFF[b].push({ to: a, len });
}

export const LOCS: LocDef[] = L_.map(([id, name, kind, land, node, u, v, w, d, h, color, x]) => ({
  id, name, kind, land, node, u, v, w, d, h, color, ...toIJ(u, v), ...(x ?? {}),
}));
export const LOC: Record<string, LocDef> = Object.fromEntries(LOCS.map((l) => [l.id, l]));
export const LAND: Record<LandId, Land> = Object.fromEntries(LANDS.map((l) => [l.id, l])) as Record<LandId, Land>;

/** Shortest path between nodes (Dijkstra). Blocked nodes can't be passed through. */
export function shortest(from: string, to: string, blocked: Set<string> = new Set(), staff = false) {
  const adj = staff ? ADJ_STAFF : ADJ;
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const open = new Set([from]);
  while (open.size) {
    let cur = "", best = Infinity;
    for (const n of open) if (dist[n] < best) { best = dist[n]; cur = n; }
    open.delete(cur);
    if (cur === to) break;
    for (const { to: nb, len } of adj[cur]) {
      if (blocked.has(nb) && nb !== to) continue;
      const d = best + len;
      if (d < (dist[nb] ?? Infinity)) { dist[nb] = d; prev[nb] = cur; open.add(nb); }
    }
  }
  if (dist[to] === undefined) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return { path, len: dist[to] };
}
