// Gameplay simulation, v1. Pure logic, no rendering. Time is in game minutes
// since midnight; positions are in tiles (i, j). The UI calls step(), the
// worker commands (walkTo / doAction / setFollow) and reads the state.

import {
  ACTIONS, ActionDef, ActionId, COMBO, SPECIAL, TOOL, ToolId, TraitId, WishDef, dutyText, makeDay,
} from "./content";
import { AMBIENT, LINES } from "./lines";
import {
  BOARD, EDGE_MODE, LOC, LOCS, LocDef, Mode, NODES, SPEED, ZONES, ZoneId, near, shortest, strength,
} from "./park";

export const OPEN = 10 * 60;
export const CLOSE = 22 * 60;

const STEP = 0.5;
const GUEST_SPEED = 2.2; // tiles per game minute (the park is big now)
const WORKER_SPEED = 2.8;
const EARSHOT = 9; // tiles
const WITNESS = 5;
const REACH = 2.5; // how close you must be to talk to them
const PATIENCE_HIT = 1.3;
const REPEAT_WEIGHT = 0.7;
const BRAD_SPEED = 2.0;
const BRAD_SIGHT = 6;
const HEAT = [13 * 60, 16 * 60];
const HAUNT = 19 * 60;

// Where misery came from, for the results breakdown.
const CATEGORY: Record<string, string> = {
  closed: "Ride closures", closedFront: "Ride closures", app: "Ride closures", jam: "Ride closures",
  slow: "Endless lines", fans: "Endless lines",
  locker: "Nickel & diming", reader: "Nickel & diming", upcharge: "Nickel & diming",
  fryer: "Food crimes", veg: "Food crimes", queasy: "Food crimes", food: "Food crimes",
  restroom: "Restroom warfare",
  show: "Show business", lateShow: "Show business", timeshare: "Show business", monsters: "Show business",
  soaked: "Weather & water",
  parade: "General chaos", dj: "General chaos", detour: "General chaos", megaphone: "General chaos",
  survey: "General chaos", scanner: "General chaos",
  complainBad: "Customer service", tram: "Customer service",
  rigged: "Rigged games", unplug: "Rigged games", scaffold: "General chaos", smoke: "General chaos",
  foam: "Weather & water", gas: "Stranded", stuck: "Stranded", scenic: "Endless lines",
};

export interface P { i: number; j: number }
const dist = (a: P, b: P) => Math.hypot(a.i - b.i, a.j - b.j);

