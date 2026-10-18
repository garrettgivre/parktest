// Content tables: tools, sabotage actions, guest traits, wishes, manager duties.

import { Kind, LOCS, LocDef } from "./park";

export type ToolId =
  | "keys" | "patties" | "wetfloor" | "clipboard" | "walkie" | "cart" | "radio" | "mascot" | "vouchers";

export interface ToolDef { id: ToolId; name: string; icon: string; blurb: string; charges?: number }

export const TOOLS: ToolDef[] = [
  { id: "keys", name: "Master Keys", icon: "🔑", blurb: "Restrooms go out of order instantly instead of a gross 8-minute clog." },
  { id: "patties", name: "Mystery Patties", icon: "🍔", blurb: "Swap the vegan patties at a vegan-friendly food stand.", charges: 2 },
  { id: "wetfloor", name: "Wet Floor Signs", icon: "⚠️", blurb: "Block a path junction for 45 min. Guests detour around it.", charges: 3 },
  { id: "clipboard", name: "Clipboard", icon: "📋", blurb: "Corner the group for a 15-minute “quick survey.” Great for making them late.", charges: 3 },
  { id: "walkie", name: "Walkie-Talkie", icon: "📻", blurb: "Radio in one ride closure from anywhere in the park.", charges: 1 },
  { id: "cart", name: "Golf Cart Keys", icon: "🛺", blurb: "You move 1.8× faster all day." },
  { id: "radio", name: "Radio Scanner", icon: "📡", blurb: "Hear everything they say, from anywhere." },
  { id: "mascot", name: "Mascot Suit", icon: "🦖", blurb: "Nobody suspects the dinosaur. No witness penalty." },
  { id: "vouchers", name: "Comp Vouchers", icon: "🎟️", blurb: "Hand them a free FastPass: Patience +15, a little cover.", charges: 3 },
];
export const TOOL: Record<ToolId, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>;

export type ActionId =
  | "scanner" | "close" | "slow" | "fryer" | "veg" | "clog" | "outoforder" | "mascot" | "reader"
  | "wetfloor" | "survey" | "churro" | "voucher" | "radioclose" | "duty"
  | "parade" | "spin" | "jam" | "timeshare" | "appcrash" | "dj" | "splash"
  | "oldowner" | "upcharge" | "lockers";

export interface ActionDef {
  id: ActionId;
  kinds?: Kind[]; // location kinds it applies to (none = special)
  locs?: string[]; // or: only these specific locations (land signature moves)
  signature?: boolean;
  name: string;
  blurb: string;
  minutes: number; // your time
  susp: number;
  cooldown?: number; // per location, game minutes
  duration?: number;
  tool?: ToolId; // required tool (consumes a charge if the tool has charges)
  withoutTool?: ToolId; // only offered when you DON'T have this tool
}

