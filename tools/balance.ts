// Headless balance check for the v1 sim: a few bot workers play many days.
// npm run balance
import { ACTION, SPECIAL, TOOLS, ToolId } from "../src/sim/content";
import { LOC, LOCS } from "../src/sim/park";
import { Sim } from "../src/sim/sim";

type Bot = { name: string; tools: ToolId[]; think: (s: Sim) => void };

const nearestTo = (s: Sim, kind: string) =>
  LOCS.filter((l) => l.kind === kind)
    .map((l) => ({ l, d: Math.hypot(LOC[l.id].i - s.g.pos.i, LOC[l.id].j - s.g.pos.j) }))
    .sort((a, b) => a.d - b.d)[0].l;

function careful(cap: number, minPatience: number, doDuties: boolean) {
  return (s: Sim) => {
    if (s.w.task || s.w.pending) return;
    const g = s.g.act;
    if (s.patience < minPatience) {
      const v = s.actionsFor({ kind: "guests" }).find((a) => !a.why && (a.def.id === "voucher" || a.def.id === "churro"));
      if (v) { s.doAction({ kind: "guests" }, v.def); return; }
    }
    if (doDuties && s.duty && s.walkMinutes(LOC[s.duty.loc].node) < 25) {
      s.doAction({ kind: "loc", id: s.duty.loc }, SPECIAL.duty);
      return;
    }
    if (s.time < 615 && g.t !== "gone") { s.doAction({ kind: "loc", id: "gate" }, ACTION.scanner); return; }
    if (s.suspicion > cap || s.patience < minPatience) {
      s.setFollow(true);
      return;
    }
    if (g.t === "queue" && LOC[g.loc].kind === "ride") {
      const node = LOC[g.loc].node;
      const walk = s.walkMinutes(node);
      const frontIn = g.left - g.total * 0.2;
      if (walk >= frontIn - 1) {
        const close = s.actionsFor({ kind: "loc", id: g.loc }).find((a) => a.def.id === "close" || a.def.id === "radioclose");
        if (close && !close.why) { s.doAction({ kind: "loc", id: g.loc }, close.def); return; }
      }
    }
    if (s.bladder > 55) {
      const wc = nearestTo(s, "restroom");
      const a = s.actionsFor({ kind: "loc", id: wc.id }).find((x) => x.def.kind !== undefined || x.def.kinds?.includes("restroom"));
      if (a && !a.why) { s.doAction({ kind: "loc", id: wc.id }, a.def); return; }
    }
    const lunch = s.wishes.find((w) => w.def.id === "lunch" && !w.done && !w.failed);
    if (lunch && s.hunger > 40 && "patties" in s.tools) {
      const a = s.actionsFor({ kind: "loc", id: lunch.def.loc }).find((x) => x.def.id === "veg");
      if (a && !a.why) { s.doAction({ kind: "loc", id: lunch.def.loc }, a.def); return; }
    }
    const show = s.wishes.find((w) => w.def.id === "show" && !w.done && !w.failed);
    if (show && show.def.showTime! - s.time < 120) {
      const a = s.actionsFor({ kind: "loc", id: show.def.loc }).find((x) => x.def.id === "mascot");
      if (a && !a.why) { s.doAction({ kind: "loc", id: show.def.loc }, a.def); return; }
    }
    s.setFollow(true);
  };
}

const bots: Bot[] = [
  { name: "idle", tools: [], think: () => {} },
  { name: "reckless", tools: ["walkie", "cart", "patties"], think: careful(999, -1, false) },
  { name: "no duties", tools: ["walkie", "cart", "patties"], think: careful(60, 30, false) },
  { name: "careful", tools: ["walkie", "cart", "patties"], think: careful(60, 30, true) },
  { name: "careful+fp", tools: ["vouchers", "cart", "walkie"], think: careful(65, 30, true) },
  { name: "careful+radio", tools: ["radio", "keys", "patties"], think: careful(60, 30, true) },
];

const N = 150;
for (const b of bots) {
  const o = { score: 0, closed: 0, left: 0, fired: 0, susp: 0, duties: 0, missed: 0, pat: 0 };
  for (let k = 0; k < N; k++) {
    const s = new Sim(k + 1);
    s.equip(b.tools);
    while (!s.ended) { b.think(s); s.step(1); }
    const r = s.result();
    o.score += r.score; o[r.why]++; o.susp += s.suspicion; o.duties += s.dutiesDone; o.missed += s.dutiesMissed;
    o.pat += Math.max(0, s.patience);
  }
  const avg = (v: number) => (v / N).toFixed(1);
  console.log(`${b.name.padEnd(14)} score ${avg(o.score).padStart(6)}  susp ${avg(o.susp)}  patience ${avg(o.pat)}  duties ${avg(o.duties)}/${avg(o.duties + o.missed)}  closed/left/fired ${o.closed}/${o.left}/${o.fired}`);
}
void TOOLS;
