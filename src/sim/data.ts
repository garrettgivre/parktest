// Static content for the gameplay test: the park, the guests, the sabotages.

export type Kind = "gate" | "ride" | "food" | "restroom" | "shop" | "show" | "hub";

export interface LocDef {
  id: string;
  name: string;
  kind: Kind;
  i: number; // footprint centre, in tiles
  j: number;
  w: number; // footprint along i, d along j, h height (tiles)
  d: number;
  h: number;
  color: number;
  baseWait?: number; // typical line, minutes
  rideMin?: number;
}

export const LOT = 14;

export const LOCS: LocDef[] = [
  { id: "hub", name: "Funnel Cake Plaza", kind: "hub", i: 7, j: 7, w: 2, d: 2, h: 0.05, color: 0x9a8f86 },
  { id: "entrance", name: "Front Gate", kind: "gate", i: 13, j: 8, w: 1, d: 2.4, h: 1.2, color: 0xc0392b },
  { id: "shop", name: "Gift Shoppe", kind: "shop", i: 11.4, j: 10.6, w: 1.6, d: 1.6, h: 1.1, color: 0x8e44ad },
  { id: "coaster", name: "The Gut Wrencher", kind: "ride", i: 2, j: 8.5, w: 3, d: 3, h: 2.2, color: 0x2e86c1, baseWait: 45, rideMin: 4 },
  { id: "barn", name: "Scare Barn", kind: "ride", i: 7, j: 1.5, w: 2.4, d: 2.4, h: 1.6, color: 0x6e2c00, baseWait: 30, rideMin: 8 },
  { id: "flume", name: "Soggy Bottom Flume", kind: "ride", i: 7.5, j: 12.5, w: 3, d: 1.8, h: 1, color: 0x16a085, baseWait: 25, rideMin: 6 },
  { id: "food", name: "Chow Barn Food Court", kind: "food", i: 11, j: 4, w: 2.2, d: 2, h: 1, color: 0xd68910 },
  { id: "restroom", name: "Restrooms", kind: "restroom", i: 6.6, j: 10, w: 1.2, d: 1.2, h: 0.8, color: 0x5d6d7e },
  { id: "stage", name: "Pumpkin Revue Stage", kind: "show", i: 2.5, j: 3.5, w: 2.2, d: 1.6, h: 0.6, color: 0xca6f1e },
];

export const SHOW_TIMES = [14 * 60, 19 * 60];
export const OPEN = 10 * 60;
export const CLOSE = 22 * 60;

export interface WishDef {
  id: string;
  label: string;
  loc: string;
  who: string;
  weight: number; // how much they care: scales misery when it's ruined
  ask: string; // what they say when they decide to go do it
}

export const GUEST_NAMES = ["Deb", "Gary"];
export const GROUP_NAME = "The Hendersons";

export const WISHLIST: WishDef[] = [
  { id: "coaster", label: "Ride the Gut Wrencher", loc: "coaster", who: "Gary", weight: 1.5, ask: "Gut Wrencher! Let's GO!" },
  { id: "barn", label: "Brave the Scare Barn", loc: "barn", who: "Deb", weight: 1.2, ask: "Scare Barn time. I'm not scared. You're scared." },
  { id: "flume", label: "Get soaked on Soggy Bottom", loc: "flume", who: "Gary", weight: 0.8, ask: "Let's get soaked on the flume!" },
  { id: "vegan", label: "Deb's vegan lunch", loc: "food", who: "Deb", weight: 1.3, ask: "I'm starving. They have a vegan burger!" },
  { id: "show", label: "Pumpkin Revue, 7 PM", loc: "stage", who: "Deb", weight: 1.4, ask: "We HAVE to get seats for the Pumpkin Revue." },
  { id: "hoodie", label: "Matching souvenir hoodies", loc: "shop", who: "Gary", weight: 0.8, ask: "Matching hoodies before we go. Non-negotiable." },
];

export type SabId =
  | "scanner" | "close" | "slow" | "veg" | "fryer" | "outoforder" | "mascot" | "reader";

export interface SabDef {
  id: SabId;
  kinds: Kind[];
  name: string;
  blurb: string;
  susp: number; // base suspicion
  cooldown: number; // game minutes
  duration?: number;
  once?: boolean;
}

export const SABOTAGES: SabDef[] = [
  { id: "scanner", kinds: ["gate"], name: "Scanner “malfunction”", blurb: "Staff mime scanning. Guests stuck ~30 min.", susp: 8, cooldown: 9999, once: true },
  { id: "close", kinds: ["ride"], name: "Close for “maintenance”", blurb: "Closed 60 min. Brutal if they're near the front of the line.", susp: 12, cooldown: 120, duration: 60 },
  { id: "slow", kinds: ["ride"], name: "Run one car", blurb: "Line moves at half speed for 90 min. Looks like normal incompetence.", susp: 5, cooldown: 120, duration: 90 },
  { id: "veg", kinds: ["food"], name: "Swap the vegan patty", blurb: "The next vegan order is… not.", susp: 10, cooldown: 180 },
  { id: "fryer", kinds: ["food"], name: "Fryer's “down”", blurb: "Food court closed 45 min.", susp: 8, cooldown: 150, duration: 45 },
  { id: "outoforder", kinds: ["restroom"], name: "Out of order", blurb: "Restrooms closed 60 min. Timing is everything.", susp: 6, cooldown: 120, duration: 60 },
  { id: "mascot", kinds: ["show"], name: "Mascot no-show", blurb: "Cancels the next Pumpkin Revue.", susp: 15, cooldown: 9999, once: true },
  { id: "reader", kinds: ["shop"], name: "Card reader down", blurb: "Cash only for 60 min.", susp: 5, cooldown: 120, duration: 60 },
];
