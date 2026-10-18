// The park: zones (7 lands + 7 blend zones in a ring around the lagoon), the
// walkable path network, the train and skyride, and all attractions.
//
// Layout is authored in "screen-ish" units (u, v): u runs left->right, v runs
// top->bottom of the isometric view. Tile coords used by the sim are
// i = (u + v) / 2, j = (v - u) / 2, so screen x = (i - j) * 64 and
// screen y = (i + j) * 32. The front gate and parking lot are at the bottom.
//
// Naming rule: every joke is aimed at the park's owners (cheapness, sponsors,
// rebrands, over-promising), never at the cultures or people being themed.
// See docs/research.md.

export type LandId = "depot" | "passport" | "fossil" | "atomic" | "aero" | "mirrorball" | "lagoon";
export type BlendId = "expo" | "bonewars" | "extinction" | "mall" | "y2k" | "foam" | "ozark";
export type ZoneId = LandId | BlendId | "hub" | "lot";
export type Kind =
  | "gate" | "ride" | "food" | "restroom" | "shop" | "show" | "relations" | "station" | "game" | "photo";
export type Mode = "foot" | "train" | "sky";

export interface Zone {
  id: ZoneId;
  name: string;
  kind: "land" | "blend" | "hub" | "lot";
  parents?: [LandId, LandId];
  ground: number;
  angle?: number; // ring centre, degrees (0 = right, 90 = down/front)
  span?: number;
  blurb: string;
}

export interface PNode { id: string; u: number; v: number; i: number; j: number; zone: ZoneId }

export interface LocDef {
  id: string;
  name: string;
  sub?: string; // honest subtitle, shown in the panel
  kind: Kind;
  zone: ZoneId;
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
  outdoor?: boolean;
  wet?: boolean;
  vegan?: boolean;
  shows?: number[];
  showName?: string;
  mode?: Mode; // stations: which transport
  coaster?: boolean; // draw a track loop
  wheel?: boolean; // draw a Ferris wheel
}

export const toIJ = (u: number, v: number) => ({ i: (u + v) / 2, j: (v - u) / 2 });

// ------------------------------------------------------------------ geometry
//
// The park is a lumpy loop around an irregular lagoon, not a circle: lands get
// more or less room by importance, the promenade bends, headliners sit at the
// end of their own paths, and the outline wobbles like a real property line.

export const CENTER = { u: 0, v: 52 };
const R0 = 40;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance from the park centre to the promenade in a direction (u units). */
export function shapeR(deg: number) {
  const t = rad(deg);
  return R0 * (1 + 0.11 * Math.sin(2 * t + 0.7) + 0.07 * Math.sin(3 * t + 2.1) + 0.045 * Math.sin(5 * t + 0.3));
}

/** Lagoon shoreline: coves and a point or two. */
export function lagoonR(deg: number) {
  const t = rad(deg);
  return 15.5 * (1 + 0.16 * Math.sin(3 * t + 1) + 0.09 * Math.sin(2 * t + 2.5) + 0.06 * Math.sin(5 * t + 4));
}

/**
 * A point in the park by direction and depth: f = 1 is the promenade, f > 1
 * goes outward (scaled by the outline), f < 1 sits between the shore (0.4)
 * and the promenade.
 */
export const ringPos = (deg: number, f = 1) => {
  const R = shapeR(deg), L = lagoonR(deg);
  const r = f >= 1 ? R * f : L + (R - L) * Math.max(0, (f - 0.4) / 0.6);
  return { u: CENTER.u + r * Math.cos(rad(deg)), v: CENTER.v + r * Math.sin(rad(deg)) };
};

export const LAGOON = { u: CENTER.u, v: CENTER.v };
// Depot Street runs straight down from the front of the loop to the gate.
export const DEPOT_V = Math.round(ringPos(90).v);
export const HUB_V = CENTER.v + lagoonR(90) + 5;
export const GATE_V = DEPOT_V + 30;
export const LOT_V = DEPOT_V + 40;