export const ACTIONS: ActionDef[] = [
  { id: "scanner", kinds: ["gate"], name: "Scanner “malfunction”", blurb: "Staff mime scanning. They're stuck ~30 min. Only before they get in.", minutes: 2, susp: 8 },
  { id: "close", kinds: ["ride"], name: "Close for “maintenance”", blurb: "Closed 60 min. Brutal when they're near the front of the line.", minutes: 3, susp: 12, cooldown: 120, duration: 60 },
  { id: "slow", kinds: ["ride"], name: "Run one car", blurb: "Line moves at half speed for 90 min. Looks like normal incompetence.", minutes: 2, susp: 5, cooldown: 120, duration: 90 },
  { id: "fryer", kinds: ["food"], name: "Fryer's “down”", blurb: "Stand closed 45 min.", minutes: 5, susp: 8, cooldown: 150, duration: 45 },
  { id: "veg", kinds: ["food"], name: "Swap the vegan patties", blurb: "The next vegan order here is… not.", minutes: 3, susp: 10, tool: "patties" },
  { id: "clog", kinds: ["restroom"], name: "Clog the toilets", blurb: "Out of order for 60 min. Takes a while. Don't ask.", minutes: 8, susp: 6, cooldown: 120, duration: 60, withoutTool: "keys" },
  { id: "outoforder", kinds: ["restroom"], name: "Lock it: OUT OF ORDER", blurb: "Out of order for 60 min.", minutes: 1, susp: 6, cooldown: 120, duration: 60, tool: "keys" },
  { id: "mascot", kinds: ["show"], name: "Mascot no-show", blurb: "The star “calls in sick.” Cancels the next show here.", minutes: 5, susp: 15 },
  { id: "reader", kinds: ["shop"], name: "Card reader down", blurb: "Cash only for 60 min.", minutes: 3, susp: 5, cooldown: 120, duration: 60 },
  { id: "oldowner", kinds: ["relations"], name: "Route complaints to \u201cthe old company\u201d", blurb: "For 2 hours, every complaint is the old owner's policy. They get a gift card for 20% of a souvenir cup.", minutes: 3, susp: 6, cooldown: 180, duration: 120 },
  { id: "lockers", locs: ["rocket", "aero", "glitter", "leviathan"], name: "Enforce the locker policy", blurb: "For 90 min, lockers here bill by the minute. A long line costs them, and the bag comes out the wrong side.", minutes: 2, susp: 4, cooldown: 180, duration: 90 },
  // One signature move per land.
  { id: "upcharge", locs: ["barn"], signature: true, name: "Add a surprise upcharge", blurb: "For 2 hours the Scare Barn is $25 extra, \u201can exciting new evolution.\u201d They pay. They're furious.", minutes: 3, susp: 6, cooldown: 240, duration: 120 },
  { id: "parade", locs: ["depot"], signature: true, name: "Call in the parade", blurb: "Four people and a golf cart block Main Street for 30 min. Nobody crosses.", minutes: 3, susp: 7, cooldown: 180, duration: 30 },
  { id: "spin", locs: ["teacups"], signature: true, name: "Set the teacups to INDUSTRIAL", blurb: "For 60 min, any Around the World ride leaves them queasy: no appetite, sloshing misery.", minutes: 3, susp: 6, cooldown: 150, duration: 60 },
  { id: "jam", locs: ["trex"], signature: true, name: "Jam the animatronic", blurb: "If they're ON T-Rex Trek, they're stuck inside with it roaring for 25 min. Otherwise it just breaks.", minutes: 2, susp: 10, cooldown: 150 },
  { id: "timeshare", locs: ["starlight"], signature: true, name: "Swap in a timeshare presentation", blurb: "The next show is a 40-minute vacation-ownership pitch. They have to sit through it.", minutes: 5, susp: 12 },
  { id: "appcrash", locs: ["aero"], signature: true, name: "Crash the virtual queue app", blurb: "Anyone in a Future Metropolis line loses their spot. Waits double for 60 min.", minutes: 4, susp: 10, cooldown: 180, duration: 60 },
  { id: "dj", locs: ["mirrorball"], signature: true, name: "Tell the DJ to loop one song", blurb: "For 60 min, every minute they spend in Rave grinds their soul a little.", minutes: 2, susp: 5, cooldown: 150, duration: 60 },
  { id: "splash", locs: ["leviathan"], signature: true, name: "Crank the splash zone", blurb: "For 60 min, riding or walking through Ocean soaks them. Soggy for 90 min after.", minutes: 3, susp: 6, cooldown: 150, duration: 60 },
];

// Named combos: rewarded set-ups. Multipliers apply to misery only.
export interface ComboDef { id: string; name: string; mult: number; hint: string }
export const COMBOS: ComboDef[] = [
  { id: "soclose", name: "So Close!", mult: 1.2, hint: "Close a ride when they're near the front." },
  { id: "ambush", name: "Bladder Ambush", mult: 1.5, hint: "A slow line, then no restroom." },
  { id: "tour", name: "Restroom Grand Tour", mult: 2, hint: "Two closed restrooms in a row." },
  { id: "scenic", name: "Scenic Route", mult: 1.5, hint: "Make them detour… to something closed." },
  { id: "hangry", name: "Hangry", mult: 1.5, hint: "Deny food to someone who's starving." },
  { id: "feedback", name: "Customer Feedback Loop", mult: 1.5, hint: "A survey that makes them late for the show." },
  { id: "double", name: "Double Feature", mult: 1.3, hint: "Ruin two of their plans within an hour." },
  { id: "dejavu", name: "Déjà Vu", mult: 1.5, hint: "Ruin the same plan twice." },
  { id: "drip", name: "Drip Dry", mult: 1.25, hint: "Anything bad, while they're soaked." },
  { id: "lastcall", name: "Lasting Impression", mult: 1.3, hint: "Ruin something after 9 PM." },
  { id: "branson", name: "Branson Bound", mult: 1.4, hint: "They sit through the whole timeshare pitch." },
  { id: "nickel", name: "Nickel & Dimed", mult: 1.5, hint: "Charge them for things twice in one day." },
  { id: "stonewall", name: "Thank You for Your Patience", mult: 1.5, hint: "Shut down their complaint." },
];
export const COMBO: Record<string, ComboDef> = Object.fromEntries(COMBOS.map((c) => [c.id, c]));
export const ACTION: Record<string, ActionDef> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

export const SPECIAL: Record<"wetfloor" | "survey" | "churro" | "voucher" | "radioclose" | "duty", ActionDef> = {
  wetfloor: { id: "wetfloor", name: "Put out a Wet Floor sign", blurb: "Blocks this junction for 45 min. Guests detour.", minutes: 1, susp: 3, tool: "wetfloor", duration: 45 },
  survey: { id: "survey", name: "“Got a minute for a survey?”", blurb: "Hold them up 15 min. Misery +5.", minutes: 15, susp: 4, tool: "clipboard" },
  churro: { id: "churro", name: "Apologize & comp a churro", blurb: "Patience +6. Buys a little goodwill.", minutes: 1, susp: 0, cooldown: 90 },
  voucher: { id: "voucher", name: "Hand them a free FastPass", blurb: "Skips their current line. Patience +15, misery −5, suspicion −4.", minutes: 1, susp: -4, tool: "vouchers" },
  radioclose: { id: "radioclose", name: "Radio in a closure", blurb: "Close this ride 60 min without walking over.", minutes: 1, susp: 14, tool: "walkie", duration: 60 },
  duty: { id: "duty", name: "Do your duty", blurb: "Keeps the manager off your back.", minutes: 8, susp: 0 },
};

