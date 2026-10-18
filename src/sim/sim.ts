// Gameplay-test simulation. Pure logic, no rendering: time is in game minutes
// since midnight, positions are in tiles. The UI calls step() and sabotage().

import {
  CLOSE, GUEST_NAMES, LOCS, LocDef, OPEN, SABOTAGES, SabDef, SabId, WISHLIST, WishDef,
} from "./data";

export interface P { i: number; j: number }

export interface LocState {
  def: LocDef;
  closedUntil: number;
  closedBy: "you" | "park" | null;
  slowUntil: number;
  vegSwap: boolean;
  readerUntil: number;
  showCancelled: boolean;
  scannerBroken: boolean;
  readyAt: Partial<Record<SabId, number>>;
  used: Set<SabId>;
}

export interface Wish { def: WishDef; done: boolean; failed: boolean; revealed: boolean; fails: number; retryAt: number }

type Purpose = "wish" | "food" | "restroom" | "show" | "shop" | "rest" | "exit" | "gate";
interface Goal { loc: string; purpose: Purpose; wish?: Wish }

type Act =
  | { t: "walk"; path: P[]; goal: Goal }
  | { t: "queue"; loc: string; total: number; left: number; wish?: Wish }
  | { t: "busy"; loc: string; left: number; what: string; done?: () => void }
  | { t: "gone" };

export type LogKind = "guest" | "you" | "park" | "bad" | "good";
export interface LogEntry { time: number; text: string; kind: LogKind }
export interface Hit { time: number; reason: string; misery: number }
export type EndReason = "closed" | "left" | "fired";

const WALK = 0.7; // tiles per game minute
const STEP = 0.5;
const REPEAT_WEIGHT = 0.7; // ruining a repeat ride hurts less than a wishlist one
const PATIENCE_HIT = 1.3; // tuned so greedy play risks sending them home early