// Ring order, clockwise on screen starting from the front of the park.
const RING: [ZoneId, string, number, string, number][] = [
  ["depot", "Depot Street", 0xc9ae86, "The front of the park. A Midwest main street: brick, a clock, burnt ends in the air.", 30],
  ["expo", "Exposition Midway", 0xd8b36f, "Turn-of-the-century World's Fair midway. Every game is rigged, allegedly.", 16],
  ["passport", "Passport Plaza", 0xe2c35a, "Pavilions of real places, built by executives who visited some of them. The signage once said “Continent Zone.”", 40],
  ["bonewars", "Bone Wars Basecamp", 0xb8a35e, "Two 1870s paleontologists sabotaging each other forever. Relatable.", 15],
  ["fossil", "Fossil Flats", 0x8fb85a, "The kids' area. Dinosaurs, a dig pit, and the most intense ride in the park by accident.", 36],
  ["extinction", "Extinction Junction", 0x9a8f80, "Where the asteroid hit. Scorched fiberglass, smoke vents, a drop tower.", 14],
  ["atomic", "Atomic Acres", 0x9d8fd0, "The future, as seen from 1958. Rockets, satellites, a theater.", 38],
  ["mall", "Tomorrow Mall", 0xb08fc4, "The future, as seen from 1985. A dying mall with an arcade and a food court.", 13],
  ["aero", "Aero Heights", 0xc6dde4, "The future, as seen from 2008. Glossy glass, bubbles, sky-blue optimism.", 38],
  ["y2k", "Y2K Plaza", 0xb9b7e8, "Glossy bubbles meet dance-pop. A selfie wall. Frosted tips.", 13],
  ["mirrorball", "Mirrorball Mile", 0xd58ad8, "The park's disco, run by the queens who made it. Corporate keeps trying to rename it “Fun Zone C.” They keep losing.", 36],
  ["foam", "Foam Party Pier", 0xc4b9d8, "A foam party on a dock. You will be soaked and deafened.", 14],
  ["lagoon", "Landlocked Lagoon", 0xd8cc9c, "An ocean land, 600 miles from any ocean.", 42],
  ["ozark", "Ozark Boardwalk", 0xa9b98a, "Lake-life energy: a bait shop that sells funnel cake, a party-cove boat.", 15],
];
const PARENTS: Record<BlendId, [LandId, LandId]> = {
  expo: ["depot", "passport"], bonewars: ["passport", "fossil"], extinction: ["fossil", "atomic"],
  mall: ["atomic", "aero"], y2k: ["aero", "mirrorball"], foam: ["mirrorball", "lagoon"], ozark: ["lagoon", "depot"],
};

export const ZONES: Record<ZoneId, Zone> = {} as Record<ZoneId, Zone>;
{
  let a = 90 - RING[0][4] / 2;
  for (const [id, name, ground, blurb, span] of RING) {
    const land = !(id in PARENTS);
    ZONES[id] = {
      id, name, ground, blurb, kind: land ? "land" : "blend", span, angle: a + span / 2,
      parents: land ? undefined : PARENTS[id as BlendId],
    };
    a += span;
  }
  ZONES.hub = { id: "hub", name: "Fountain Circle", kind: "hub", ground: 0xc9ae86, blurb: "The park's central plaza. Kansas City is the City of Fountains. None of these work." };
  ZONES.lot = { id: "lot", name: "Lot Z", kind: "lot", ground: 0x3d3d42, blurb: "You are parked in Lot Z. Lot Z is in a different time zone." };
}
export const RING_IDS = RING.map((r) => r[0]);
export const LANDS = RING_IDS.filter((id) => ZONES[id].kind === "land") as LandId[];

/** How strongly a land's theme (and its area effects) reach into a zone. */
export function strength(land: LandId, zone: ZoneId) {
  if (zone === land) return 1;
  const z = ZONES[zone];
  return z.parents?.includes(land) ? 0.5 : 0;
}

/** Ring neighbours of a zone (for effects centred on a blend). */
export function near(a: ZoneId, b: ZoneId) {
  if (a === b) return 1;
  const ia = RING_IDS.indexOf(a), ib = RING_IDS.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  const d = Math.min((ia - ib + 14) % 14, (ib - ia + 14) % 14);
  return d === 1 ? 0.5 : 0;
}

// ------------------------------------------------------------------ nodes

export const NODES: Record<string, PNode> = {};
const node = (id: string, u: number, v: number, zone: ZoneId) => {
  NODES[id] = { id, u, v, zone, ...toIJ(u, v) };
  return id;
};

/** Which ring zone a direction falls in. */
export function zoneAtAngle(deg: number): ZoneId {
  const d0 = ((deg % 360) + 360) % 360;
  for (const id of RING_IDS) {
    const z = ZONES[id];
    const off = ((d0 - z.angle! + 540) % 360) - 180;
    if (Math.abs(off) <= z.span! / 2) return id;
  }
  return "depot";
}

