// Gameplay simulation, v1. Pure logic, no rendering. Time is in game minutes
// since midnight; positions are in tiles (i, j). The UI calls step(), the
// worker commands (walkTo / doAction / setFollow) and reads the state.

import {
  ACTIONS, ActionDef, ActionId, SPECIAL, TOOL, ToolId, TraitId, WishDef, dutyText, makeDay,
} from "./content";
import { LOC, LOCS, LocDef, LandId, NODES, shortest } from "./park";

export const OPEN = 10 * 60;
export const CLOSE = 22 * 60;

const STEP = 0.5;
const GUEST_SPEED = 1.5; // tiles per game minute
const WORKER_SPEED = 1.9;
const EARSHOT = 9; // tiles
const WITNESS = 5;
const REACH = 2.5; // how close you must be to talk to them
const PATIENCE_HIT = 1.3;
const REPEAT_WEIGHT = 0.7;

export interface P { i: number; j: number }
const dist = (a: P, b: P) => Math.hypot(a.i - b.i, a.j - b.j);

export function fmtTime(min: number) {
  const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

interface Mover { pos: P; route: string[]; prev: string }

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
}

export interface Wish { def: WishDef; done: boolean; failed: boolean; revealed: boolean; fails: number; retryAt: number }

type Purpose = "wish" | "ride" | "food" | "restroom" | "show" | "shop" | "exit" | "gate";
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
  alibi: { land: LandId; until: number } | null = null;
  thought = "";
  thoughtUntil = 0;
  log: LogEntry[] = [];
  pauses: string[] = [];
  ended: { why: EndReason; at: number } | null = null;
  churroReady = 0;
  slowSuffered = false;
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
        showCancelled: false, scannerBroken: false, readyAt: {},
      };
    }
    const day = makeDay(this.rng);
    this.traits = day.traits;
    this.wishes = day.wishes.map((def) => ({ def, done: false, failed: false, revealed: false, fails: 0, retryAt: 0 }));
    for (const w of this.shuffle([...this.wishes]).slice(0, 2)) w.revealed = true;
    this.breakdowns = [this.between(11 * 60, 14 * 60), this.between(14 * 60, 17 * 60), this.between(17 * 60, 20 * 60)];
    const gate = NODES.G;
    this.g = { pos: { i: gate.i + 2, j: gate.j + 2 }, route: ["G"], prev: "G", act: { t: "walk", goal: { loc: "gate", purpose: "gate" } } };
    this.w = { pos: { i: NODES.M1.i, j: NODES.M1.j }, route: [], prev: "M1", task: null, pending: null, follow: false };
    this.note("The Hendersons are pulling up to the Front Gate. Those ticket scanners look… fragile.", "park");
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
    return Math.round(base * crowd * (this.isSlow(id) ? 2 : 1));
  }

  workerSpeed() { return WORKER_SPEED * (this.has("cart") ? 1.8 : 1); }
  heard() { return this.has("radio") || dist(this.w.pos, this.g.pos) <= EARSHOT; }
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
    if (a.t === "walk") return this.heard() ? `Walking to ${LOC[a.goal.loc].name}` : "Walking somewhere… (too far to hear)";
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
    return this.routeCost(this.w, node, new Set()) / this.workerSpeed();
  }

  // ------------------------------------------------------------- movement

  private routeCost(m: Mover, target: string, blocked: Set<string>) {
    return this.plan(m, target, blocked)?.cost ?? Infinity;
  }

  private plan(m: Mover, target: string, blocked: Set<string>) {
    const a = m.prev, b = m.route[0];
    const opts: { cost: number; route: string[] }[] = [];
    const ra = shortest(a, target, blocked);
    if (ra) {
      const d = dist(m.pos, NODES[a]);
      opts.push({ cost: d + ra.len, route: d < 0.05 ? ra.path.slice(1) : ra.path });
    }
    if (b && b !== a) {
      const rb = shortest(b, target, blocked);
      if (rb) opts.push({ cost: dist(m.pos, NODES[b]) + rb.len, route: rb.path });
    }
    if (!opts.length) return null;
    return opts.sort((x, y) => x.cost - y.cost)[0];
  }

  private routeTo(m: Mover, target: string, blocked = new Set<string>()) {
    const p = this.plan(m, target, blocked) ?? this.plan(m, target, new Set());
    m.route = p ? p.route : [];
  }

  /** Advance a mover; returns true when it has arrived (route empty). */
  private move(m: Mover, speed: number, dt: number) {
    let left = speed * dt;
    while (left > 0 && m.route.length) {
      const n = NODES[m.route[0]];
      const d = dist(m.pos, n);
      if (d <= left) {
        m.pos = { i: n.i, j: n.j };
        m.prev = m.route.shift()!;
        left -= d;
      } else {
        m.pos = { i: m.pos.i + ((n.i - m.pos.i) / d) * left, j: m.pos.j + ((n.j - m.pos.j) / d) * left };
        left = 0;
      }
    }
    return !m.route.length;
  }

  // ------------------------------------------------------------- logging

  private say(text: string, kind: LogKind = "guest", always = false) {
    if (!always && !this.heard()) return;
    this.thought = text;
    this.thoughtUntil = this.time + 14;
    this.note(text, kind);
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

  private hurt(misery: number, patience: number, reason: string, yours = true) {
    this.misery += misery;
    this.patience -= patience * PATIENCE_HIT;
    if (yours) {
      this.suspicion += 2 * this.recent(this.hits.filter((h) => !h.reason.startsWith("park:")).map((h) => h.time));
      this.hits.push({ time: this.time, reason });
    } else {
      this.hits.push({ time: this.time, reason: "park:" + reason });
    }
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
        if (!a.kinds?.includes(kind)) continue;
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
    if (t.kind === "guests") return this.nearGuests() ? 0 : dist(this.w.pos, this.g.pos) / this.workerSpeed();
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
      if (a.id === "survey" && this.g.act.t !== "walk") return "Only while they're walking";
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
    const land = t.kind === "loc" ? this.locs[t.id].def.land : t.kind === "node" ? NODES[t.id].land : null;
    if (land && this.alibi && this.alibi.land === land && this.alibi.until > this.time) c *= 0.6;
    if (this.suspicion >= 75) c *= 1.5;
    return Math.round(c + 3 * this.recent(this.sabLog));
  }

  isWitnessed(t: Target) {
    const where = t.kind === "guests" ? null : this.targetNode(t);
    return !!where && !this.has("mascot") && dist(this.g.pos, NODES[where]) <= WITNESS;
  }

  hasAlibi(land: LandId) { return !!this.alibi && this.alibi.land === land && this.alibi.until > this.time; }

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
      this.say(`Gary: "I—sure. Quick, right?"`, "guest", true);
    }
  }

  private finishTask(task: Task) {
    const { action: a, target: t } = task;
    const cost = this.suspCost(t, a);
    if (a.tool && TOOL[a.tool].charges) this.tools[a.tool]! -= 1;
    if (a.cooldown && t.kind === "loc") this.locs[t.id].readyAt[a.id] = this.time + a.cooldown;
    if (a.susp > 0) this.sabLog.push(this.time);
    this.suspicion = Math.max(0, this.suspicion + cost);
    const until = this.time + (a.duration ?? 0);

    if (t.kind === "guests") {
      if (a.id === "churro") {
        this.churroReady = this.time + (a.cooldown ?? 90);
        this.joy(0, 6);
        this.say(`Deb: "Oh! A free churro. Thank you, sweetie."`, "good", true);
      } else if (a.id === "voucher") {
        this.joy(5, 15);
        const g = this.g.act;
        if (g.t === "queue") g.left = Math.min(g.left, 2);
        this.say(`Gary: "A free FastPass? Okay, this place isn't ALL bad."`, "good", true);
      } else if (a.id === "survey") {
        this.hurt(5, 3, "survey");
        this.say(`Deb: "That was NOT a quick survey."`, "bad", true);
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
        this.alibi = { land: l.def.land, until: this.time + 60 };
        this.nextDutyAt = this.time + this.between(90, 130);
        this.note(`Duty done. Manager: "Noted." (You have an alibi around here for an hour.)`, "boss");
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
      this.hurt((10 + 35 * progress) * weight, 6 + 20 * progress, front ? "closedFront" : "closed", by === "you");
      this.say(front
        ? `${this.who(a.wish)}: "We were RIGHT THERE. ${Math.round(a.total - a.left)} minutes!"`
        : `${this.who(a.wish)}: "It's closing? We just got in line."`, "bad", true);
      if (a.wish) this.failWish(a.wish);
      this.decide();
    } else if (a.t === "busy" && a.loc === id && l.def.kind === "food") {
      this.hurt(8, 8, "fryer", by === "you");
      this.say(`Deb: "They're kicking us out mid-bite?"`, "bad", true);
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
    this.say(`Gary: "Did it… beep? Is that a yes?"`, "bad", true);
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
        if (this.patience <= 0) this.say(`Deb: "That's it. We're going home."`, "bad", true);
      }
      return this.goTo({ loc: "gate", purpose: "exit" });
    }
    const merch = this.wish("merch");
    if (this.open(merch) && t >= 20 * 60 + 45) return this.announce(merch, "shop");
    const show = this.wish("show");
    if (this.open(show)) {
      const travel = this.pathLen(show.def.loc) / GUEST_SPEED;
      const st = show.def.showTime!;
      if (t < st && t >= st - travel - 20) return this.announce(show, "show");
    }
    const bladderMax = this.trait("bladder") ? 60 : 75;
    if (this.bladder >= bladderMax) {
      const wc = this.nearest("restroom");
      if (wc) {
        this.say(`Gary: "I gotta find a bathroom."`);
        return this.goTo({ loc: wc.id, purpose: "restroom" });
      }
    }
    if (this.hunger >= 65) {
      const lunch = this.wish("lunch");
      if (this.open(lunch) && lunch.retryAt <= t) return this.announce(lunch, "food");
      const f = this.nearest("food");
      if (f) return this.goTo({ loc: f.id, purpose: "food" });
    }
    const rides = this.wishes.filter((w) => LOC[w.def.loc].kind === "ride" && this.open(w) && w.retryAt <= t);
    if (rides.length) {
      const best = rides.map((w) => ({ w, s: w.def.weight * 30 - this.pathLen(w.def.loc) }))
        .sort((a, b) => b.s - a.s)[0].w;
      return this.announce(best, "wish");
    }
    if (this.rng() < 0.75) {
      const near = LOCS.filter((l) => l.kind === "ride" && l.id !== this.lastRide && !this.isClosed(l.id))
        .map((l) => ({ l, d: this.pathLen(l.id) })).sort((a, b) => a.d - b.d).slice(0, 4);
      if (near.length) {
        const l = near[Math.floor(this.rng() * near.length)].l;
        this.say(`${this.who()}: "${l.name}? Why not."`);
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
      case "exit":
        this.g.act = { t: "gone" };
        this.end(this.time >= CLOSE - 25 ? "closed" : "left");
        return;
      case "wish": case "ride": {
        if (this.isClosed(l.def.id)) {
          this.hurt(12 * (w?.def.weight ?? REPEAT_WEIGHT), 10, "closed", yours);
          this.say(`${this.who(w)}: "Closed?! We walked all the way here."`, "bad", true);
          if (w) this.failWish(w);
          return this.decide();
        }
        const wait = this.currentWait(l.def.id);
        this.g.act = { t: "queue", loc: l.def.id, total: wait, left: wait, wish: w };
        if (wait >= 50) this.say(`Gary: "${wait} minutes?! …Fine."`);
        return;
      }
      case "food":
        if (this.isClosed(l.def.id)) {
          this.hurt(8 + this.hunger / 10, 10, "fryer", yours);
          this.say(`Deb: "Closed? I'm going to eat my own arm."`, "bad", true);
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
            this.say(`Gary: "I am going behind that dumpster. Don't look."`, "bad", true);
            this.hurt(15, 15, "restroom", yours);
            this.bladder = 0;
          } else {
            this.say(`Gary: "OUT OF ORDER?! Where's the next one?"`, "bad", true);
          }
          return this.decide();
        }
        this.g.act = { t: "busy", loc: l.def.id, left: 5, what: "In the restroom", done: () => { this.bladder = 0; } };
        return;
      case "show": {
        const st = w!.def.showTime!;
        if (this.time > st) {
          this.hurt(20 * w!.def.weight, 14, "lateShow");
          this.say(`Deb: "It already STARTED? They won't let us in?!"`, "bad", true);
          w!.failed = true;
          return this.decide();
        }
        this.g.act = { t: "busy", loc: l.def.id, left: st - this.time, what: `Waiting for the ${l.def.showName}`, done: () => this.startShow(w!) };
        return;
      }
      case "shop":
        if (l.readerUntil > this.time) {
          this.hurt(12 * w!.def.weight, 6, "reader");
          this.say(`Gary: "Cash only? Who carries cash?"`, "bad", true);
          w!.failed = true;
          return this.decide();
        }
        this.g.act = {
          t: "busy", loc: l.def.id, left: 15, what: "Buying matching hoodies",
          done: () => { w!.done = true; this.joy(6, 6); this.say(`Deb: "We look SO cute."`, "good"); },
        };
        return;
    }
  }

  private startShow(w: Wish) {
    const l = this.locs[w.def.loc];
    if (l.showCancelled) {
      this.hurt(28 * w.def.weight, 18, "show");
      this.say(`Deb: "Cancelled? We waited out here for nothing!"`, "bad", true);
      w.failed = true;
      return this.decide();
    }
    this.g.act = {
      t: "busy", loc: l.def.id, left: 40, what: `Watching the ${l.def.showName}`,
      done: () => { w.done = true; this.joy(10, 10); this.say(`Deb: "That was a NATIONAL TREASURE."`, "good"); },
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
            this.hurt(25 * lunch.def.weight, 15, "veg");
            this.say(`Deb: "Why does my vegan burger have a BONE in it?"`, "bad", true);
            lunch.failed = true;
            lunch.revealed = true;
          } else if (lunch) {
            lunch.done = true;
            this.joy(5, 6);
            this.say(`Deb: "Huh. It's actually not bad."`, "good");
          } else {
            this.hurt(3, 2, "food", false);
            this.say(`Gary: "This corn dog is cold in the middle."`);
          }
        },
      };
      return;
    }
    this.g.act = {
      t: "busy", loc: a.loc, left: def.rideMin ?? 5, what: `Riding ${def.name}`,
      done: () => {
        this.lastRide = a.loc;
        if (a.wish) { a.wish.done = true; this.joy(6, 8); } else this.joy(3, 4);
        this.say(`${this.who(a.wish)}: "WOOO! Again!"`, "good");
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

  private tickDuty() {
    if (this.duty && this.time > this.duty.deadline) {
      this.dutiesMissed++;
      this.suspicion += 8;
      this.note(`Manager: "I didn't see you at ${LOC[this.duty.loc].name}. I'll be making a note."`, "boss");
      this.duty = null;
      this.nextDutyAt = this.time + this.between(90, 130);
    }
    if (!this.duty && this.time >= this.nextDutyAt && this.time < CLOSE - 90) {
      const opts = LOCS.filter((l) => l.kind !== "gate");
      const l = opts[Math.floor(this.rng() * opts.length)];
      const deadline = this.time + 75;
      this.duty = { loc: l.id, deadline, text: dutyText(this.rng, l.name, fmtTime(deadline)) };
      this.note(`Manager: "${this.duty.text}"`, "boss");
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
          this.say(`Deb: "Wet floor? Again? We have to go AROUND."`, "bad", true);
        }
        this.patience -= 0.015 * dt;
        if (this.move(g, GUEST_SPEED, dt)) this.arrive(a.goal);
        break;
      }
      case "queue": {
        a.left -= dt * (this.isSlow(a.loc) ? 0.5 : 1);
        this.patience -= (this.trait("impatient") ? 0.065 : 0.045) * dt;
        if (this.isSlow(a.loc)) {
          this.misery += 0.12 * dt;
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
    if (p.target.kind === "guests" ? this.nearGuests() : !w.route.length) {
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
    add("lateShow", "Some employee kept us for a “survey” and we missed the show.");
    add("survey", "A guy with a clipboard would not stop asking us questions.");
    add("detour", "Wet Floor signs everywhere. It hasn't rained in weeks.");
    add("reader", "Gift shop was cash only. In this economy.");
    add("scanner", "Staff pretended to scan our tickets. Like, mimed it.");
    if (this.slowSuffered) lines.push("The lines did not move. I aged.");
    if (!lines.length) lines.push("Honestly? Kind of a nice day. Lines were long, I guess.");
    const stars = Math.max(1, 5 - Math.floor(this.misery / 40));
    const done = this.wishes.filter((w) => w.done).length;
    const memo =
      why === "fired" ? "Your badge has been deactivated. Please return your vest. — Mgmt"
        : score >= 200 ? "Guest satisfaction is at an all-time low. Promotion pending. — The New Owners"
        : score >= 100 ? "Solid work. Per-guest spend is down, morale is down, we're thrilled. — The New Owners"
        : "They had FUN? We'll be discussing this at your review. — The New Owners";
    return {
      why, mult, score, misery: Math.round(this.misery), stars, lines, done, total: this.wishes.length, memo,
      duties: `${this.dutiesDone} done, ${this.dutiesMissed} skipped`,
    };
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