export function fmtTime(min: number) {
  const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export class Sim {
  time = OPEN - 5;
  locs: Record<string, LocState> = {};
  suspicion = 0;
  misery = 0;
  patience = 100;
  hunger = 20;
  bladder = 10;
  pos: P;
  act: Act;
  wishes: Wish[];
  thought = "";
  thoughtUntil = 0;
  hits: Hit[] = [];
  sabLog: number[] = []; // times you sabotaged
  log: LogEntry[] = [];
  ended: { why: EndReason; at: number } | null = null;
  eavesdropReady = OPEN;
  fastPassReady = OPEN;
  slowSuffered = false;
  private lastRide = "";
  private breakdowns: number[];
  private leaving = false;
  private rng: () => number;

  constructor(seed = Date.now()) {
    this.rng = mulberry32(seed);
    for (const def of LOCS) {
      this.locs[def.id] = {
        def, closedUntil: 0, closedBy: null, slowUntil: 0, vegSwap: false, readerUntil: 0,
        showCancelled: false, scannerBroken: false, readyAt: {}, used: new Set(),
      };
    }
    this.wishes = WISHLIST.map((def) => ({ def, done: false, failed: false, revealed: false, fails: 0, retryAt: 0 }));
    // You start knowing two things they want.
    for (const w of this.shuffle([...this.wishes]).slice(0, 2)) w.revealed = true;
    // The park also breaks things all by itself. That's your cover.
    this.breakdowns = [this.between(11 * 60, 15 * 60), this.between(15 * 60, 20 * 60)];
    const gate = this.door("entrance");
    this.pos = { i: gate.i + 3.5, j: gate.j };
    this.act = { t: "walk", path: [gate], goal: { loc: "entrance", purpose: "gate" } };
    this.note("The Hendersons are pulling up to the Front Gate. Those ticket scanners look… fragile.", "park");
  }

  // ------------------------------------------------------------- helpers

  loc(id: string) { return this.locs[id]; }
  isClosed(id: string) { return this.locs[id].closedUntil > this.time; }
  isSlow(id: string) { return this.locs[id].slowUntil > this.time; }

  currentWait(id: string) {
    const l = this.locs[id];
    const base = l.def.baseWait ?? 10;
    // Lines peak mid-afternoon.
    const h = this.time / 60;
    const crowd = 0.6 + 0.6 * Math.exp(-((h - 15) ** 2) / 8);
    return Math.round(base * crowd * (this.isSlow(id) ? 2 : 1));
  }

  guestsAt(id: string) {
    if (this.act.t === "queue" || this.act.t === "busy") return this.act.loc === id;
    const c = this.locs[id].def;
    return Math.hypot(this.pos.i - c.i, this.pos.j - c.j) < Math.max(c.w, c.d) / 2 + 1.2;
  }

  activity(): string {
    const a = this.act;
    if (a.t === "gone") return "Gone home";
    if (a.t === "walk") return `Walking to ${this.locs[a.goal.loc].def.name}`;
    if (a.t === "queue") return `In line for ${this.locs[a.loc].def.name} (${Math.ceil(a.left)} min left)`;
    return a.what;
  }

  door(id: string): P {
    const c = this.locs[id].def;
    const hub = this.locs.hub.def;
    if (id === "hub") return { i: hub.i, j: hub.j };
    const dx = hub.i - c.i, dy = hub.j - c.j, n = Math.hypot(dx, dy) || 1;
    const r = Math.max(c.w, c.d) / 2 + 0.35;
    return { i: c.i + (dx / n) * r, j: c.j + (dy / n) * r };
  }

  private say(text: string, kind: LogKind = "guest", secs = 14) {
    this.thought = text;
    this.thoughtUntil = this.time + secs;
    this.note(text, kind);
  }

  private note(text: string, kind: LogKind) {
    this.log.push({ time: this.time, text, kind });
  }

  private who(w?: Wish) { return w?.def.who ?? GUEST_NAMES[Math.floor(this.rng() * 2)]; }
  private between(a: number, b: number) { return a + this.rng() * (b - a); }
  private shuffle<T>(xs: T[]) {
    for (let k = xs.length - 1; k > 0; k--) {
      const r = Math.floor(this.rng() * (k + 1));
      [xs[k], xs[r]] = [xs[r], xs[k]];
    }
    return xs;
  }

  private recent(times: number[], window = 90) {
    return times.filter((t) => this.time - t < window).length;
  }

  /** Ruin something. `yours` = caused by your sabotage (counts for suspicion). */
  private hurt(misery: number, patience: number, reason: string, yours = true) {
    this.misery += misery;
    this.patience -= patience * PATIENCE_HIT;
    if (yours) {
      // Coincidences pile up: each recent hit makes the next one more suspicious.
      this.suspicion += 2 * this.recent(this.hits.map((h) => h.time));
      this.hits.push({ time: this.time, reason, misery });
    } else {
      this.hits.push({ time: this.time, reason: "park:" + reason, misery });
    }
  }

  private joy(misery: number, patience: number) {
    this.misery = Math.max(0, this.misery - misery);
    this.patience = Math.min(100, this.patience + patience);
  }

  // ------------------------------------------------------------- sabotage

  sabotagesFor(id: string): SabDef[] {
    const kind = this.locs[id].def.kind;
    return SABOTAGES.filter((s) => s.kinds.includes(kind));
  }

  canSabotage(id: string, sab: SabDef): string | null {
    const l = this.locs[id];
    if (this.ended) return "Day's over";
    if (sab.once && l.used.has(sab.id)) return "Already used";
    const ready = l.readyAt[sab.id] ?? 0;
    if (ready > this.time) return `Ready ${fmtTime(ready)}`;
    if (sab.id === "scanner" && this.act.t !== "walk" && !(this.act.t === "busy" && this.act.loc === "entrance"))
      return "They're already inside";
    if (sab.id === "veg" && l.vegSwap) return "Already swapped";
    if ((sab.id === "close" || sab.id === "fryer" || sab.id === "outoforder") && this.isClosed(id)) return "Already closed";
    return null;
  }

  suspicionCost(id: string, sab: SabDef) {
    let c = sab.susp;
    if (this.guestsAt(id)) c *= 1.5; // they saw you do it
    if (this.suspicion >= 75) c *= 1.5; // management is watching
    return Math.round(c + 3 * this.recent(this.sabLog));
  }

  sabotage(id: string, sab: SabDef) {
    if (this.canSabotage(id, sab)) return;
    const l = this.locs[id];
    const name = l.def.name;
    this.suspicion += this.suspicionCost(id, sab);
    this.sabLog.push(this.time);
    l.used.add(sab.id);
    l.readyAt[sab.id] = this.time + sab.cooldown;
    const until = this.time + (sab.duration ?? 0);

    switch (sab.id) {
      case "scanner":
        l.scannerBroken = true;
        this.note("Scanners are “down.” Staff instructed to mime scanning.", "you");
        if (this.act.t === "busy" && this.act.loc === "entrance") this.mimed();
        break;
      case "close":
        this.note(`${name} closed for “maintenance.”`, "you");
        this.closeLoc(id, until, "you");
        break;
      case "slow":
        l.slowUntil = until;
        this.note(`${name} is now running one car.`, "you");
        break;
      case "veg":
        l.vegSwap = true;
        this.note("Vegan patties replaced with “basically vegan” patties.", "you");
        break;
      case "fryer":
        this.note("The fryer is “down.” Chow Barn closed.", "you");
        this.closeLoc(id, until, "you");
        break;
      case "outoforder":
        this.note("Restrooms: OUT OF ORDER.", "you");
        this.closeLoc(id, until, "you");
        break;
      case "mascot":
        l.showCancelled = true;
        this.note("Pumpkin Pete called in “sick.” The 7 PM Revue is cancelled.", "you");
        break;
      case "reader":
        l.readerUntil = until;
        this.note("Gift Shoppe card reader unplugged. Cash only.", "you");
        break;
    }
  }

  eavesdrop(): string | null {
    if (this.ended) return null;
    if (this.eavesdropReady > this.time) return null;
    const hidden = this.wishes.filter((w) => !w.revealed);
    if (!hidden.length) return null;
    const w = hidden[Math.floor(this.rng() * hidden.length)];
    w.revealed = true;
    this.eavesdropReady = this.time + 60;
    this.suspicion += 2;
    this.note(`Overheard ${w.def.who}: wants to ${w.def.label.toLowerCase()}.`, "you");
    return w.def.label;
  }

  /** Goodwill: buy back patience (and a little cover) at the cost of misery. */
  fastPass(): boolean {
    if (this.ended || this.fastPassReady > this.time || this.act.t === "gone") return false;
    this.fastPassReady = this.time + 90;
    this.joy(5, 15);
    this.suspicion = Math.max(0, this.suspicion - 4);
    const a = this.act;
    if (a.t === "queue") a.left = Math.min(a.left, 2);
    this.say(`Gary: "A free FastPass? Okay, this place isn't ALL bad."`, "good");
    this.note("You handed them a FastPass. So generous. So deniable.", "you");
    return true;
  }

  private closeLoc(id: string, until: number, by: "you" | "park") {
    const l = this.locs[id];
    l.closedUntil = until;
    l.closedBy = by;
    const a = this.act;
    if (a.t === "queue" && a.loc === id) {
      const progress = 1 - a.left / a.total;
      const weight = a.wish?.def.weight ?? REPEAT_WEIGHT;
      const front = progress > 0.6;
      this.hurt((10 + 35 * progress) * weight, 6 + 20 * progress, front ? "closedFront" : "closed", by === "you");
      this.say(front
        ? `${this.who(a.wish)}: "We were RIGHT THERE. ${Math.round(a.total - a.left)} minutes!"`
        : `${this.who(a.wish)}: "It's closing? We just got in line."`, "bad");
      if (a.wish) this.failWish(a.wish);
      this.decide();
    } else if (a.t === "busy" && a.loc === id && id === "food") {
      this.hurt(8, 8, "fryer", by === "you");
      this.say(`Deb: "They're kicking us out mid-bite?"`, "bad");
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
    this.act = { t: "busy", loc: "entrance", left: 30, what: "Being mimed at by the ticket guy" };
    this.say(`Gary: "Did it… beep? Is that a yes?"`, "bad");
  }

  // ------------------------------------------------------------- guest AI

  private goTo(goal: Goal) {
    const target = this.door(goal.loc);
    const hub = this.door("hub");
    const atHub = Math.hypot(this.pos.i - hub.i, this.pos.j - hub.j) < 1.5;
    const path = goal.loc === "hub" || atHub ? [target] : [hub, target];
    this.act = { t: "walk", path, goal };
  }

  private nextWish(): Wish | undefined {
    const rides = this.wishes.filter(
      (w) => this.locs[w.def.loc].def.kind === "ride" && !w.done && !w.failed && w.retryAt <= this.time,
    );
    return rides.sort((a, b) => b.def.weight - a.def.weight)[0];
  }

  private wish(id: string) { return this.wishes.find((w) => w.def.id === id)!; }

  private decide() {
    const t = this.time;
    if (this.leaving || this.patience <= 0 || t >= CLOSE - 15) {
      if (!this.leaving) {
        this.leaving = true;
        if (this.patience <= 0) this.say(`Deb: "That's it. We're going home."`, "bad");
      }
      return this.goTo({ loc: "entrance", purpose: "exit" });
    }
    const hoodie = this.wish("hoodie");
    if (t >= 21 * 60 && !hoodie.done && !hoodie.failed) return this.announce(hoodie, "shop");
    const show = this.wish("show");
    if (t >= 18 * 60 + 20 && t < 19 * 60 && !show.done && !show.failed) return this.announce(show, "show");
    if (this.bladder >= 75) {
      this.say(`Gary: "I gotta find a bathroom."`);
      return this.goTo({ loc: "restroom", purpose: "restroom" });
    }
    if (this.hunger >= 65) {
      const vegan = this.wish("vegan");
      if (!vegan.done && !vegan.failed) return this.announce(vegan, "food");
      return this.goTo({ loc: "food", purpose: "food" });
    }
    const w = this.nextWish();
    if (w) return this.announce(w, "wish");
    // Wishlist rides done (or given up on): go again on something, or rest.
    const again = LOCS.filter((d) => d.kind === "ride" && d.id !== this.lastRide);
    if (this.rng() < 0.75) {
      const d = again[Math.floor(this.rng() * again.length)];
      this.thought = `${GUEST_NAMES[Math.floor(this.rng() * 2)]}: "${d.name} again?"`;
      this.thoughtUntil = this.time + 10;
      return this.goTo({ loc: d.id, purpose: "wish" });
    }
    this.act = { t: "busy", loc: "hub", left: 30, what: "Sitting on a bench, judging people", done: () => this.joy(2, 3) };
  }

  private announce(w: Wish, purpose: Purpose) {
    if (!w.revealed) {
      w.revealed = true;
      this.say(`${w.def.who}: "${w.def.ask}"`);
    } else {
      this.thought = `${w.def.who}: "${w.def.label} next!"`;
      this.thoughtUntil = this.time + 10;
    }
    this.goTo({ loc: w.def.loc, purpose, wish: w });
  }

  private arrive(goal: Goal) {
    const l = this.locs[goal.loc];
    const w = goal.wish;
    switch (goal.purpose) {
      case "gate":
        if (l.scannerBroken) return this.mimed();
        this.act = { t: "busy", loc: "entrance", left: 5, what: "Getting tickets scanned" };
        return;
      case "exit":
        this.act = { t: "gone" };
        this.end(this.time >= CLOSE - 15 ? "closed" : "left");
        return;
      case "wish": {
        if (this.isClosed(l.def.id)) {
          const yours = l.closedBy === "you";
          this.hurt(12 * (w?.def.weight ?? REPEAT_WEIGHT), 10, "closed", yours);
          this.say(`${this.who(w)}: "Closed?! It says it's closed."`, "bad");
          if (w) this.failWish(w);
          return this.decide();
        }
        const wait = this.currentWait(l.def.id);
        this.act = { t: "queue", loc: l.def.id, total: wait, left: wait, wish: w };
        if (wait >= 60) this.say(`Gary: "${wait} minutes?! …Fine."`);
        return;
      }
      case "food":
        if (this.isClosed("food")) {
          this.hurt(8 + this.hunger / 10, 10, "fryer", l.closedBy === "you");
          this.say(`Deb: "The FOOD COURT is closed? The whole thing?"`, "bad");
          this.hunger = Math.min(this.hunger, 60); // they'll be back
          if (w) w.retryAt = this.time + 45;
          this.act = { t: "busy", loc: "hub", left: 20, what: "Eating a sad granola bar from the car" };
          return;
        }
        this.act = {
          t: "queue", loc: "food", total: 12, left: 12, wish: w,
        };
        return;
      case "restroom":
        if (this.isClosed("restroom")) {
          this.hurt(8 + this.bladder / 8, 10, "restroom", l.closedBy === "you");
          if (this.bladder >= 95) {
            this.say(`Gary: "I am going behind that dumpster. Don't look."`, "bad");
            this.hurt(15, 15, "restroom");
            this.bladder = 0;
            return this.decide();
          }
          this.say(`Gary: "OUT OF ORDER?! Both of them?"`, "bad");
          this.act = { t: "busy", loc: "restroom", left: 15, what: "Doing the bathroom dance" };
          return;
        }
        this.act = { t: "busy", loc: "restroom", left: 6, what: "In the restroom", done: () => { this.bladder = 0; } };
        return;
      case "show": {
        const wait = Math.max(0, 19 * 60 - this.time);
        this.act = {
          t: "busy", loc: "stage", left: wait, what: "Waiting for the Pumpkin Revue",
          done: () => this.startShow(w!),
        };
        return;
      }
      case "shop":
        if (l.readerUntil > this.time) {
          this.hurt(12, 6, "reader");
          this.say(`Gary: "Cash only? Who carries cash?"`, "bad");
          w!.failed = true;
          return this.decide();
        }
        this.act = {
          t: "busy", loc: "shop", left: 15, what: "Buying matching hoodies",
          done: () => { w!.done = true; this.joy(6, 6); this.say(`Deb: "We look SO cute."`, "good"); },
        };
        return;
      case "rest":
        return this.decide();
    }
  }

  private startShow(w: Wish) {
    const l = this.locs.stage;
    if (l.showCancelled) {
      this.hurt(28 * w.def.weight, 18, "show");
      this.say(`Deb: "Cancelled? We waited 40 minutes in the cold!"`, "bad");
      w.failed = true;
      return this.decide();
    }
    this.act = {
      t: "busy", loc: "stage", left: 40, what: "Watching the Pumpkin Revue",
      done: () => { w.done = true; this.joy(10, 10); this.say(`Deb: "Pumpkin Pete is a NATIONAL TREASURE."`, "good"); },
    };
  }

  private finishQueue(a: Extract<Act, { t: "queue" }>) {
    if (a.loc === "food") {
      const l = this.locs.food;
      const deb = a.wish;
      this.act = {
        t: "busy", loc: "food", left: 20, what: "Eating at the Chow Barn",
        done: () => {
          this.hunger = 0;
          this.bladder += 15;
          if (deb && l.vegSwap) {
            l.vegSwap = false;
            this.hurt(25 * deb.def.weight, 15, "veg");
            this.say(`Deb: "Why does my vegan burger have a BONE in it?"`, "bad");
            deb.failed = true;
            deb.revealed = true;
          } else if (deb) {
            deb.done = true;
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
    const def = this.locs[a.loc].def;
    this.act = {
      t: "busy", loc: a.loc, left: def.rideMin ?? 5, what: `Riding ${def.name}`,
      done: () => {
        this.lastRide = a.loc;
        if (a.wish) a.wish.done = true;
        if (a.wish) this.joy(6, 8);
        else this.joy(3, 4);
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
    this.bladder = Math.min(100, this.bladder + 0.2 * dt);
    this.suspicion = Math.max(0, this.suspicion - 0.05 * dt);

    for (const at of this.breakdowns) {
      if (at > this.time - dt && at <= this.time) {
        const rides = LOCS.filter((d) => d.kind === "ride" && !this.isClosed(d.id));
        const d = rides[Math.floor(this.rng() * rides.length)];
        if (d) {
          this.note(`${d.name} broke down all by itself. Classic. (Cover for you.)`, "park");
          this.suspicion = Math.max(0, this.suspicion - 6);
          this.closeLoc(d.id, this.time + 45, "park");
        }
      }
    }

    if (this.suspicion >= 100) {
      this.suspicion = 100;
      this.note("Management has reviewed the incident log. You're fired.", "bad");
      return this.end("fired");
    }
    if (this.time >= CLOSE && this.act.t !== "gone") return this.end("closed");

    const a = this.act;
    switch (a.t) {
      case "walk": {
        let move = WALK * dt;
        while (move > 0 && a.path.length) {
          const p = a.path[0];
          const dx = p.i - this.pos.i, dy = p.j - this.pos.j, dist = Math.hypot(dx, dy);
          if (dist <= move) {
            this.pos = { ...p };
            a.path.shift();
            move -= dist;
          } else {
            this.pos = { i: this.pos.i + (dx / dist) * move, j: this.pos.j + (dy / dist) * move };
            move = 0;
          }
        }
        if (!a.path.length) this.arrive(a.goal);
        break;
      }
      case "queue": {
        a.left -= dt * (this.isSlow(a.loc) ? 0.5 : 1);
        this.patience -= 0.045 * dt;
        if (this.isSlow(a.loc)) {
          // Standing in a line you slowed down: quiet, steady, deniable misery.
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
          if (this.act === a) this.decide();
        }
        break;
    }
    if (this.patience <= 0 && !this.leaving && this.act.t !== "gone") this.decide();
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
    add("fryer", "The food court had no food. A FOOD COURT.");
    add("restroom", "Bathrooms out of order. My husband used a dumpster.");
    add("show", "Drove 3 hours for the Pumpkin Revue. The pumpkin did not show.");
    add("reader", "Gift shop was cash only. In this economy.");
    add("scanner", "Staff pretended to scan our tickets. Like, mimed it.");
    if (this.slowSuffered) lines.push("The lines did not move. I aged.");
    if (!lines.length) lines.push("Honestly? Kind of a nice day. Lines were long, I guess.");
    const stars = Math.max(1, 5 - Math.floor(this.misery / 35));
    const done = this.wishes.filter((w) => w.done).length;
    const memo =
      why === "fired" ? "Your badge has been deactivated. Please return your vest. — Mgmt"
        : score >= 150 ? "Guest satisfaction is at an all-time low. Promotion pending. — The New Owners"
        : score >= 80 ? "Solid work. Per-guest spend is down, morale is down, we're thrilled. — The New Owners"
        : "They had FUN? We'll be discussing this at your review. — The New Owners";
    return { why, mult, score, misery: Math.round(this.misery), stars, lines, done, memo };
  }
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