export function fmtTime(min: number) {
  const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

interface Mover {
  pos: P; route: string[]; prev: string; staff?: boolean;
  riding?: Mode | null; // on the train / Sky Buckets (or waiting to board)
  boardLeft?: number;
}

export interface LocState {
  def: LocDef;
  closedUntil: number;
  closedBy: "you" | "park" | null;
  slowUntil: number;
  vegSwap: boolean;
  readerUntil: number;
  showCancelled: boolean;
  scannerBroken: boolean;
  readyAt: Partial<Record<ActionId, number>>;
  timeshare: boolean;
  oldOwnerUntil: number;
  upchargeUntil: number;
  lockerUntil: number;
  fansUntil: number;
  monstersUntil: number;
  riggedUntil: number;
  scenicUntil: number;
  tramDown: boolean;
}

export interface Fx { type: "misery" | "combo" | "caught"; text: string }

const MONEY = ["reader", "upcharge", "locker"];
const RUINS = ["rigged", "unplug", "scaffold", "gas", "stuck", "tram", "monsters", "complainBad", "closed", "closedFront", "show", "timeshare", "veg", "reader", "lateShow", "fryer", "app", "jam"];

export interface Wish { def: WishDef; done: boolean; failed: boolean; revealed: boolean; fails: number; retryAt: number }

type Purpose = "wish" | "ride" | "food" | "restroom" | "show" | "shop" | "exit" | "gate" | "complain";
const PLAYABLE = ["ride", "game", "photo"];
interface Goal { loc: string; purpose: Purpose; wish?: Wish }

type Act =
  | { t: "walk"; goal: Goal }
  | { t: "queue"; loc: string; total: number; left: number; wish?: Wish }
  | { t: "busy"; loc: string | null; left: number; what: string; done?: () => void }
  | { t: "gone" };

export type LogKind = "guest" | "you" | "park" | "bad" | "good" | "boss";
export interface LogEntry { time: number; text: string; kind: LogKind }
export type EndReason = "closed" | "left" | "fired";

export interface Duty { loc: string; deadline: number; text: string }

export type Target = { kind: "loc"; id: string } | { kind: "node"; id: string } | { kind: "guests" };
interface Task { action: ActionDef; target: Target; left: number; total: number }

export interface ActionView {
  def: ActionDef;
  why: string | null; // reason it can't be done right now
  susp: number;
  walk: number; // minutes to walk there first (0 = you're there)
}

export class Sim {
  time = OPEN - 5;
  rng: () => number;
  traits: TraitId[];
  wishes: Wish[];
  locs: Record<string, LocState> = {};
  suspicion = 0;
  misery = 0;
  patience = 100;
  hunger = 15;
  bladder = 10;
  g: Mover & { act: Act };
  w: Mover & { task: Task | null; pending: { target: Target; action?: ActionDef } | null; follow: boolean };
  tools: Partial<Record<ToolId, number>> = {};
  blocked: Record<string, number> = {};
  duty: Duty | null = null;
  dutiesDone = 0;
  dutiesMissed = 0;
  alibi: { zone: ZoneId; until: number } | null = null;
  smokeUntil = 0;
  foamUntil = 0;
  trainDownUntil = 0;
  skyDownUntil = 0;
  private smokeHit = false;
  thought = "";
  thoughtUntil = 0;
  log: LogEntry[] = [];
  pauses: string[] = [];
  ended: { why: EndReason; at: number } | null = null;
  churroReady = 0;
  slowSuffered = false;
  fx: Fx[] = []; // UI drains: floating numbers and combo call-outs
  combosHit: string[] = [];
  paradeUntil = 0;
  spinUntil = 0;
  appDownUntil = 0;
  djUntil = 0;
  splashUntil = 0;
  soakedUntil = 0;
  queasyUntil = 0;
  private paradeHit = false;
  private djHit = false;
  private slowQueueAt = -999;
  private ruined: { time: number; id: string }[] = [];
  private nextAmbient = OPEN + 40;
  private complained = false;
  brad: Mover & { pause: number };
  banners: string[] = []; // UI toasts for day events
  miseryBy: Record<string, number> = {};
  rainAt: number;
  rainUntil = 0;
  private heatOn = false;
  private rained = false;
  private hauntOpen = false;
  private bradTimer = 0;
  private avoid: Record<string, number> = {}; // places they were told are closed
  private lockerHit = "";
  private hits: { time: number; reason: string }[] = [];
  private sabLog: number[] = [];
  private breakdowns: number[];
  private nextDutyAt = 10 * 60 + 40;
  private leaving = false;
  private lastRide = "";
  private closedSeen: Record<string, number> = {}; // restrooms/food they found closed
  private followTimer = 0;

  constructor(seed = Date.now()) {
    this.rng = mulberry32(seed);
    for (const def of LOCS) {
      this.locs[def.id] = {
        def, closedUntil: 0, closedBy: null, slowUntil: 0, vegSwap: false, readerUntil: 0,
        showCancelled: false, scannerBroken: false, readyAt: {}, timeshare: false,
        oldOwnerUntil: 0, upchargeUntil: 0, lockerUntil: 0, fansUntil: 0, monstersUntil: 0,
        riggedUntil: 0, scenicUntil: 0, tramDown: false,
      };
    }
    const day = makeDay(this.rng);
    this.traits = day.traits;
    this.wishes = day.wishes.map((def) => ({ def, done: false, failed: false, revealed: false, fails: 0, retryAt: 0 }));
    for (const w of this.shuffle([...this.wishes]).slice(0, 2)) w.revealed = true;
    this.breakdowns = [this.between(11 * 60, 14 * 60), this.between(14 * 60, 17 * 60), this.between(17 * 60, 20 * 60)];
    const lot = NODES.lot;
    this.g = { pos: { i: lot.i, j: lot.j }, route: ["gate"], prev: "lot", act: { t: "walk", goal: { loc: "gate", purpose: "gate" } } };
    this.w = { pos: { i: NODES.depot_b.i, j: NODES.depot_b.j }, route: [], prev: "depot_b", staff: true, task: null, pending: null, follow: false };
    this.brad = { pos: { i: NODES.hub.i, j: NODES.hub.j }, route: [], prev: "hub", staff: true, pause: 20 };
    this.rainAt = this.between(13.5 * 60, 18.5 * 60);
    this.note("The Hendersons just parked in Lot Z. Those Front Gate ticket scanners look\u2026 fragile.", "park");
  }

  // ------------------------------------------------------------- loadout

  equip(ids: ToolId[]) {
    this.tools = {};
    for (const id of ids) this.tools[id] = TOOL[id].charges ?? Infinity;
  }
  has(id: ToolId) { return (this.tools[id] ?? 0) > 0; }
  trait(id: TraitId) { return this.traits.includes(id); }

  // ------------------------------------------------------------- queries

  loc(id: string) { return this.locs[id]; }
  isClosed(id: string) { return this.locs[id].closedUntil > this.time; }
  isSlow(id: string) { return this.locs[id].slowUntil > this.time; }
  isBlocked(node: string) { return (this.blocked[node] ?? 0) > this.time; }
  blockedSet() { return new Set(Object.keys(this.blocked).filter((n) => this.isBlocked(n))); }

  currentWait(id: string) {
    const def = this.locs[id].def;
    const base = def.baseWait ?? 10;
    const h = this.time / 60;
    const crowd = 0.6 + 0.6 * Math.exp(-((h - 15) ** 2) / 8);
    const app = this.appDownUntil > this.time ? 1 + strength("aero", def.zone) : 1;
    return Math.round(base * crowd * (this.isSlow(id) ? 2 : 1) * app);
  }

  workerSpeed() { return WORKER_SPEED * (this.has("cart") ? 1.8 : 1); }
  heard() {
    if (this.has("radio")) return true;
    if (this.inSmoke(this.guestZone()) || this.inSmoke(NODES[this.w.prev].zone)) return false; // can't hear a thing
    return dist(this.w.pos, this.g.pos) <= EARSHOT;
  }
  /** Meteor smoke fills Extinction Junction and spills into its neighbours. */
  inSmoke(zone: ZoneId) { return this.smokeUntil > this.time && near("extinction", zone) > 0; }
  /** On a moving train / gondola (not just waiting to board)? */
  aboard(m: Mover, mode?: Mode) {
    return !!m.riding && (!mode || m.riding === mode) && (m.boardLeft ?? 0) <= 0 && m.route.length > 0;
  }
  private downModes() {
    const s = new Set<Mode>();
    if (this.trainDownUntil > this.time) s.add("train");
    if (this.skyDownUntil > this.time) s.add("sky");
    return s;
  }
  private speedOf(m: Mover) { return m === this.w ? this.workerSpeed() : m === this.brad ? BRAD_SPEED : GUEST_SPEED; }
  nearGuests(r = REACH) { return this.g.act.t !== "gone" && dist(this.w.pos, this.g.pos) <= r; }
  workerAt(node: string) { return !this.w.route.length && dist(this.w.pos, NODES[node]) < 0.05; }
  guestsAtLoc(id: string) {
    const a = this.g.act;
    if ((a.t === "queue" || a.t === "busy") && a.loc === id) return true;
    return dist(this.g.pos, NODES[this.locs[id].def.node]) < 2;
  }

  activity(): string {
    const a = this.g.act;
    if (a.t === "gone") return "Gone home";
    if (a.t === "walk" && this.aboard(this.g, "train")) return "Riding the Prairie Line";
    if (a.t === "walk" && this.aboard(this.g, "sky")) return "Riding the Sky Buckets";
    if (a.t === "walk") return this.heard() ? `Walking to ${LOC[a.goal.loc].name}` : "Walking somewhere\u2026 (too far to hear)";
    if (a.t === "queue") return `In line for ${LOC[a.loc].name} (${Math.ceil(a.left)} min left)`;
    return a.what;
  }

  workerStatus(): string {
    const w = this.w;
    if (w.task) return `${w.task.action.name} (${Math.ceil(w.task.left)} min)`;
    if (w.follow) return "Tailing the Hendersons";
    if (w.route.length) return w.pending?.action ? `Walking to: ${w.pending.action.name}` : "Walking";
    return "Standing around, looking busy";
  }

  /** Minutes for the worker to walk to a node. */
  walkMinutes(node: string) {
    return this.routeCost(this.w, node, new Set());
  }

  // ------------------------------------------------------------- movement

  private routeCost(m: Mover, target: string, blocked: Set<string>) {
    return this.plan(m, target, blocked)?.cost ?? Infinity;
  }

  /** Cheapest route (in minutes) from wherever the mover is, possibly mid-edge. */
  private plan(m: Mover, target: string, blocked: Set<string>) {
    const a = m.prev, b = m.route[0];
    const sp = this.speedOf(m), down = this.downModes();
    const midMode = b ? EDGE_MODE[a + "|" + b] ?? "foot" : "foot";
    const legSpeed = midMode === "foot" ? sp : SPEED[midMode];
    const opts: { cost: number; route: string[] }[] = [];
    const ra = midMode === "foot" ? shortest(a, target, blocked, !!m.staff, down, sp) : null; // no hopping off a moving train
    if (ra) {
      const d = dist(m.pos, NODES[a]);
      opts.push({ cost: d / sp + ra.minutes, route: d < 0.05 ? ra.path.slice(1) : ra.path });
    }
    if (b && b !== a) {
      const rb = shortest(b, target, blocked, !!m.staff, down, sp);
      if (rb) opts.push({ cost: dist(m.pos, NODES[b]) / legSpeed + rb.minutes, route: rb.path });
    }
    if (!opts.length) return null;
    return opts.sort((x, y) => x.cost - y.cost)[0];
  }

  private routeTo(m: Mover, target: string, blocked = new Set<string>()) {
    const p = this.plan(m, target, blocked) ?? this.plan(m, target, new Set());
    m.route = p ? p.route : [];
  }

  /**
   * Advance a mover by dt minutes; returns true when it has arrived (route
   * empty). Walks at `speed`; trains and gondolas go at their own speed after
   * a boarding wait, and stop dead if they've been stopped.
   */
  private move(m: Mover, speed: number, dt: number) {
    let t = dt;
    while (t > 0 && m.route.length) {
      const next = m.route[0];
      const mode = EDGE_MODE[m.prev + "|" + next] ?? "foot";
      if (mode === "foot") m.riding = null;
      else {
        if (this.downModes().has(mode)) return false;
        if (m.riding !== mode) { m.riding = mode; m.boardLeft = BOARD[mode]; }
        if ((m.boardLeft ?? 0) > 0) {
          const w = Math.min(t, m.boardLeft!);
          m.boardLeft! -= w;
          t -= w;
          continue;
        }
      }
      const sp = mode === "foot" ? speed : SPEED[mode];
      const n = NODES[next];
      const d = dist(m.pos, n);
      if (d <= sp * t) {
        m.pos = { i: n.i, j: n.j };
        m.prev = m.route.shift()!;
        t -= d / sp;
      } else {
        const k = (sp * t) / d;
        m.pos = { i: m.pos.i + (n.i - m.pos.i) * k, j: m.pos.j + (n.j - m.pos.j) * k };
        t = 0;
      }
    }
    if (!m.route.length) m.riding = null;
    return !m.route.length;
  }

  // ------------------------------------------------------------- logging

  private say(text: string, kind: LogKind = "guest", always = false) {
    if (!always && !this.heard()) return;
    this.thought = text;
    this.thoughtUntil = this.time + 14;
    this.note(text, kind);
  }
  /** A random variant of a dialogue line. {A} speaks, {B} is the other one. */
  private line(key: string, vars: Record<string, string | number> = {}, speaker?: string) {
    const pool = LINES[key];
    const a = speaker ?? (this.rng() < 0.5 ? "Deb" : "Gary");
    const b = a === "Deb" ? "Gary" : "Deb";
    let out = pool[Math.floor(this.rng() * pool.length)].replace(/\{A\}/g, a).replace(/\{B\}/g, b);
    for (const [k, v] of Object.entries(vars)) out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    return out;
  }

  private note(text: string, kind: LogKind) { this.log.push({ time: this.time, text, kind }); }
  private who(w?: Wish) { return w?.def.who ?? (this.rng() < 0.5 ? "Deb" : "Gary"); }
  private between(a: number, b: number) { return a + this.rng() * (b - a); }
  private shuffle<T>(xs: T[]) {
    for (let k = xs.length - 1; k > 0; k--) {
      const r = Math.floor(this.rng() * (k + 1));
      [xs[k], xs[r]] = [xs[r], xs[k]];
    }
    return xs;
  }
  private recent(times: number[], window = 90) { return times.filter((t) => this.time - t < window).length; }

  private hurt(misery: number, patience: number, reason: string, yours = true, wish?: Wish) {
    let mult = 1;
    if (yours) {
      for (const id of this.combosFor(reason, wish)) {
        const c = COMBO[id];
        mult *= c.mult;
        this.combosHit.push(id);
        this.fx.push({ type: "combo", text: `${c.name} \u00d7${c.mult}` });
      }
    }
    if (wish && RUINS.includes(reason)) this.ruined.push({ time: this.time, id: wish.def.id });
    const m = misery * mult;
    this.addMisery(m, reason);
    if (m >= 1) this.fx.push({ type: "misery", text: `+${Math.round(m)}` });
    this.patience -= patience * PATIENCE_HIT;
    if (yours) {
      this.suspicion += 2 * this.recent(this.hits.filter((h) => !h.reason.startsWith("park:")).map((h) => h.time));
      this.hits.push({ time: this.time, reason });
    } else {
      this.hits.push({ time: this.time, reason: "park:" + reason });
    }
  }

  private addMisery(m: number, reason: string) {
    this.misery += m;
    this.miseryBy[reason] = (this.miseryBy[reason] ?? 0) + m;
  }

  heat() { return this.time >= HEAT[0] && this.time < HEAT[1]; }
  raining() { return this.rainUntil > this.time; }

  /** Can Brad see where this would happen? */
  bradSees(t: Target) {
    const where = t.kind === "guests" ? this.w.pos : NODES[this.targetNode(t)!];
    const zone = t.kind === "guests" ? NODES[this.w.prev].zone : NODES[this.targetNode(t)!].zone;
    if (this.inSmoke(zone) || this.inSmoke(NODES[this.brad.prev].zone)) return false; // the smoke is your friend
    return dist(this.brad.pos, where) <= BRAD_SIGHT;
  }

  bradMode() {
    return this.suspicion >= 75 ? "Watching you. Closely." : this.suspicion >= 50 ? "Patrolling near you" : "Strolling, holding a clipboard";
  }

  private combosFor(reason: string, wish?: Wish) {
    const t = this.time;
    const mine = (r: string, win: number) => this.hits.some((h) => h.reason === r && t - h.time < win);
    const out: string[] = [];
    if (reason === "closedFront") out.push("soclose");
    if (reason === "restroom" && t - this.slowQueueAt < 90) out.push("ambush");
    if (reason === "restroom" && mine("restroom", 45)) out.push("tour");
    if ((reason === "closed" || reason === "closedFront") && (mine("detour", 40) || mine("megaphone", 40))) out.push("scenic");
    if (reason === "fryer" && this.hunger >= 85) out.push("hangry");
    if (reason === "lateShow" && mine("survey", 45)) out.push("feedback");
    if (wish && RUINS.includes(reason)) {
      if (this.ruined.some((r) => r.id !== wish.def.id && t - r.time < 60)) out.push("double");
      if (this.ruined.some((r) => r.id === wish.def.id)) out.push("dejavu");
    }
    if (this.soakedUntil > t && reason !== "soaked") out.push("drip");
    if (t >= 21 * 60 && RUINS.includes(reason)) out.push("lastcall");
    if (reason === "timeshare") out.push("branson");
    if (MONEY.includes(reason) && this.hits.some((h) => MONEY.includes(h.reason) && h.reason !== reason)) out.push("nickel");
    if (reason === "complainBad") out.push("stonewall");
    if (reason === "soaked" && this.djUntil > t && strength("mirrorball", this.guestZone()) > 0) out.push("wetwild");
    if (reason === "stuck" || reason === "gas" || reason === "jam") out.push("stranded");
    return out;
  }

  guestZone(): ZoneId {
    const a = this.g.act;
    if ((a.t === "queue" || a.t === "busy") && a.loc) return LOC[a.loc].zone;
    return NODES[this.g.prev].zone;
  }

  /** Little status icons for the group. */
  statuses() {
    const out: string[] = [];
    if (this.soakedUntil > this.time) out.push("💦")
    if (this.queasyUntil > this.time) out.push("🤢");
    if (this.djUntil > this.time && strength("mirrorball", this.guestZone()) > 0) out.push("🎵");
    if (this.inSmoke(this.guestZone())) out.push("🌫️");
    if (this.aboard(this.g)) out.push(this.g.riding === "train" ? "🚂" : "🚡");
    return out;
  }

  mood() {
    return this.patience > 70 ? "😀" : this.patience > 45 ? "😐" : this.patience > 20 ? "😠" : "🤬";
  }

  private soak(yours = true) {
    if (this.soakedUntil > this.time) return;
    this.soakedUntil = this.time + 90;
    this.hurt(8, 4, "soaked", yours);
    this.say(this.line("soaked"), "bad", true);
  }

  private joy(misery: number, patience: number) {
    this.misery = Math.max(0, this.misery - misery);
    this.patience = Math.min(100, this.patience + patience);
  }

  // ------------------------------------------------------------- worker commands

  walkTo(node: string) {
    if (this.ended || this.w.task) return;
    this.w.follow = false;
    this.w.pending = null;
    this.routeTo(this.w, node);
  }

  setFollow(on: boolean) {
    this.w.follow = on;
    this.w.pending = null;
    this.followTimer = 0;
    if (!on) this.w.route = [];
  }

  /** Everything you could do at a target, with why-not reasons and costs. */
  actionsFor(target: Target): ActionView[] {
    const defs: ActionDef[] = [];
    if (target.kind === "loc") {
      const kind = this.locs[target.id].def.kind;
      if (this.duty?.loc === target.id) defs.push(SPECIAL.duty);
      for (const a of ACTIONS) {
        if (a.locs ? !a.locs.includes(target.id) : !a.kinds?.includes(kind)) continue;
        if (a.id === "stoptrain" && this.locs[target.id].def.mode !== "train") continue;
        if (a.id === "stopsky" && this.locs[target.id].def.mode !== "sky") continue;
        if (a.tool && !(a.tool in this.tools)) continue;
        if (a.withoutTool && a.withoutTool in this.tools) continue;
        defs.push(a);
      }
      if (kind === "ride" && "walkie" in this.tools) defs.push(SPECIAL.radioclose);
    } else if (target.kind === "node") {
      if ("wetfloor" in this.tools) defs.push(SPECIAL.wetfloor);
    } else {
      defs.push(SPECIAL.churro);
      if ("clipboard" in this.tools) defs.push(SPECIAL.survey);
      if ("vouchers" in this.tools) defs.push(SPECIAL.voucher);
      if ("megaphone" in this.tools) defs.push(SPECIAL.megaphone);
    }
    return defs.map((def) => ({
      def,
      why: this.cantDo(target, def),
      susp: this.suspCost(target, def),
      walk: this.walkFor(target, def),
    }));
  }

  private targetNode(t: Target) {
    if (t.kind === "loc") return this.locs[t.id].def.node;
    if (t.kind === "node") return t.id;
    return null;
  }

  private walkFor(t: Target, def: ActionDef) {
    if (def.id === "radioclose") return 0;
    if (t.kind === "guests") {
      const reach = def.id === "megaphone" ? EARSHOT : REACH;
      const d = dist(this.w.pos, this.g.pos);
      return d <= reach ? 0 : (d - reach + 0.5) / this.workerSpeed();
    }
    const n = this.targetNode(t)!;
    return this.workerAt(n) ? 0 : this.walkMinutes(n);
  }

  private cantDo(t: Target, a: ActionDef): string | null {
    if (this.ended) return "Day's over";
    if (this.w.task) return "You're busy";
    if (a.tool && !this.has(a.tool)) return "Out of charges";
    if (a.id === "churro" && this.churroReady > this.time) return `Ready ${fmtTime(this.churroReady)}`;
    if (t.kind === "guests") {
      if (this.g.act.t === "gone") return "They're gone";
      if ((a.id === "survey" || a.id === "megaphone") && this.g.act.t !== "walk") return "Only while they're walking";
      if (a.id === "megaphone" && this.g.act.t === "walk" && ["exit", "gate", "complain"].includes(this.g.act.goal.purpose)) return "Not now";
      return null;
    }
    if (t.kind === "node") return this.isBlocked(t.id) ? "Already blocked" : null;
    const l = this.locs[t.id];
    const ready = l.readyAt[a.id] ?? 0;
    if (ready > this.time) return `Ready ${fmtTime(ready)}`;
    switch (a.id) {
      case "scanner": {
        const g = this.g.act;
        const outside = (g.t === "walk" && g.goal.purpose === "gate") || (g.t === "busy" && g.loc === "gate");
        if (!outside) return "They're already inside";
        return l.scannerBroken ? "Already broken" : null;
      }
      case "close": case "radioclose": case "fryer": case "clog": case "outoforder":
        return this.isClosed(t.id) ? "Already closed" : null;
      case "veg":
        if (!l.def.vegan) return "No vegan menu here";
        return l.vegSwap ? "Already swapped" : null;
      case "mascot":
        if (l.showCancelled) return "Already cancelled";
        return (l.def.shows ?? []).some((s) => s > this.time) ? null : "No more shows today";
      case "duty":
        return this.duty?.loc === t.id ? null : "No duty here";
      case "parade": return this.paradeUntil > this.time ? "Parade's already going" : null;
      case "oldowner": return l.oldOwnerUntil > this.time ? "Already briefed" : null;
      case "upcharge": return l.upchargeUntil > this.time ? "Already upcharged" : null;
      case "lockers": return l.lockerUntil > this.time ? "Already enforced" : null;
      case "fans": return l.fansUntil > this.time ? "Already unplugged" : null;
      case "monsters":
        if (this.time < HAUNT - 30) return "The Haunt isn't open yet";
        return l.monstersUntil > this.time ? "Already on break" : null;
      case "spin": return this.spinUntil > this.time ? "Already cranked" : null;
      case "appcrash": return this.appDownUntil > this.time ? "App's already down" : null;
      case "dj": return this.djUntil > this.time ? "Already looping" : null;
      case "splash": return this.splashUntil > this.time ? "Already cranked" : null;
      case "jam": return this.isClosed("trex") ? "Already closed" : null;
      case "timeshare":
        if (l.timeshare) return "Already booked";
        return (l.def.shows ?? []).some((x) => x > this.time) ? null : "No more shows today";
      case "rig": return l.riggedUntil > this.time ? "Already rigged" : null;
      case "scenic": return l.scenicUntil > this.time ? "Already scenic" : null;
      case "smoke": return this.smokeUntil > this.time ? "Already smoky" : null;
      case "foam": return this.foamUntil > this.time ? "Already foaming" : null;
      case "unplug": case "scaffold": case "gas": return this.isClosed(t.id) ? "Already closed" : null;
      case "stoptrain": return this.trainDownUntil > this.time ? "Already stopped" : null;
      case "stopsky": return this.skyDownUntil > this.time ? "Already stopped" : null;
      case "tram":
        if (this.time < 19 * 60 + 30) return "Only near closing";
        return l.tramDown ? "Already \u201cout of service\u201d" : null;
    }
    return null;
  }

  suspCost(t: Target, a: ActionDef) {
    if (a.susp <= 0) return a.susp;
    let c = a.susp;
    // Witnessed: the group is near where it happens.
    const where = t.kind === "guests" ? null : this.targetNode(t);
    const seen = where ? dist(this.g.pos, NODES[where]) <= WITNESS : false;
    if (seen && !this.has("mascot")) c *= 1.5;
    const zone = t.kind === "loc" ? this.locs[t.id].def.zone : t.kind === "node" ? NODES[t.id].zone : null;
    if (zone && this.hasAlibi(zone)) c *= 0.6;
    if (this.suspicion >= 75) c *= 1.5;
    return Math.round(c + 3 * this.recent(this.sabLog)) + (this.bradSees(t) ? 20 : 0);
  }

  isWitnessed(t: Target) {
    const where = t.kind === "guests" ? null : this.targetNode(t);
    return !!where && !this.has("mascot") && dist(this.g.pos, NODES[where]) <= WITNESS;
  }

  hasAlibi(zone: ZoneId) { return !!this.alibi && this.alibi.until > this.time && near(this.alibi.zone, zone) > 0; }

  /** Do an action; walks there first if needed. Returns false if it can't. */
  doAction(t: Target, def: ActionDef) {
    if (this.cantDo(t, def)) return false;
    this.w.follow = false;
    if (this.walkFor(t, def) === 0) {
      this.startTask(t, def);
    } else {
      this.w.pending = { target: t, action: def };
      if (t.kind !== "guests") this.routeTo(this.w, this.targetNode(t)!);
    }
    return true;
  }

  cancelTask() {
    this.w.pending = null;
    if (this.w.task?.action.id === "survey") return; // you can't escape a survey you started
    this.w.task = null;
  }

  private startTask(t: Target, def: ActionDef) {
    this.w.pending = null;
    this.w.route = [];
    this.w.task = { action: def, target: t, left: def.minutes, total: def.minutes };
    if (def.id === "survey") {
      this.g.route = [];
      this.g.act = { t: "busy", loc: null, left: 15, what: "Trapped in a “quick survey”" };
      this.say(this.line("surveyStart"), "guest", true);
    }
  }

  private finishTask(task: Task) {
    const { action: a, target: t } = task;
    const cost = this.suspCost(t, a);
    if (a.tool && TOOL[a.tool].charges) this.tools[a.tool]! -= 1;
    if (a.cooldown && t.kind === "loc") this.locs[t.id].readyAt[a.id] = this.time + a.cooldown;
    if (a.susp > 0) this.sabLog.push(this.time);
    this.suspicion = Math.max(0, this.suspicion + cost);
    if (a.susp > 0 && this.bradSees(t)) {
      const thing = t.kind === "loc" ? this.locs[t.id].def.name : t.kind === "node" ? "floor" : "guests";
      this.note(this.line("bradCaught", { thing }), "boss");
      this.fx.push({ type: "caught", text: "Brad saw that! +20" });
    }
    const until = this.time + (a.duration ?? 0);

    if (t.kind === "guests") {
      if (a.id === "churro") {
        this.churroReady = this.time + (a.cooldown ?? 90);
        this.joy(0, 6);
        this.say(this.line("churro"), "good", true);
      } else if (a.id === "voucher") {
        this.joy(5, 15);
        const g = this.g.act;
        if (g.t === "queue") g.left = Math.min(g.left, 2);
        this.say(this.line("voucher"), "good", true);
      } else if (a.id === "megaphone") {
        const ga = this.g.act;
        if (ga.t === "walk") {
          const loc = ga.goal.loc;
          this.avoid[loc] = this.time + 45;
          if (ga.goal.wish) ga.goal.wish.retryAt = this.time + 45;
          if (["food", "restroom"].includes(LOC[loc].kind)) this.closedSeen[loc] = this.time + 45;
          this.hurt(3, 3, "megaphone");
          this.say(this.line("megaphone"), "bad", true);
          this.decide();
        }
      } else if (a.id === "survey") {
        this.hurt(5, 3, "survey");
        this.say(this.line("surveyEnd"), "bad", true);
      }
      return;
    }
    if (t.kind === "node") {
      this.blocked[t.id] = until;
      this.note("Wet Floor sign deployed. The floor is not wet.", "you");
      return;
    }

    const l = this.locs[t.id];
    const name = l.def.name;
    switch (a.id) {
      case "duty":
        this.dutiesDone++;
        this.duty = null;
        this.suspicion = Math.max(0, this.suspicion - 6);
        this.alibi = { zone: l.def.zone, until: this.time + 60 };
        this.nextDutyAt = this.time + this.between(90, 130);
        if (this.bradSees(t)) {
          this.suspicion = Math.max(0, this.suspicion - 4);
          this.note(this.line("bradPraise"), "boss");
        }
        this.note(`Duty done. Brad: "Noted." (You have an alibi around here for an hour.)`, "boss");
        return;
      case "scanner":
        l.scannerBroken = true;
        this.note("Scanners are “down.” Staff instructed to mime scanning.", "you");
        if (this.g.act.t === "busy" && this.g.act.loc === "gate") this.mimed();
        return;
      case "close": case "radioclose":
        this.note(`${name} closed for “maintenance.”`, "you");
        this.closeLoc(t.id, until, "you");
        return;
      case "slow":
        l.slowUntil = until;
        this.note(`${name} is now running one car.`, "you");
        return;
      case "fryer":
        this.note(`The fryer at ${name} is “down.”`, "you");
        this.closeLoc(t.id, until, "you");
        return;
      case "clog": case "outoforder":
        this.note(`${name}: OUT OF ORDER.`, "you");
        this.closeLoc(t.id, until, "you");
        return;
      case "veg":
        l.vegSwap = true;
        this.note(`Vegan patties at ${name} replaced with “basically vegan” patties.`, "you");
        return;
      case "mascot":
        l.showCancelled = true;
        this.note(`The star of the ${l.def.showName} called in “sick.” Next show cancelled.`, "you");
        return;
      case "reader":
        l.readerUntil = until;
        this.note(`${name} card reader unplugged. Cash only.`, "you");
        return;
      case "fans":
        l.fansUntil = until;
        this.note(`Queue fans at ${name}: unplugged. They were decorative anyway.`, "you");
        return;
      case "monsters":
        l.monstersUntil = until;
        this.note("The Scare Barn monsters are on break. All of them. Simultaneously.", "you");
        return;
      case "oldowner":
        l.oldOwnerUntil = until;
        this.note("Guest Relations has been briefed: everything is the old company's policy.", "you");
        return;
      case "upcharge":
        l.upchargeUntil = until;
        this.note("Scare Barn now costs $25 extra. Signage calls it \u201can exciting new evolution.\u201d", "you");
        return;
      case "lockers":
        l.lockerUntil = until;
        this.note(`Lockers at ${name} now bill by the minute. Loose articles are \u201cnot permitted.\u201d`, "you");
        return;
      case "parade":
        this.paradeUntil = until;
        this.paradeHit = false;
        this.note("The parade begins: four people and a golf cart. Main Street is blocked for 30 min.", "you");
        return;
      case "spin":
        this.spinUntil = until;
        this.note("The teacups are now set to INDUSTRIAL. So is every ride in Around the World, somehow.", "you");
        return;
      case "jam": {
        const g = this.g.act;
        if (g.t === "busy" && g.loc === "trex") {
          g.left += 25;
          g.what = "Stuck inside T-Rex Trek. It's roaring. It won't stop.";
          this.hurt(18, 8, "jam", true, this.wish("trex"));
          this.say(this.line("jam"), "bad", true);
        } else {
          this.note("T-Rex Trek's animatronic is \u201cjammed.\u201d", "you");
          this.closeLoc("trex", this.time + 45, "you");
        }
        return;
      }
      case "timeshare":
        l.timeshare = true;
        this.note("Next Starlight Theater show replaced with an exciting vacation-ownership opportunity.", "you");
        return;
      case "appcrash": {
        this.appDownUntil = until;
        this.note("The FunPass app is down. \u201cWe're aware of the issue.\u201d", "you");
        const g = this.g.act;
        if (g.t === "queue" && strength("aero", LOC[g.loc].zone) > 0) {
          const progress = 1 - g.left / g.total;
          this.hurt((5 + 25 * progress) * (g.wish?.def.weight ?? REPEAT_WEIGHT), 4 + 12 * progress, "app", true, g.wish);
          g.total = this.currentWait(g.loc);
          g.left = g.total;
          this.say(this.line("app"), "bad", true);
        }
        return;
      }
      case "dj":
        this.djUntil = until;
        this.djHit = false;
        this.note("DJ instructed to play \u201cGlitter Drop (Extended Mix)\u201d until further notice.", "you");
        return;
      case "splash":
        this.splashUntil = until;
        this.note("Splash zone set to \u201cmonsoon.\u201d", "you");
        return;
      case "rig":
        l.riggedUntil = until;
        this.note("Ring Toss pegs swapped for the slightly-too-wide ones.", "you");
        return;
      case "scenic": {
        l.scenicUntil = until;
        this.note("Bone Wars Mine Train switched to Scenic Mode. Very scenic. Very slow.", "you");
        const g = this.g.act;
        if (g.t === "busy" && g.loc === "minetrain") {
          g.left += 20;
          this.hurt(8, 5, "scenic", true, this.wish("minetrain"));
          this.say(this.line("scenic"), "bad", true);
        }
        return;
      }
      case "smoke":
        this.smokeUntil = until;
        this.smokeHit = false;
        this.note("Meteor smoke vents: OPEN. You can't see Brad. Brad can't see you. Nobody can hear anything.", "you");
        return;
      case "unplug": {
        const g = this.g.act;
        if (g.t === "busy" && g.loc === "arcade") {
          g.done = undefined;
          g.left = 0;
          const w = this.wish("game");
          this.hurt(16 * (w?.def.weight ?? REPEAT_WEIGHT), 8, "unplug", true, w);
          if (w) w.failed = true;
          this.say(this.line("unplug"), "bad", true);
        }
        this.note("Arcade Galaxy: \u201cpower surge.\u201d", "you");
        this.closeLoc("arcade", this.time + 60, "you");
        return;
      }
      case "scaffold":
        this.note("Scaffolding erected in front of The Bubble Wall. No one will ever take it down.", "you");
        this.closeLoc(t.id, this.time + 120, "you");
        return;
      case "foam":
        this.foamUntil = until;
        this.note("Foam cannons set to 11. The pier is now 40% foam by volume.", "you");
        if (this.guestZone() === "foam") this.soak();
        return;
      case "gas": {
        const g = this.g.act;
        if (g.t === "busy" && g.loc === "cruise") {
          g.left += 20;
          g.what = "Stranded mid-lagoon on the Party Cove Cruise";
          this.hurt(16, 8, "gas", true, this.wish("cruise"));
          this.say(this.line("gas"), "bad", true);
        } else {
          this.note("The Party Cove Cruise is \u201cout of gas.\u201d", "you");
          this.closeLoc("cruise", this.time + 45, "you");
        }
        return;
      }
      case "stoptrain":
        this.trainDownUntil = this.time + 30;
        this.note("The Prairie Line is stopped for a \u201csignal issue.\u201d", "you");
        if (this.aboard(this.g, "train")) {
          this.hurt(16, 8, "stuck");
          this.say(this.line("stuckTrain"), "bad", true);
        }
        return;
      case "stopsky":
        this.skyDownUntil = this.time + 20;
        this.note("Sky Buckets stopped. Gondolas swaying gently over the lagoon.", "you");
        if (this.aboard(this.g, "sky")) {
          this.hurt(18, 10, "stuck");
          this.say(this.line("stuckSky"), "bad", true);
        }
        return;
      case "tram":
        l.tramDown = true;
        this.note("Parking tram: OUT OF SERVICE. Lot Z is 1.4 miles away.", "you");
        return;
    }
  }

  private closeLoc(id: string, until: number, by: "you" | "park") {
    const l = this.locs[id];
    l.closedUntil = until;
    l.closedBy = by;
    const a = this.g.act;
    if (a.t === "queue" && a.loc === id) {
      const progress = 1 - a.left / a.total;
      const weight = a.wish?.def.weight ?? REPEAT_WEIGHT;
      const front = progress > 0.6;
      this.hurt((10 + 35 * progress) * weight, 6 + 20 * progress, front ? "closedFront" : "closed", by === "you", a.wish);
      this.say(front
        ? this.line("closedFront", { min: Math.round(a.total - a.left) }, a.wish?.def.who)
        : this.line("closedEarly", {}, a.wish?.def.who), "bad", true);
      if (a.wish) this.failWish(a.wish);
      this.decide();
    } else if (a.t === "busy" && a.loc === id && l.def.kind === "food") {
      this.hurt(8, 8, "fryer", by === "you");
      this.say(this.line("foodKicked"), "bad", true);
      this.decide();
    }
  }

  private failWish(w: Wish) {
    w.fails++;
    w.retryAt = this.time + 60;
    if (w.fails >= 2) {
      w.failed = true;
      w.revealed = true;
      this.note(`${w.def.who} has given up on: ${w.def.label}.`, "bad");
    }
  }

  private mimed() {
    this.hurt(10, 8, "scanner");
    this.g.act = { t: "busy", loc: "gate", left: 30, what: "Being mimed at by the ticket guy" };
    this.say(this.line("mimed"), "bad", true);
  }

  // ------------------------------------------------------------- guest AI

  private goTo(goal: Goal) {
    this.g.act = { t: "walk", goal };
    this.routeTo(this.g, LOC[goal.loc].node, this.blockedSet());
  }

  private pathLen(loc: string) {
    return this.routeCost(this.g, LOC[loc].node, this.blockedSet());
  }

  private nearest(kind: "restroom" | "food") {
    const opts = LOCS.filter((l) => l.kind === kind && (this.closedSeen[l.id] ?? 0) <= this.time);
    return opts.map((l) => ({ l, d: this.pathLen(l.id) })).sort((a, b) => a.d - b.d)[0]?.l;
  }

  private wish(id: string) { return this.wishes.find((w) => w.def.id === id); }
  private open(w?: Wish): w is Wish { return !!w && !w.done && !w.failed; }

  private decide() {
    const t = this.time;
    if (this.leaving || this.patience <= 0 || t >= CLOSE - 25) {
      if (!this.leaving) {
        this.leaving = true;
        if (this.patience <= 0) this.say(this.line("leaving"), "bad", true);
      }
      return this.goTo({ loc: "gate", purpose: "exit" });
    }
    if (!this.complained && this.patience < 30 && t < CLOSE - 60) {
      this.complained = true;
      this.say(this.line("complainGo"), "bad", true);
      this.pauses.push("They're heading to Guest Relations to complain!");
      return this.goTo({ loc: "relations", purpose: "complain" });
    }
    const merch = this.wish("merch");
    if (this.open(merch) && t >= 20 * 60 + 45) return this.announce(merch, "shop");
    const show = this.wish("show");
    if (this.open(show)) {
      const travel = this.pathLen(show.def.loc); // minutes
      const st = show.def.showTime!;
      if (t < st && t >= st - travel - 20) return this.announce(show, "show");
    }
    const bladderMax = this.trait("bladder") ? 60 : 75;
    if (this.bladder >= bladderMax) {
      const wc = this.nearest("restroom");
      if (wc) {
        this.say(this.line("needRestroom", {}, this.trait("bladder") ? "Gary" : undefined));
        return this.goTo({ loc: wc.id, purpose: "restroom" });
      }
    }
    if (this.hunger >= 65 && this.queasyUntil <= t) {
      const lunch = this.wish("lunch");
      if (this.open(lunch) && lunch.retryAt <= t) return this.announce(lunch, "food");
      const f = this.nearest("food");
      if (f) return this.goTo({ loc: f.id, purpose: "food" });
    }
    const rides = this.wishes.filter((w) => PLAYABLE.includes(LOC[w.def.loc].kind) && this.open(w) && w.retryAt <= t
      && (w.def.id !== "haunt" || t >= HAUNT));
    if (rides.length) {
      const best = rides.map((w) => ({ w, s: w.def.weight * 30 - this.pathLen(w.def.loc) * 1.5 }))
        .sort((a, b) => b.s - a.s)[0].w;
      return this.announce(best, "wish");
    }
    if (this.rng() < 0.75) {
      const near = LOCS.filter((l) => l.kind === "ride" && l.id !== this.lastRide && !this.isClosed(l.id) && (this.avoid[l.id] ?? 0) <= t)
        .map((l) => ({ l, d: this.pathLen(l.id) })).sort((a, b) => a.d - b.d).slice(0, 4);
      if (near.length) {
        const l = near[Math.floor(this.rng() * near.length)].l;
        this.say(this.line("reride", { name: l.name }));
        return this.goTo({ loc: l.id, purpose: "ride" });
      }
    }
    this.g.act = { t: "busy", loc: null, left: 25, what: "Sitting on a bench, judging people", done: () => this.joy(2, 3) };
  }

  private announce(w: Wish, purpose: Purpose) {
    if (this.heard()) {
      if (!w.revealed) {
        w.revealed = true;
        this.pauses.push(`You overheard: ${w.def.label}`);
      }
      this.say(`${w.def.who}: "${w.def.ask}"`);
    }
    this.goTo({ loc: w.def.loc, purpose, wish: w });
  }

  private arrive(goal: Goal) {
    const l = this.locs[goal.loc];
    const w = goal.wish;
    const yours = l.closedBy === "you";
    switch (goal.purpose) {
      case "gate":
        if (l.scannerBroken) return this.mimed();
        this.g.act = { t: "busy", loc: "gate", left: 5, what: "Getting tickets scanned" };
        return;
      case "complain":
        if (l.oldOwnerUntil > this.time) {
          this.hurt(14, 0, "complainBad");
          this.joy(0, 4);
          this.say(this.line("complainBad"), "bad", true);
        } else {
          this.joy(3, 14);
          this.suspicion += 10;
          this.say(this.line("complainOk"), "good", true);
          this.note("A complaint was filed. Management will be \u201clooking into it.\u201d (Suspicion +10)", "boss");
        }
        this.g.act = { t: "busy", loc: "relations", left: 10, what: "Talking to Guest Relations" };
        return;
      case "exit":
        if (l.tramDown) {
          this.hurt(14, 0, "tram");
          this.say(this.line("tram"), "bad", true);
        }
        this.g.act = { t: "gone" };
        this.end(this.time >= CLOSE - 25 ? "closed" : "left");
        return;
      case "wish": case "ride": {
        if (l.def.kind === "game" || l.def.kind === "photo") {
          if (this.isClosed(l.def.id)) {
            this.hurt(10 * (w?.def.weight ?? REPEAT_WEIGHT), 8, l.def.kind === "photo" ? "scaffold" : "closed", yours, w);
            this.say(this.line(l.def.kind === "photo" ? "scaffold" : "closedArrive", {}, w?.def.who), "bad", true);
            if (w) this.failWish(w);
            return this.decide();
          }
          this.g.act = { t: "queue", loc: l.def.id, total: 5, left: 5, wish: w };
          return;
        }
        if (this.isClosed(l.def.id)) {
          this.hurt(12 * (w?.def.weight ?? REPEAT_WEIGHT), 10, "closed", yours, w);
          this.say(this.line("closedArrive", {}, w?.def.who), "bad", true);
          if (w) this.failWish(w);
          return this.decide();
        }
        if (l.upchargeUntil > this.time) {
          this.hurt(14 * (w?.def.weight ?? REPEAT_WEIGHT), 8, "upcharge", true, w);
          this.say(this.line("upcharge"), "bad", true);
        }
        if (l.lockerUntil > this.time) {
          this.hurt(4, 2, "locker", true, w);
          this.say(this.line("locker"), "bad", true);
        }
        if (l.fansUntil > this.time) this.say(this.line("fans"), "bad", true);
        const wait = this.currentWait(l.def.id);
        this.g.act = { t: "queue", loc: l.def.id, total: wait, left: wait, wish: w };
        if (wait >= 50) this.say(this.line("longWait", { min: wait }));
        return;
      }
      case "food":
        if (this.isClosed(l.def.id)) {
          this.hurt(8 + this.hunger / 10, 10, "fryer", yours, w);
          this.say(this.line("foodClosed"), "bad", true);
          this.closedSeen[l.def.id] = l.closedUntil;
          if (w) w.retryAt = this.time + 60;
          return this.decide();
        }
        this.g.act = { t: "queue", loc: l.def.id, total: 10, left: 10, wish: w };
        return;
      case "restroom":
        if (this.isClosed(l.def.id)) {
          this.closedSeen[l.def.id] = l.closedUntil;
          this.hurt(6 + this.bladder / 8, 8, "restroom", yours);
          if (this.bladder >= 95) {
            this.say(this.line("dumpster"), "bad", true);
            this.hurt(15, 15, "restroom", yours);
            this.bladder = 0;
          } else {
            this.say(this.line("restroomClosed"), "bad", true);
          }
          return this.decide();
        }
        this.g.act = { t: "busy", loc: l.def.id, left: 5, what: "In the restroom", done: () => { this.bladder = 0; } };
        return;
      case "show": {
        const st = w!.def.showTime!;
        if (this.time > st) {
          // Only your fault if you actually held them up recently.
          const delayers = ["survey", "scenic", "detour", "parade", "stuck", "megaphone", "smoke", "gas", "jam"];
          const yoursLate = this.hits.some((h) => delayers.includes(h.reason) && this.time - h.time < 75);
          this.hurt(20 * w!.def.weight, 14, yoursLate ? "lateShow" : "lateShowPark", yoursLate, w);
          this.say(this.line("lateShow", {}, w!.def.who), "bad", true);
          w!.failed = true;
          return this.decide();
        }
        this.g.act = { t: "busy", loc: l.def.id, left: st - this.time, what: `Waiting for the ${l.def.showName}`, done: () => this.startShow(w!) };
        return;
      }
      case "shop":
        if (l.readerUntil > this.time) {
          this.hurt(12 * w!.def.weight, 6, "reader", true, w);
          this.say(this.line("cashOnly"), "bad", true);
          w!.failed = true;
          return this.decide();
        }
        this.g.act = {
          t: "busy", loc: l.def.id, left: 15, what: "Buying matching hoodies",
          done: () => { w!.done = true; this.joy(6, 6); this.say(this.line("merchDone"), "good"); },
        };
        return;
    }
  }

  private startShow(w: Wish) {
    const l = this.locs[w.def.loc];
    if (l.showCancelled) {
      this.hurt(28 * w.def.weight, 18, "show", true, w);
      this.say(this.line("showCancelled", {}, w.def.who), "bad", true);
      w.failed = true;
      return this.decide();
    }
    if (l.timeshare) {
      l.timeshare = false;
      this.say(this.line("timeshareStart"), "bad", true);
      this.g.act = {
        t: "busy", loc: l.def.id, left: 40, what: "Sitting through a timeshare presentation",
        done: () => {
          w.failed = true;
          this.hurt(22 * w.def.weight, 12, "timeshare", true, w);
          this.say(this.line("timeshareEnd"), "bad", true);
        },
      };
      return;
    }
    this.g.act = {
      t: "busy", loc: l.def.id, left: 40, what: `Watching the ${l.def.showName}`,
      done: () => { w.done = true; this.joy(10, 10); this.say(this.line("showDone", {}, w.def.who), "good"); },
    };
  }

  private finishQueue(a: Extract<Act, { t: "queue" }>) {
    const def = LOC[a.loc];
    if (def.kind === "food") {
      const l = this.locs[a.loc];
      const lunch = a.wish;
      this.g.act = {
        t: "busy", loc: a.loc, left: 20, what: `Eating at ${def.name}`,
        done: () => {
          this.hunger = 0;
          this.bladder += 15;
          if (lunch && this.trait("vegan") && l.vegSwap) {
            l.vegSwap = false;
            this.hurt(25 * lunch.def.weight, 15, "veg", true, lunch);
            this.say(this.line("veg"), "bad", true);
            lunch.failed = true;
            lunch.revealed = true;
          } else if (lunch) {
            lunch.done = true;
            this.joy(5, 6);
            this.say(this.line("lunchOk", {}, lunch.def.who), "good");
          } else {
            this.hurt(3, 2, "food", false);
            this.say(this.line("foodBad"));
          }
        },
      };
      return;
    }
    if (def.kind === "game" || def.kind === "photo") {
      const game = def.kind === "game";
      this.g.act = {
        t: "busy", loc: a.loc, left: game ? 10 : 3, what: game ? `Playing at ${def.name}` : `Posing at ${def.name}`,
        done: () => {
          const w = a.wish;
          if (game && this.locs[a.loc].riggedUntil > this.time) {
            this.hurt(12 * (w?.def.weight ?? REPEAT_WEIGHT), 6, "rigged", true, w);
            this.say(this.line("rigged"), "bad", true);
            if (w) w.failed = true;
            return;
          }
          if (w) { w.done = true; this.joy(4, 6); }
          this.say(this.line(game ? "gameWin" : "photoOk", {}, w?.def.who), "good");
        },
      };
      return;
    }
    const scenic = a.loc === "minetrain" && this.locs.minetrain.scenicUntil > this.time;
    if (scenic) {
      this.hurt(8, 5, "scenic", true, a.wish);
      this.say(this.line("scenic"), "bad", true);
    }
    this.g.act = {
      t: "busy", loc: a.loc, left: (def.rideMin ?? 5) + (scenic ? 20 : 0),
      what: scenic ? "On the mine train, in Scenic Mode. So scenic." : `Riding ${def.name}`,
      done: () => {
        this.lastRide = a.loc;
        if (def.wet && (this.splashUntil > this.time || (this.foamUntil > this.time && def.zone === "foam"))) this.soak();
        const sp = strength("passport", def.zone);
        if (sp > 0 && this.spinUntil > this.time && this.queasyUntil <= this.time && (sp >= 1 || this.rng() < 0.5)) {
          this.queasyUntil = this.time + 60;
          this.hurt(6, 4, "queasy");
          this.say(this.line("queasy"), "bad", true);
        }
        if (a.loc === "barn" && this.locs.barn.monstersUntil > this.time) {
          this.hurt(18 * (a.wish?.def.weight ?? REPEAT_WEIGHT), 8, "monsters", true, a.wish);
          this.say(this.line("monsters"), "bad", true);
          if (a.wish) a.wish.failed = true;
          return;
        }
        if (a.wish) { a.wish.done = true; this.joy(6, 8); } else this.joy(3, 4);
        this.say(this.line("rideDone", {}, a.wish?.def.who), "good");
      },
    };
  }

  private end(why: EndReason) {
    if (this.ended) return;
    this.ended = { why, at: this.time };
  }

  // ------------------------------------------------------------- tick

  step(minutes: number) {
    let left = minutes;
    while (left > 0 && !this.ended) {
      const dt = Math.min(STEP, left);
      left -= dt;
      this.tick(dt);
    }
  }

  private tick(dt: number) {
    this.time += dt;
    this.hunger = Math.min(100, this.hunger + 0.12 * dt);
    this.bladder = Math.min(100, this.bladder + (this.trait("bladder") ? 0.26 : 0.2) * dt);
    this.suspicion = Math.max(0, this.suspicion - 0.05 * dt);

    for (const at of this.breakdowns) {
      if (at > this.time - dt && at <= this.time) {
        const rides = LOCS.filter((d) => d.kind === "ride" && !this.isClosed(d.id));
        const d = rides[Math.floor(this.rng() * rides.length)];
        this.note(`${d.name} broke down all by itself. Classic. (Cover for you.)`, "park");
        this.suspicion = Math.max(0, this.suspicion - 6);
        this.closeLoc(d.id, this.time + 45, "park");
      }
    }
    this.tickDuty();
    this.tickDayArc();
    this.tickBrad(dt);
    if (this.g.act.t !== "gone" && this.time >= OPEN) {
      if (this.soakedUntil > this.time) { this.addMisery(0.06 * dt, "soaked"); this.patience -= 0.03 * dt; }
      if (this.queasyUntil > this.time) this.addMisery(0.05 * dt, "queasy");
      const djs = strength("mirrorball", this.guestZone());
      if (this.foamUntil > this.time && this.guestZone() === "foam") {
        this.soak();
        this.addMisery(0.12 * dt, "foam");
      }
      if (this.inSmoke(this.guestZone()) && this.g.act.t === "walk") {
        this.addMisery(0.05 * dt, "smoke");
        if (!this.smokeHit) { this.smokeHit = true; this.say(this.line("smoke"), "bad", true); }
      }
      if (this.djUntil > this.time && djs > 0) {
        this.addMisery(0.25 * djs * dt, "dj");
        this.patience -= 0.06 * djs * dt;
        if (!this.djHit) {
          this.djHit = true;
          this.hits.push({ time: this.time, reason: "dj" });
          this.say(this.line("dj"), "bad", true);
        }
      }
    }
    if (this.time >= this.nextAmbient) {
      this.nextAmbient = this.time + this.between(45, 75);
      this.note(AMBIENT[Math.floor(this.rng() * AMBIENT.length)], "park");
    }

    if (this.suspicion >= 100) {
      this.suspicion = 100;
      this.note("Management has reviewed the incident log. You're fired.", "bad");
      return this.end("fired");
    }
    if (this.time >= CLOSE) return this.end("closed");

    this.tickGuests(dt);
    this.tickWorker(dt);
    if (this.patience <= 0 && !this.leaving && this.g.act.t !== "gone") this.decide();
  }

  private banner(text: string) {
    this.banners.push(text);
    this.note(text, "park");
  }

  private tickDayArc() {
    if (!this.heatOn && this.time >= HEAT[0]) {
      this.heatOn = true;
      this.banner("\u2600\ufe0f Heat advisory until 4 PM. Every line is a slow-cook.");
    }
    if (!this.rained && this.time >= this.rainAt) {
      this.rained = true;
      this.rainUntil = this.time + 35;
      this.banner("\ud83c\udf27\ufe0f Surprise storm! Outdoor coasters closed for lightning. Not your fault. (Cover!)");
      this.suspicion = Math.max(0, this.suspicion - 6);
      for (const l of LOCS) if (l.outdoor && !this.isClosed(l.id)) this.closeLoc(l.id, this.rainUntil, "park");
      // Lightning also stops the Sky Buckets, with whoever's aboard.
      this.skyDownUntil = Math.max(this.skyDownUntil, this.rainUntil);
      if (this.aboard(this.g, "sky")) {
        this.hurt(10, 6, "stuck", false);
        this.say(this.line("stuckSky"), "bad", true);
      }
      if (this.g.act.t === "walk") this.soak(false);
    }
    if (!this.hauntOpen && this.time >= HAUNT) {
      this.hauntOpen = true;
      this.banner("\ud83c\udf83 The Haunt is open! Scare Barn monsters report for duty. Most of them.");
    }
  }

  private tickBrad(dt: number) {
    const b = this.brad;
    if (!b.route.length) {
      if (b.pause > 0) { b.pause -= dt; return; }
      let target: string;
      if (this.suspicion >= 75) target = this.w.route[0] ?? this.w.prev;
      else {
        const zone = this.suspicion >= 50 ? NODES[this.w.prev].zone : null;
        const ids = Object.values(NODES)
          .filter((n) => !/^t\d+$/.test(n.id) && n.id !== "lot" && (!zone || near(zone, n.zone) > 0)).map((n) => n.id);
        target = ids[Math.floor(this.rng() * ids.length)];
      }
      b.pause = this.suspicion >= 75 ? 0.5 : this.between(4, 10);
      this.routeTo(b, target);
    } else if (this.suspicion >= 75) {
      this.bradTimer -= dt;
      if (this.bradTimer <= 0) {
        this.bradTimer = 2;
        this.routeTo(b, this.w.route[0] ?? this.w.prev);
      }
    }
    this.move(b, BRAD_SPEED * (this.suspicion >= 75 ? 1.25 : 1), dt);
  }

  private tickDuty() {
    if (this.duty && this.time > this.duty.deadline) {
      this.dutiesMissed++;
      this.suspicion += 8;
      this.note(`Brad: "I didn't see you at ${LOC[this.duty.loc].name}. I'll be making a note."`, "boss");
      this.duty = null;
      this.nextDutyAt = this.time + this.between(90, 130);
    }
    if (!this.duty && this.time >= this.nextDutyAt && this.time < CLOSE - 90) {
      const opts = LOCS.filter((l) => l.kind !== "gate" && l.kind !== "station");
      const l = opts[Math.floor(this.rng() * opts.length)];
      const deadline = this.time + 75;
      this.duty = { loc: l.id, deadline, text: dutyText(this.rng, l.name, fmtTime(deadline)) };
      this.note(`Brad (radio): "${this.duty.text}"`, "boss");
      this.pauses.push(`New duty: ${l.name}`);
    }
  }

  private tickGuests(dt: number) {
    const g = this.g, a = g.act;
    switch (a.t) {
      case "walk": {
        const blocked = this.blockedSet();
        if (g.route.some((n, k) => k < g.route.length - 1 && blocked.has(n))) {
          this.routeTo(g, LOC[a.goal.loc].node, blocked);
          this.hurt(1, 1, "detour");
          this.say(this.line("detour"), "bad", true);
        }
        this.patience -= 0.015 * dt;
        const main = (n?: string) => n === "depot" || n === "depot_b";
        if (this.paradeUntil > this.time && (main(g.route[0]) || (main(g.prev) && g.route.length))) {
          if (!this.paradeHit) {
            this.paradeHit = true;
            this.hurt(6, 4, "parade");
            this.say(this.line("parade"), "bad", true);
          }
          break;
        }
        const before = g.prev;
        const arrived = this.move(g, GUEST_SPEED * (this.inSmoke(NODES[g.prev].zone) ? 0.6 : 1), dt);
        if (g.prev !== before && !this.aboard(g)) {
          const s = strength("lagoon", NODES[g.prev].zone);
          if (this.splashUntil > this.time && s > 0 && (s >= 1 || this.rng() < 0.5)) this.soak();
          if (this.foamUntil > this.time && NODES[g.prev].zone === "foam") this.soak();
        }
        if (arrived) this.arrive(a.goal);
        break;
      }
      case "queue": {
        a.left -= dt * (this.isSlow(a.loc) ? 0.5 : 1);
        this.patience -= (this.trait("impatient") ? 0.065 : 0.045) * dt;
        if (this.locs[a.loc].lockerUntil > this.time) this.addMisery(0.15 * dt, "locker"); // the meter is running
        if (this.locs[a.loc].fansUntil > this.time) {
          const hot = this.heat();
          this.addMisery((hot ? 0.2 : 0.07) * dt, "fans");
          this.patience -= (hot ? 0.05 : 0.015) * dt;
        }
        if (this.heat()) this.patience -= 0.02 * dt; // heat advisory
        if (this.isSlow(a.loc)) {
          this.slowQueueAt = this.time;
          this.addMisery(0.12 * dt, "slow");
          this.patience -= 0.04 * dt;
          this.slowSuffered = true;
        }
        if (a.left <= 0) this.finishQueue(a);
        break;
      }
      case "busy":
        a.left -= dt;
        if (a.left <= 0) {
          a.done?.();
          if (this.g.act === a) this.decide();
        }
        break;
    }
  }

  private tickWorker(dt: number) {
    const w = this.w;
    if (w.task) {
      w.task.left -= dt;
      if (w.task.left <= 0) {
        const t = w.task;
        w.task = null;
        this.finishTask(t);
      }
      return;
    }
    if (w.follow || w.pending?.target.kind === "guests") {
      this.followTimer -= dt;
      if (this.followTimer <= 0 || !w.route.length) {
        this.followTimer = 2;
        if (dist(w.pos, this.g.pos) > 1.5) this.routeTo(w, this.g.route[0] ?? this.g.prev);
        else w.route = [];
      }
    }
    this.move(w, this.workerSpeed(), dt);
    const p = w.pending;
    if (!p?.action) return;
    if (p.target.kind === "guests" ? this.nearGuests(p.action.id === "megaphone" ? EARSHOT : REACH) : !w.route.length) {
      const why = this.cantDo(p.target, p.action);
      w.pending = null;
      if (why) this.note(`Couldn't do it: ${why}.`, "you");
      else this.startTask(p.target, p.action);
    }
  }

  // ------------------------------------------------------------- results

  result() {
    const why = this.ended?.why ?? "closed";
    const mult = why === "closed" ? 1.5 : why === "left" ? 1 : 0.25;
    const score = Math.round(this.misery * mult);
    const reasons = new Set(this.hits.map((h) => h.reason));
    const lines: string[] = [];
    const add = (r: string, s: string) => reasons.has(r) && lines.push(s);
    add("closedFront", "Waited forever for a ride and they closed it RIGHT as we got to the front.");
    add("closed", "Half the rides were “down for maintenance.”");
    add("veg", "I asked for the vegan option. It had a bone in it.");
    add("fryer", "We could not find food that was open. At a THEME PARK.");
    add("restroom", "Every bathroom was out of order. My husband used a dumpster.");
    add("show", "The show was cancelled after we waited around for it.");
    if (reasons.has("lateShow")) lines.push(reasons.has("survey")
      ? "Some employee kept us for a “survey” and we missed the show."
      : "Everything in this park made us late. We missed the show.");
    add("survey", "A guy with a clipboard would not stop asking us questions.");
    add("detour", "Wet Floor signs everywhere. It hasn't rained in weeks.");
    add("reader", "Gift shop was cash only. In this economy.");
    add("scanner", "Staff pretended to scan our tickets. Like, mimed it.");
    add("parade", "Got trapped behind a \u201cparade.\u201d It was four people and a golf cart.");
    add("queasy", "The teacups were set to something illegal. My wife couldn't eat for an hour.");
    add("jam", "Stuck on T-Rex Trek for 25 minutes while it roared at us. My kids are in therapy. We don't have kids.");
    add("timeshare", "The \u201cshow\u201d was a timeshare pitch. We own part of a condo in Branson now.");
    add("app", "Their app erased us from a line we were physically standing in.");
    add("dj", "The disco area played ONE song. For an hour. I can still hear it.");
    add("fans", "The queue fans were unplugged. During a HEAT ADVISORY.");
    add("monsters", "The Haunt had no monsters. Just a guy eating a pretzel.");
    add("megaphone", "Staff kept announcing rides were closed. They weren't. Or were they?");
    add("upcharge", "They charged us EXTRA for the haunted barn. We have season passes.");
    add("locker", "The locker charged by the minute because THEIR line was slow.");
    add("complainBad", "Guest Relations said it was the old company's policy. Which old company?!");
    add("soaked", "Got soaked walking PAST the lagoon. Walking. Past it.");
    add("rigged", "The ring toss is rigged. I have a physics degree. It is RIGGED.");
    add("unplug", "Arcade 'power surge' right before my high score. Sure.");
    add("scaffold", "Drove four hours for one photo at the Bubble Wall. It was under scaffolding.");
    add("smoke", "Some 'meteor' smoke show. Couldn't see my own hands for half an hour.");
    add("gas", "The party boat ran out of gas in the middle of a man-made lake.");
    add("stuck", "Got stuck on their train/gondola. A guy sold us water through the window.");
    add("tram", "The parking tram was 'out of service.' Lot Z is in another county.");
    add("scenic", "The mine train has a 'scenic mode.' It's just slow. It's SLOW mode.");
    if (this.slowSuffered) lines.push("The lines did not move. I aged.");
    if (!lines.length) lines.push("Honestly? Kind of a nice day. Lines were long, I guess.");
    const stars = Math.max(1, 5 - Math.floor(this.misery / 40));
    const done = this.wishes.filter((w) => w.done).length;
    const { grade } = this.grade(why, score);
    const memo =
      why === "fired" ? "Your badge has been deactivated. Please return your vest. — Brad"
        : grade === "S" || grade === "A" ? "Guest satisfaction is at an all-time low. Promotion pending. — The New Owners"
        : grade === "B" ? "Solid work. Per-guest spend is down, morale is down, we're thrilled. — The New Owners"
        : grade === "C" ? "Mixed results. They bought a souvenir. We'll be circling back. — Brad"
        : "They had FUN? We'll be discussing this at your review. — The New Owners";
    return {
      why, mult, score, misery: Math.round(this.misery), stars, lines, done, total: this.wishes.length, memo,
      duties: `${this.dutiesDone} done, ${this.dutiesMissed} skipped`,
      combos: [...new Set(this.combosHit)].map((id) => COMBO[id].name),
      ...this.grade(why, score),
      breakdown: this.breakdown(),
    };
  }

  private grade(why: EndReason, score: number) {
    if (why === "fired") return { grade: "F", title: "Escorted Off Property" };
    const g: [number, string, string][] = [
      [400, "S", "Employee of the Month (Derogatory)"],
      [280, "A", "Rising Star in Guest Disappointment"],
      [190, "B", "Solidly Mediocre Saboteur"],
      [110, "C", "Accidentally Helpful"],
      [50, "D", "Basically Customer Service"],
    ];
    for (const [min, grade, title] of g) if (score >= min) return { grade, title };
    return { grade: "F", title: "They Had a Nice Day. Shameful." };
  }

  private breakdown() {
    const by: Record<string, number> = {};
    for (const [r, m] of Object.entries(this.miseryBy)) {
      const cat = CATEGORY[r] ?? "Other";
      by[cat] = (by[cat] ?? 0) + m;
    }
    return Object.entries(by).map(([label, value]) => ({ label, value: Math.round(value) }))
      .filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  }
}

export function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