const BEND = [0.06, -0.07, 0.05, -0.05, 0.08, -0.06, 0.04, -0.08, 0.07, -0.04, 0.05, -0.07, 0.06, -0.05];
const BACK: Partial<Record<LandId, number>> = { passport: 1.4, fossil: 1.36, atomic: 1.42, aero: 1.4, mirrorball: 1.36, lagoon: 1.42 };
// Headliners sit at the end of their own path.
export const SPURS: [LandId, string, number, number][] = [
  ["fossil", "trex", -6, 1.56], ["atomic", "rocket", 0, 1.58], ["aero", "aero", 0, 1.58],
  ["mirrorball", "glitter", -4, 1.58], ["lagoon", "leviathan", 2, 1.58],
];
for (const id of RING_IDS) {
  const z = ZONES[id];
  const p = ringPos(z.angle!);
  node(id, p.u, p.v, id);
  if (z.kind === "land" && id !== "depot") {
    const q = ringPos(z.angle!, BACK[id as LandId] ?? 1.4);
    node(id + "_b", q.u, q.v, id);
  }
}
RING_IDS.forEach((id, k) => {
  const z = ZONES[id], next = ZONES[RING_IDS[(k + 1) % RING_IDS.length]];
  const q = ringPos(z.angle! + z.span! / 2, 1 + BEND[k]);
  node("p" + k, q.u, q.v, z.kind === "blend" ? z.id : next.id);
});
for (const [land, , off, f] of SPURS) {
  const q = ringPos(ZONES[land].angle! + off, f);
  node(land + "_x", q.u, q.v, land);
}
// Depot Street runs straight down from the promenade to the gate.
node("depot_b", 0, DEPOT_V + 12, "depot");
node("hub", 0, HUB_V, "hub");
node("island", 0, CENTER.v, "hub");
node("gate", 0, GATE_V, "depot");
node("lot", 0, LOT_V, "lot");

// Train: a loop of track outside the ring with three stations.
const TRACK_F = 1.74;
const TRACK_STEPS = 28;
const STATIONS: Record<number, string> = {};
{
  // Snap three stations to the track step nearest each land's centre.
  for (const land of ["depot", "fossil", "aero"] as LandId[]) {
    const k = Math.round(((ZONES[land].angle! % 360) / 360) * TRACK_STEPS) % TRACK_STEPS;
    STATIONS[k] = land;
  }
  for (let k = 0; k < TRACK_STEPS; k++) {
    const p = ringPos((k / TRACK_STEPS) * 360, TRACK_F);
    // Depot Street's station sits just inside the gate.
    if (STATIONS[k] === "depot") { p.u = 0; p.v = DEPOT_V + 22; }
    node("t" + k, p.u, p.v, zoneAtAngle((k / TRACK_STEPS) * 360));
  }
}

// Edges. Each has a travel mode; "foot" edges are walkable.
type E = [string, string, Mode?];
const EDGES_: E[] = [];
for (let k = 0; k < RING_IDS.length; k++) EDGES_.push([RING_IDS[k], "p" + k], ["p" + k, RING_IDS[(k + 1) % RING_IDS.length]]);
for (const [land] of SPURS) EDGES_.push([land + "_b", land + "_x"]);
for (const id of LANDS) {
  if (id === "depot") continue;
  const k = RING_IDS.indexOf(id);
  const prev = RING_IDS[(k + 13) % 14], next = RING_IDS[(k + 1) % 14];
  EDGES_.push([id, id + "_b"], [prev, id + "_b"], [next, id + "_b"]);
}
EDGES_.push(
  ["depot", "depot_b"], ["depot_b", "t" + Object.keys(STATIONS).find((k) => STATIONS[+k] === "depot")], ["t" + Object.keys(STATIONS).find((k) => STATIONS[+k] === "depot"), "gate"],
  ["gate", "lot"],
  ["hub", "depot"], ["hub", "expo"], ["hub", "ozark"],
  ["hub", "island"], ["island", "mall"], // the footbridge across the lagoon
);
for (const [k, land] of Object.entries(STATIONS)) if (land !== "depot") EDGES_.push(["t" + k, land + "_b"]);
for (let k = 0; k < TRACK_STEPS; k++) EDGES_.push(["t" + k, "t" + ((k + 1) % TRACK_STEPS), "train"]);
EDGES_.push(["bonewars", "mirrorball", "sky"]);

export const EDGES = EDGES_.map(([a, b, m]) => ({ a, b, mode: (m ?? "foot") as Mode }));
export const BRIDGES = [["hub", "island"], ["island", "mall"]];
export const STATION_NODES = Object.keys(STATIONS).map((k) => "t" + k);