// ----------------------------------------------------------------- guests

export type TraitId = "vegan" | "bladder" | "impatient" | "thrill" | "showfan" | "spender";
export interface TraitDef { id: TraitId; label: string; blurb: string }
export const TRAITS: TraitDef[] = [
  { id: "vegan", label: "Vegan", blurb: "Deb is vegan. Lunch is a whole thing." },
  { id: "bladder", label: "Small bladder", blurb: "Gary needs the restroom a LOT." },
  { id: "impatient", label: "Impatient", blurb: "Lines drain their patience faster." },
  { id: "thrill", label: "Thrill seekers", blurb: "Two headliners on the list, and they care a lot." },
  { id: "showfan", label: "Show-tune people", blurb: "The show is the highlight of their day." },
  { id: "spender", label: "Souvenir hunters", blurb: "They will NOT leave without merch." },
];

export interface WishDef {
  id: string;
  label: string;
  loc: string;
  who: string;
  weight: number;
  ask: string;
  showTime?: number;
}

const pick = <T>(rng: () => number, xs: T[]) => xs[Math.floor(rng() * xs.length)];
const take = <T>(rng: () => number, xs: T[], n: number) => {
  const pool = [...xs], out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
};

const RIDE_ASKS = [
  "{name}! Let's GO!",
  "I've been waiting all year for {name}.",
  "{name} next. No arguments.",
  "Ooh, {name}! Over there!",
];

export function makeDay(rng: () => number) {
  const traits = take(rng, TRAITS, 2).map((t) => t.id);
  const has = (t: TraitId) => traits.includes(t);
  const who = () => pick(rng, ["Deb", "Gary"]);
  const rides = LOCS.filter((l) => l.kind === "ride");
  const heads = rides.filter((l) => l.headliner);
  const others = rides.filter((l) => !l.headliner);
  const wishes: WishDef[] = [];
  const ride = (l: LocDef, weight: number) => wishes.push({
    id: l.id, label: `Ride ${l.name}`, loc: l.id, who: who(), weight,
    ask: pick(rng, RIDE_ASKS).replace("{name}", l.name),
  });
  for (const l of take(rng, heads, has("thrill") ? 2 : 1)) ride(l, has("thrill") ? 1.7 : 1.4);
  for (const l of take(rng, others, has("thrill") ? 2 : 3)) ride(l, 0.9);

  const foods = LOCS.filter((l) => l.kind === "food" && (!has("vegan") || l.vegan));
  const food = pick(rng, foods);
  wishes.push(has("vegan")
    ? { id: "lunch", label: `Deb's vegan lunch at ${food.name}`, loc: food.id, who: "Deb", weight: 1.4, ask: `I read ${food.name} has a vegan burger!` }
    : { id: "lunch", label: `Lunch at ${food.name}`, loc: food.id, who: who(), weight: 0.9, ask: `I'm starving. ${food.name}?` });

  const shows = LOCS.filter((l) => l.kind === "show");
  const show = pick(rng, shows);
  const time = pick(rng, show.shows!);
  const h = Math.floor(time / 60) % 12 || 12;
  wishes.push({
    id: "show", label: `${show.showName}, ${h} PM`, loc: show.id, who: "Deb", showTime: time,
    weight: has("showfan") ? 1.8 : 1.2, ask: `We HAVE to get seats for the ${show.showName}.`,
  });

  const shop = pick(rng, LOCS.filter((l) => l.kind === "shop"));
  wishes.push({
    id: "merch", label: `Matching hoodies from ${shop.name}`, loc: shop.id, who: "Gary",
    weight: has("spender") ? 1.5 : 0.8, ask: "Matching hoodies before we go. Non-negotiable.",
  });
  return { traits, wishes };
}

// ----------------------------------------------------------------- duties

const DUTY_TASKS = [
  "a napkin audit", "a trash-can wellness check", "mopping", "cover a register",
  "restocking ketchup", "a gum-under-the-benches assessment", "pressure-washing “something”",
];

export function dutyText(rng: () => number, place: string, by: string) {
  const task = pick(rng, DUTY_TASKS);
  return pick(rng, [
    `Per the operations matrix, ${place} requires ${task}. By ${by}. Thanks in advance.`,
    `Quick ask: ${task} at ${place} by ${by}. Not a request.`,
    `Circling back. ${place}. ${task[0].toUpperCase() + task.slice(1)}. ${by}. Per my last radio.`,
  ]);
}

