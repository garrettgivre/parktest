// Headless balance check: runs many simulated days with simple strategies.
// npx esbuild tools/balance.ts --bundle --platform=node --outfile=<tmp>.cjs && node <tmp>.cjs
import { SABOTAGES } from "../src/sim/data";
import { Sim } from "../src/sim/sim";

type Strategy = (s: Sim) => void;

const idle: Strategy = () => {};

// Greedy: sabotage whatever the guests are queuing for / heading to, if suspicion allows.
const greedy = (cap: number, minPatience = -1): Strategy => (s) => {
  if (minPatience > 0 && s.patience < minPatience) s.fastPass();
  if (s.suspicion > cap || s.patience < minPatience) return;
  const a = s.act;
  const tryS = (loc: string, id: string, cond = true) => {
    const sab = SABOTAGES.find((x) => x.id === id)!;
    if (cond && !s.canSabotage(loc, sab)) s.sabotage(loc, sab);
  };
  if (a.t === "queue" && s.loc(a.loc).def.kind === "ride") {
    const progress = 1 - a.left / a.total;
    tryS(a.loc, "close", progress > 0.75);
    tryS(a.loc, "slow", progress < 0.3);
  }
  if (a.t === "walk") {
    const g = a.goal.loc;
    if (g === "food") tryS("food", "veg");
    if (g === "restroom") tryS("restroom", "outoforder");
    if (g === "stage") tryS("stage", "mascot");
    if (g === "shop") tryS("shop", "reader");
    if (g === "entrance" && s.time < 600) tryS("entrance", "scanner");
  }
};

function run(name: string, strat: Strategy, n = 200) {
  const out = { score: 0, closed: 0, left: 0, fired: 0, misery: 0, susp: 0, leftAt: 0, sabs: 0, pat: 0 };
  for (let k = 0; k < n; k++) {
    const s = new Sim(k + 1);
    while (!s.ended) { strat(s); s.step(1); }
    const r = s.result();
    out.score += r.score; out.misery += r.misery; out.susp += s.suspicion; out[r.why]++;
    out.sabs += s.sabLog.length; out.pat += Math.max(0, s.patience);
    if (r.why === "left") out.leftAt += s.ended!.at;
  }
  const avg = (v: number) => (v / n).toFixed(1);
  console.log(`${name.padEnd(12)} score ${avg(out.score)}  misery ${avg(out.misery)}  susp ${avg(out.susp)}  sabotages ${avg(out.sabs)}  patience ${avg(out.pat)}  closed/left/fired ${out.closed}/${out.left}/${out.fired}` +
    (out.left ? `  left@${(out.leftAt / out.left / 60).toFixed(1)}h` : ""));
}

run("idle", idle);
run("greedy<40", greedy(40));
run("greedy<60", greedy(60));
run("greedy<85", greedy(85));
run("greedy<999", greedy(999));
run("aware 60/30", greedy(60, 30));
run("aware 60/45", greedy(60, 45));
run("aware 70/40", greedy(70, 40));