// Staff-only service roads behind the ring: you and Brad can cut through backstage.
export const SERVICE: [string, string][] = [
  ["depot_b", "passport_b"], ["fossil_b", "atomic_b"], ["aero_b", "mirrorball_b"], ["lagoon_b", "depot_b"],
  ["passport_b", "fossil_b"], ["atomic_b", "aero_b"], ["mirrorball_b", "lagoon_b"],
];

export interface Link { to: string; len: number; mode: Mode }
export const ADJ: Record<string, Link[]> = {};
export const ADJ_STAFF: Record<string, Link[]> = {};
export const EDGE_MODE: Record<string, Mode> = {};
const len = (a: string, b: string) => Math.hypot(NODES[a].i - NODES[b].i, NODES[a].j - NODES[b].j);
for (const id of Object.keys(NODES)) { ADJ[id] = []; ADJ_STAFF[id] = []; }
for (const { a, b, mode } of EDGES) {
  const l = len(a, b);
  for (const adj of [ADJ, ADJ_STAFF]) { adj[a].push({ to: b, len: l, mode }); adj[b].push({ to: a, len: l, mode }); }
  EDGE_MODE[a + "|" + b] = EDGE_MODE[b + "|" + a] = mode;
}
for (const [a, b] of SERVICE) {
  const l = len(a, b);
  ADJ_STAFF[a].push({ to: b, len: l, mode: "foot" });
  ADJ_STAFF[b].push({ to: a, len: l, mode: "foot" });
  EDGE_MODE[a + "|" + b] = EDGE_MODE[b + "|" + a] = "foot";
}

export const SPEED: Record<Mode, number> = { foot: 1, train: 5.5, sky: 4 }; // tiles/min (foot: per mover)
export const BOARD: Record<Mode, number> = { foot: 0, train: 4, sky: 2 }; // minutes waiting to board

/**
 * Fastest route between nodes (Dijkstra, weighted by minutes for a mover
 * walking at `walk` tiles/min). Blocked nodes can't be passed through, and
 * modes in `down` (a stopped train or skyride) can't be used.
 */
export function shortest(
  from: string, to: string, blocked: Set<string> = new Set(), staff = false,
  down: Set<Mode> = new Set(), walk = 2.2,
) {
  const adj = staff ? ADJ_STAFF : ADJ;
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const open = new Set([from]);
  while (open.size) {
    let cur = "", best = Infinity;
    for (const n of open) if (dist[n] < best) { best = dist[n]; cur = n; }
    open.delete(cur);
    if (cur === to) break;
    const inMode = prev[cur] ? EDGE_MODE[prev[cur] + "|" + cur] : "foot";
    for (const { to: nb, len: l, mode } of adj[cur]) {
      if (blocked.has(nb) && nb !== to) continue;
      if (down.has(mode)) continue;
      const t = mode === "foot" ? l / walk : l / SPEED[mode] + (inMode !== mode ? BOARD[mode] : 0);
      const d = best + t;
      if (d < (dist[nb] ?? Infinity)) { dist[nb] = d; prev[nb] = cur; open.add(nb); }
    }
  }
  if (dist[to] === undefined) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return { path, minutes: dist[to] };
}

// ------------------------------------------------------------------ attractions

// Place relative to a zone: degrees offset from its centre and a radius factor
// (1 = promenade, <1 lagoon side, >1 outside). Door = the given node.
type A = [
  id: string, name: string, kind: Kind, zone: ZoneId, node: string, off: number, f: number,
  w: number, d: number, h: number, color: number, x?: Partial<LocDef>,
];
const at = (zone: ZoneId, off: number, f: number) => ringPos(ZONES[zone].angle! + off, f);

