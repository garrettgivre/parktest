// How guests spend their day on the current park (walking vs riding transport vs activities).
import { Sim } from "../src/sim/sim";
const N = 60;
const tot = { walk: 0, train: 0, sky: 0, queue: 0, busy: 0, wishes: 0, done: 0 };
for (let k = 0; k < N; k++) {
  const s = new Sim(k + 1);
  while (!s.ended) {
    const a = s.g.act;
    if (a.t === "walk") {
      if (s.aboard(s.g, "train")) tot.train += 1; else if (s.aboard(s.g, "sky")) tot.sky += 1; else tot.walk += 1;
    } else if (a.t === "queue") tot.queue += 1; else if (a.t === "busy") tot.busy += 1;
    s.step(1);
  }
  tot.wishes += s.wishes.length; tot.done += s.wishes.filter((w) => w.done).length;
}
const all = tot.walk + tot.train + tot.sky + tot.queue + tot.busy;
const pct = (v: number) => `${Math.round((v / all) * 100)}%`;
console.log(`walk ${pct(tot.walk)}  train ${pct(tot.train)}  sky ${pct(tot.sky)}  queue ${pct(tot.queue)}  busy ${pct(tot.busy)}  wishes done ${(tot.done / N).toFixed(1)}/${(tot.wishes / N).toFixed(1)}`);