const A_: A[] = [
  // Depot Street (placed by hand: it's a straight street)
  ["gate", "Front Gate", "gate", "depot", "gate", 0, 0, 1.8, 1.8, 1.4, 0xc0392b, { u: 6, v: GATE_V, sub: "Ticket scanners: mostly decorative." }],
  ["relations", "Guest Relations", "relations", "depot", "gate", 0, 0, 1.8, 1.5, 1.2, 0x2980b9, { u: -6, v: GATE_V, sub: "Thank you for your patience." }],
  ["emporium", "Union Depot Emporium", "shop", "depot", "depot_b", 0, 0, 3.2, 2.2, 1.6, 0x8e44ad, { u: -7, v: DEPOT_V + 13, sub: "Est. 1973. Prices est. 2026." }],
  ["bbq", "Burnt End Barbecue Co.", "food", "depot", "depot_b", 0, 0, 2.6, 2, 1.3, 0x9c4f2a, { u: 7, v: DEPOT_V + 11, sub: "The smell is free. Everything else is $17." }],
  ["soda", "Toasted Ravioli & Soda Fountain", "food", "depot", "depot", 0, 0, 2, 1.8, 1.2, 0xe58fa0, { u: -6.5, v: DEPOT_V + 2, sub: "The fountain part is broken. The ravioli part is fine." }],
  ["wc_depot", "Depot Street Restrooms", "restroom", "depot", "depot", 0, 0, 1.3, 1.3, 0.8, 0x5d6d7e, { u: 6, v: DEPOT_V + 1 }],
  ["st_depot", "Depot Street Station", "station", "depot", "t7", 0, 0, 2.6, 1.4, 1, 0x7b5e3b, { u: 7, v: DEPOT_V + 22, mode: "train", sub: "The Prairie Line. Trains every 10 minutes, emotionally." }],
  // Exposition Midway
  ["wheel", "The Big Wheel", "ride", "expo", "expo", 4, 1.22, 2.2, 2.2, 3.4, 0xf39c12, { wheel: true, baseWait: 15, rideMin: 8, outdoor: true, sub: "Formerly the Bigger Wheel." }],
  ["ringtoss", "Ring Toss of Destiny", "game", "expo", "expo", -3, 0.8, 1.8, 1.4, 1, 0xe74c3c, { sub: "Win a giant stuffed banana. People have." }],
  ["stick", "Fried Everything on a Stick", "food", "expo", "expo", -6, 1.2, 1.8, 1.6, 1, 0xd35400, { sub: "Butter. On a stick. Fried. On a second stick." }],
  ["wc_expo", "Midway Restrooms", "restroom", "expo", "expo", 7, 0.82, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Passport Plaza
  ["carousel", "Carousel of Nations", "ride", "passport", "passport", -9, 0.8, 2.2, 2.2, 1.3, 0xf4d03f, { baseWait: 10, rideMin: 4, sub: "Thirty-two horses. One mold." }],
  ["teacups", "Spinning Teacups (Imported from Ohio)", "ride", "passport", "passport", 7, 0.8, 2, 2, 0.8, 0x76d7c4, { baseWait: 15, rideMin: 3 }],
  ["worldboat", "Around the World in 80 Seconds", "ride", "passport", "passport_b", -10, 1.62, 3, 2.4, 1.4, 0x48c9b0, { baseWait: 20, rideMin: 6, sub: "Designed by our Cultural Consultant, Todd. Todd has been to Cancún." }],
  ["balloon", "Hot Air Balloon Race", "ride", "passport", "passport_b", 9, 1.62, 2.4, 2.4, 2, 0xe67e22, { baseWait: 25, rideMin: 4, outdoor: true }],
  ["foodhall", "International Food Hall", "food", "passport", "passport", 0, 1.22, 3, 2.4, 1.3, 0xd35400, { vegan: true, sub: "Every cuisine on Earth. Every one comes with fries." }],
  ["dutyfree", "Duty-Free-ish Gifts", "shop", "passport", "passport_b", 0, 1.68, 2, 1.6, 1.1, 0xaf7ac5, { sub: "Not duty-free." }],
  ["wc_passport", "Passport Plaza Restrooms", "restroom", "passport", "passport_b", 15, 1.3, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Bone Wars Basecamp
  ["barn", "Scare Barn", "ride", "bonewars", "bonewars", -4, 1.25, 2.6, 2.6, 1.7, 0x6e2c00, { baseWait: 30, rideMin: 8, sub: "Part of Fright Haunt Fest. Mazes may require an exciting new upcharge." }],
  ["minetrain", "Bone Wars Mine Train", "ride", "bonewars", "bonewars", 5, 1.25, 3, 2.4, 1.6, 0x8d6e63, { coaster: true, baseWait: 30, rideMin: 4, outdoor: true, sub: "Two professors. One track. No forgiveness." }],
  ["chili", "Chuckwagon Chili", "food", "bonewars", "bonewars", 4, 0.82, 1.8, 1.6, 1, 0xa04000],
  ["sky_w", "Sky Buckets (West)", "station", "bonewars", "bonewars", -5, 0.8, 1.6, 1.6, 2.2, 0x95a5a6, { mode: "sky", sub: "Gondolas across the lagoon. Inspected recently-ish." }],
  // Fossil Flats
  ["trex", "T-Rex Trek", "ride", "fossil", "fossil_x", -6, 1.66, 3.2, 3, 2, 0x1e8449, { baseWait: 35, rideMin: 7, headliner: true, sub: "Featuring the T-Rex. It roars. A lot." }],
  ["raptor", "Raptor Run", "ride", "fossil", "fossil", 9, 1.2, 3, 2.4, 1.4, 0x27ae60, { coaster: true, baseWait: 20, rideMin: 2, outdoor: true, sub: "Kiddie coaster. Adults must be accompanied by a child." }],
  ["dig", "Fossil Dig", "ride", "fossil", "fossil", -8, 0.8, 2.6, 2.6, 0.4, 0xc9a66b, { baseWait: 5, rideMin: 15, sub: "Socks required. Socks: $9." }],
  ["bronto", "Bronto Burgers", "food", "fossil", "fossil", 6, 0.8, 2, 2, 1.1, 0xa04000],
  ["wc_fossil", "Fossil Flats Restrooms", "restroom", "fossil", "fossil_b", 8, 1.6, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Extinction Junction
  ["meteor", "METEOR X-TREME", "ride", "extinction", "extinction", 3, 1.25, 1.8, 1.8, 3.6, 0x7f8c8d, { baseWait: 30, rideMin: 2, outdoor: true, sub: "Thunder X-Treme Thunder Drop. Formerly “Drop Ride 2.”" }],
  ["lastmeal", "Last Meal Before Impact", "food", "extinction", "extinction", -4, 0.82, 1.8, 1.6, 1, 0x935116, { sub: "Pterodactyl wings (chicken). Probably chicken." }],
  // Atomic Acres
  ["rocket", "Rocket 88", "ride", "atomic", "atomic_x", 0, 1.7, 4, 3, 2.6, 0xc0392b, { coaster: true, baseWait: 50, rideMin: 3, headliner: true, outdoor: true, sub: "The future, as seen from 1958." }],
  ["satellite", "Satellite Spinner", "ride", "atomic", "atomic", -9, 1.2, 2, 2, 1.6, 0x5dade2, { baseWait: 20, rideMin: 3 }],
  ["starlight", "Starlight Theater", "show", "atomic", "atomic", 8, 0.8, 2.8, 2.2, 1.2, 0x34495e, { shows: [15 * 60, 18 * 60], showName: "Pumpkin Revue", sub: "Seats 400. Fans: decorative." }],
  ["diner", "Atomic Diner", "food", "atomic", "atomic", -6, 0.8, 2, 1.8, 1.1, 0x7d3c98],
  ["wc_atomic", "Atomic Acres Restrooms", "restroom", "atomic", "atomic_b", 12, 1.5, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Tomorrow Mall
  ["arcade", "Arcade Galaxy", "game", "mall", "mall", -4, 1.22, 2.4, 2, 1.2, 0x8e44ad, { sub: "Card reader eats credits. High scores from 1991." }],
  ["foodcourt", "Food Court of Tomorrow", "food", "mall", "mall", 5, 1.22, 2.6, 2, 1.1, 0xd2b4de, { vegan: true, sub: "An Orange Julius-adjacent experience." }],
  ["lasertag", "Laser Blast Zone", "ride", "mall", "mall", 6, 0.82, 2, 1.8, 1.1, 0x2c3e50, { baseWait: 15, rideMin: 6 }],
  ["wc_mall", "Mall Restrooms", "restroom", "mall", "mall", -6, 0.82, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Aero Heights
  ["aero", "AeroGlide", "ride", "aero", "aero_x", 0, 1.7, 4, 3, 2.7, 0x3498db, { coaster: true, baseWait: 55, rideMin: 3, headliner: true, outdoor: true, sub: "Big Bank of Missouri Presents. Virtual queue powered by the FunPass app." }],
  ["bubble", "Bubble Pods", "ride", "aero", "aero", 9, 1.2, 2, 2, 1.4, 0xaed6f1, { baseWait: 20, rideMin: 4 }],
  ["cloud", "Cloud Café", "food", "aero", "aero", -7, 0.8, 2, 2, 1.2, 0xd6eaf8, { vegan: true }],
  ["wc_aero", "Aero Heights Restrooms", "restroom", "aero", "aero_b", -12, 1.5, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Y2K Plaza
  ["bubblewall", "The Bubble Wall", "photo", "y2k", "y2k", -3, 1.22, 2.4, 0.8, 1.6, 0x85c1e9, { sub: "Most photographed wall in the park. Last cleaned 2009." }],
  ["froyo", "Frosted Tips Fro-Yo", "food", "y2k", "y2k", 5, 0.82, 1.6, 1.6, 1, 0xf5b7b1, { vegan: true }],
  ["flipphone", "Flip Phone Flyer", "ride", "y2k", "y2k", 5, 1.25, 2, 2, 1.8, 0xbb8fce, { baseWait: 15, rideMin: 3 }],
  // Mirrorball Mile
  ["glitter", "Glitter Drop", "ride", "mirrorball", "mirrorball_x", -4, 1.7, 1.8, 1.8, 3.4, 0xff66cc, { baseWait: 35, rideMin: 2, headliner: true, outdoor: true, sub: "Corporate tried to rename it “Drop Ride 3.” It did not take." }],
  ["inferno", "Disco Inferno", "ride", "mirrorball", "mirrorball", 9, 1.2, 2.2, 2.2, 1, 0xe74c3c, { baseWait: 20, rideMin: 3 }],
  ["club", "Club Mirrorball", "show", "mirrorball", "mirrorball_b", 10, 1.62, 3, 2.4, 1.4, 0x9b59b6, { shows: [20 * 60], showName: "Disco Diva Revue", sub: "Hosted nightly by Miss Velveeta Grand, the best performer in the building." }],
  ["neon", "Neon Snack Shack", "food", "mirrorball", "mirrorball", -9, 1.2, 1.8, 1.6, 1, 0x1abc9c, { vegan: true }],
  ["wc_mirror", "Mirrorball Mile Restrooms", "restroom", "mirrorball", "mirrorball", 4, 0.8, 1.2, 1.2, 0.8, 0x5d6d7e],
  ["sky_e", "Sky Buckets (East)", "station", "mirrorball", "mirrorball", -5, 0.78, 1.6, 1.6, 2.2, 0x95a5a6, { mode: "sky" }],
  // Foam Party Pier
  ["foampit", "Foam Dance Floor", "ride", "foam", "foam", 0, 0.8, 2.6, 2, 0.5, 0xd7bde2, { baseWait: 5, rideMin: 12, wet: true, sub: "Foam: hypoallergenic, according to the foam company." }],
  ["seltzer", "Hard Seltzer Shack", "food", "foam", "foam", 3, 1.22, 1.6, 1.4, 1, 0xa3e4d7],
  // Landlocked Lagoon
  ["leviathan", "Leviathan", "ride", "lagoon", "lagoon_x", 2, 1.7, 3.4, 2.6, 2.2, 0x2471a3, { coaster: true, baseWait: 40, rideMin: 4, headliner: true, outdoor: true, wet: true, sub: "You will get wet. You will get wet walking past it." }],
  ["riptide", "Riptide Flume", "ride", "lagoon", "lagoon", -9, 0.8, 3, 1.8, 1, 0x16a085, { baseWait: 25, rideMin: 6, wet: true }],
  ["swings", "Sea Swings", "ride", "lagoon", "lagoon", 9, 1.2, 1.8, 1.8, 1.7, 0x48c9b0, { baseWait: 15, rideMin: 3, outdoor: true }],
  ["shrimp", "Shipwreck Shrimp Shack", "food", "lagoon", "lagoon", -8, 1.22, 2, 1.6, 1, 0x935116, { sub: "Shrimp: frozen since the Bush administration. Either one." }],
  ["wc_lagoon", "Lagoon Restrooms", "restroom", "lagoon", "lagoon_b", -13, 1.5, 1.2, 1.2, 0.8, 0x5d6d7e],
  // Ozark Boardwalk
  ["cruise", "Party Cove Cruise", "ride", "ozark", "ozark", 0, 0.8, 2.8, 1.8, 0.9, 0x5dade2, { baseWait: 15, rideMin: 10, wet: true, sub: "Like the Lake of the Ozarks, but you can't leave." }],
  ["funnel", "Bait & Funnel Cake", "food", "ozark", "ozark", -4, 1.22, 1.8, 1.6, 1, 0xdc7633, { sub: "Two counters. Please use the correct counter." }],
  ["shack", "Boardwalk Souvenirs", "shop", "ozark", "ozark", 5, 1.22, 1.8, 1.6, 1, 0xa569bd],
];

export const LOCS: LocDef[] = A_.map(([id, name, kind, zone, nd, off, f, w, d, h, color, x]) => {
  const p = x?.u !== undefined ? { u: x.u, v: x.v! } : at(zone, off, f);
  return { id, name, kind, zone, node: nd, w, d, h, color, ...x, ...p, ...toIJ(p.u, p.v) } as LocDef;
});
// Depot Street's station door must be the actual station track node.
LOCS.find((l) => l.id === "st_depot")!.node = STATION_NODES.find((n) => NODES[n].zone === "depot") ?? "t7";
// Fossil Flats and Aero Heights stations (door = their track node).
for (const land of ["fossil", "aero"] as LandId[]) {
  const n = STATION_NODES.find((s) => NODES[s].zone === land)!;
  const p = NODES[n];
  LOCS.push({
    id: "st_" + land, name: `${ZONES[land].name} Station`, kind: "station", zone: land, node: n, mode: "train",
    u: p.u + 3, v: p.v + 1.5, ...toIJ(p.u + 3, p.v + 1.5), w: 2.4, d: 1.4, h: 1, color: 0x7b5e3b,
    sub: "The Prairie Line.",
  });
}

export const LOC: Record<string, LocDef> = Object.fromEntries(LOCS.map((l) => [l.id, l]));

// Tall landmarks that pull you across the park (visual only).
export const LANDMARKS: { zone: ZoneId; u: number; v: number; h: number; color: number; icon: string }[] = [
  { zone: "depot", ...{ u: 0, v: DEPOT_V + 7 }, h: 4, color: 0x8b5a2b, icon: "🕰️" },
  { zone: "hub", ...{ u: 4, v: HUB_V - 1 }, h: 1.4, color: 0xbdc3c7, icon: "⛲" },
  { zone: "passport", ...ringPos(ZONES.passport.angle!, 1.3), h: 4.5, color: 0x95a5a6, icon: "🗼" },
  { zone: "fossil", ...ringPos(ZONES.fossil.angle! + 2, 1.3), h: 4, color: 0x27ae60, icon: "🦖" },
  { zone: "atomic", ...ringPos(ZONES.atomic.angle! - 4, 1.32), h: 5.5, color: 0xecf0f1, icon: "🚀" },
  { zone: "aero", ...ringPos(ZONES.aero.angle! + 5, 1.32), h: 6, color: 0xaed6f1, icon: "🏙️" },
  { zone: "mirrorball", ...ringPos(ZONES.mirrorball.angle! + 1, 1.32), h: 5, color: 0xd7bde2, icon: "🪩" },
  { zone: "lagoon", ...ringPos(ZONES.lagoon.angle! + 4, 1.3), h: 4.5, color: 0xf0f3f4, icon: "⚓" },
  { zone: "hub", ...{ u: 0, v: CENTER.v }, h: 2.4, color: 0xc0392b, icon: "🛟" },
];

// ------------------------------------------------------------------ decor (visual only)

export interface Decor { u: number; v: number; w: number; d: number; h: number; color: number; icon?: string; label?: string }
export const DECOR: Decor[] = [];
{
  const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
  const fronts = [0xa0522d, 0x8b4513, 0xb5651d, 0xcd853f, 0x9e5b40, 0x7b3f00, 0xc19a6b, 0xd2b48c];
  let n = 0;
  for (const side of [-1, 1]) {
    for (let v = DEPOT_V - 1; v <= GATE_V - 5; v += 3.1) {
      DECOR.push({ u: side * 10.5, v, w: 1.3, d: 2.6, h: 0.8 + hash(++n) * 0.6, color: fronts[n % fronts.length] });
    }
  }
  for (let k = -2; k <= 2; k++) DECOR.push({ u: k * 1.6, v: GATE_V - 3, w: 0.35, d: 0.35, h: 0.8, color: 0x7f8c8d });
  const cars = [0xc0392b, 0x2980b9, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0x27ae60, 0xf1c40f, 0x8e44ad];
  for (let row = 0; row < 3; row++) {
    for (let u = -23; u <= 23; u += 2.6) {
      if (hash(u * 7 + row * 31) < 0.35) continue;
      DECOR.push({ u, v: LOT_V - 1 + row * 4.5, w: 0.8, d: 1.5, h: 0.55, color: cars[Math.floor(hash(u + row) * cars.length)] });
    }
  }
  // Backstage, behind Tomorrow Mall: where the magic is stored in boxes.
  const yard = ringPos(270, 1.86);
  DECOR.push({ u: yard.u - 5, v: yard.v - 1, w: 4, d: 3, h: 1.5, color: 0x7f8c8d, label: "Maintenance (Employees Only)" });
  DECOR.push({ u: yard.u + 4, v: yard.v, w: 2, d: 2, h: 1.2, color: 0x95a5a6, icon: "📋", label: "Brad's Office" });
  for (let k = 0; k < 3; k++) DECOR.push({ u: yard.u - 1 + k * 1.4, v: yard.v + 3, w: 0.7, d: 1.1, h: 0.5, color: 0xecf0f1 });
}
