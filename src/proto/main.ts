import Phaser from "phaser";
import { GROUP_NAME, LOCS, LOT, LocDef, SABOTAGES } from "../sim/data";
import { Sim, fmtTime } from "../sim/sim";

// Gameplay test: gray-box park drawn as flat-shaded iso blocks, DOM panels on top.

const HALF = 64; // half a tile's screen width
const ZPX = 78; // screen px per tile of height
const GAME_MIN_PER_SEC = 1.5; // at 1x speed a 12-hour day lasts ~8 minutes

const $ = (id: string) => document.getElementById(id)!;
const iso = (i: number, j: number, z = 0) => ({ x: (i - j) * HALF, y: (i + j) * (HALF / 2) - z * ZPX });

let wired = false;
let restartRunning = false;
let current: Park;

type Selection = { kind: "loc"; id: string } | { kind: "guests" } | null;

class Park extends Phaser.Scene {
  sim!: Sim;
  speed = 1;
  running = false;
  sel: Selection = null;
  dyn!: Phaser.GameObjects.Graphics;
  labels: Record<string, Phaser.GameObjects.Text> = {};
  bubble!: Phaser.GameObjects.Text;
  lastSide = "";
  lastFeed = -1;

  create() {
    this.sim = new Sim();
    this.running = restartRunning;
    this.setSpeed(1);
    this.sel = null;
    this.lastSide = "";
    this.lastFeed = -1;
    this.labels = {};
    this.cameras.main.setBackgroundColor("#24402a");
    this.drawStatic();
    this.dyn = this.add.graphics().setDepth(5000);
    this.bubble = this.add.text(0, 0, "", {
      fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: "38px", color: "#222",
      backgroundColor: "#ffffffee", padding: { x: 10, y: 6 }, wordWrap: { width: 520 }, align: "center",
    }).setOrigin(0.5, 1).setDepth(7000).setVisible(false);

    this.fit();
    this.scale.on("resize", () => this.fit());
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (p.getDistance() > 12) return;
      this.tap(this.cameras.main.getWorldPoint(p.x, p.y));
    });

    current = this;
    if (!wired) {
      // DOM outlives scene restarts, so wire it once and route to the live scene.
      wired = true;
      document.querySelectorAll<HTMLButtonElement>(".speed button").forEach((b) =>
        b.addEventListener("click", () => current.setSpeed(Number(b.dataset.speed))),
      );
      $("side").addEventListener("click", (e) => current.onSideClick(e));
      $("start").addEventListener("click", () => {
        $("intro").classList.add("hidden");
        current.running = true;
      });
    }
  }

  setSpeed(s: number) {
    this.speed = s;
    document.querySelectorAll<HTMLButtonElement>(".speed button").forEach((o) =>
      o.classList.toggle("on", Number(o.dataset.speed) === s),
    );
  }

  fit() {
    const { width, height } = this.scale;
    const mapW = LOT * HALF * 2, mapH = LOT * HALF;
    const cam = this.cameras.main;
    // Leave room for the HUD panels at the top and the feed at the bottom.
    cam.setZoom(Math.min(width / (mapW * 1.02), height / (mapH * 1.25)));
    cam.centerOn(0, iso(LOT / 2, LOT / 2).y - mapH * 0.06);
  }

  // ------------------------------------------------------------ drawing

  drawStatic() {
    const g = this.add.graphics();
    const poly = (pts: { x: number; y: number }[], color: number, alpha = 1) => {
      g.fillStyle(color, alpha).beginPath().moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.closePath().fillPath();
    };
    // Lot with a dirt edge, like a Sims lot.
    const e = 0.35;
    poly([iso(LOT, 0), iso(LOT, LOT), iso(LOT, LOT, -e), iso(LOT, 0, -e)], 0x5a3d22);
    poly([iso(0, LOT), iso(LOT, LOT), iso(LOT, LOT, -e), iso(0, LOT, -e)], 0x6e4b2a);
    poly([iso(0, 0), iso(LOT, 0), iso(LOT, LOT), iso(0, LOT)], 0x4f8a3a);
    for (let k = 0; k <= LOT; k++) {
      g.lineStyle(1, 0x000000, 0.06);
      g.lineBetween(iso(k, 0).x, iso(k, 0).y, iso(k, LOT).x, iso(k, LOT).y);
      g.lineBetween(iso(0, k).x, iso(0, k).y, iso(LOT, k).x, iso(LOT, k).y);
    }
    // Paths from the plaza to every door.
    const hub = LOCS.find((l) => l.id === "hub")!;
    for (const l of LOCS) {
      if (l.id === "hub") continue;
      const door = this.sim.door(l.id);
      const a = iso(hub.i, hub.j), b = iso(door.i, door.j);
      g.lineStyle(44, 0xb9ab97, 1).lineBetween(a.x, a.y, b.x, b.y);
    }
    poly([iso(hub.i - 1.4, hub.j - 1.4), iso(hub.i + 1.4, hub.j - 1.4), iso(hub.i + 1.4, hub.j + 1.4), iso(hub.i - 1.4, hub.j + 1.4)], 0xb9ab97);

    const blocks = LOCS.filter((l) => l.id !== "hub").sort((a, b) => a.i + a.j - (b.i + b.j));
    for (const l of blocks) {
      this.block(l);
      const top = iso(l.i, l.j, l.h);
      this.labels[l.id] = this.add.text(top.x, top.y - 20, "", {
        fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: "40px", color: "#ffffff",
        stroke: "#000000", strokeThickness: 8, align: "center",
      }).setOrigin(0.5, 1).setDepth(6000);
    }
  }

  block(l: LocDef) {
    const g = this.add.graphics().setDepth(l.i + l.j);
    const i0 = l.i - l.w / 2, i1 = l.i + l.w / 2, j0 = l.j - l.d / 2, j1 = l.j + l.d / 2;
    const c = Phaser.Display.Color.IntegerToColor(l.color);
    const shade = (k: number) => Phaser.Display.Color.GetColor(c.red * k, c.green * k, c.blue * k);
    const face = (pts: { x: number; y: number }[], color: number) => {
      g.fillStyle(color, 1).lineStyle(2, 0x000000, 0.35).beginPath().moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.closePath().fillPath().strokePath();
    };
    // Soft drop shadow.
    g.fillStyle(0x000000, 0.18).beginPath();
    [iso(i0 + 0.2, j0 + 0.3), iso(i1 + 0.4, j0 + 0.3), iso(i1 + 0.4, j1 + 0.3), iso(i0 + 0.2, j1 + 0.3)]
      .forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath().fillPath();
    face([iso(i1, j0), iso(i1, j1), iso(i1, j1, l.h), iso(i1, j0, l.h)], shade(0.72));
    face([iso(i0, j1), iso(i1, j1), iso(i1, j1, l.h), iso(i0, j1, l.h)], shade(0.55));
    face([iso(i0, j0, l.h), iso(i1, j0, l.h), iso(i1, j1, l.h), iso(i0, j1, l.h)], shade(1.0));
  }

  drawDynamic() {
    const s = this.sim, g = this.dyn;
    g.clear();
    // Closed / sabotaged markers on the blocks.
    for (const l of LOCS) {
      if (l.id === "hub") continue;
      const st = s.loc(l.id);
      const top = iso(l.i, l.j, l.h);
      if (s.isClosed(l.id)) {
        g.lineStyle(10, st.closedBy === "you" ? 0xff9900 : 0xff3333, 1);
        g.lineBetween(top.x - 34, top.y - 34, top.x + 34, top.y + 34);
        g.lineBetween(top.x - 34, top.y + 34, top.x + 34, top.y - 34);
      }
      if (this.sel?.kind === "loc" && this.sel.id === l.id) {
        const b = iso(l.i, l.j);
        g.lineStyle(5, 0xffd166, 1).strokeEllipse(b.x, b.y, (l.w + l.d) * HALF + 30, ((l.w + l.d) * HALF) / 2 + 15);
      }
    }
    // The Hendersons.
    if (s.act.t !== "gone") {
      const colors = [0xe84393, 0xf39c12];
      const offs = [{ i: -0.18, j: 0.18 }, { i: 0.18, j: -0.18 }];
      const c = iso(s.pos.i, s.pos.j);
      if (this.sel?.kind === "guests") g.lineStyle(5, 0xffd166, 1).strokeEllipse(c.x, c.y, 120, 60);
      offs.forEach((o, k) => {
        const p = iso(s.pos.i + o.i, s.pos.j + o.j);
        g.fillStyle(0x000000, 0.3).fillEllipse(p.x, p.y, 34, 16);
        g.fillStyle(colors[k], 1).fillRoundedRect(p.x - 11, p.y - 62, 22, 50, 8);
        g.fillStyle(0xf1c27d, 1).fillCircle(p.x, p.y - 72, 12);
        g.lineStyle(2, 0x000000, 0.6).strokeRoundedRect(p.x - 11, p.y - 62, 22, 50, 8).strokeCircle(p.x, p.y - 72, 12);
      });
      const showBubble = s.thoughtUntil > s.time && s.thought;
      this.bubble.setVisible(!!showBubble);
      if (showBubble) this.bubble.setText(s.thought).setPosition(c.x, c.y - 100);
    } else {
      this.bubble.setVisible(false);
    }
  }

  updateLabels() {
    const s = this.sim;
    for (const l of LOCS) {
      const t = this.labels[l.id];
      if (!t) continue;
      const st = s.loc(l.id);
      let status = "";
      if (s.isClosed(l.id)) status = `CLOSED til ${fmtTime(st.closedUntil)}`;
      else if (l.kind === "ride") status = `${s.currentWait(l.id)} min wait${s.isSlow(l.id) ? " (slow)" : ""}`;
      else if (l.kind === "show") status = st.showCancelled ? "7 PM show CANCELLED" : "Show at 7 PM";
      else if (l.kind === "shop" && st.readerUntil > s.time) status = "Cash only";
      if (s.act.t === "queue" && s.act.loc === l.id) {
        const pct = Math.round((1 - s.act.left / s.act.total) * 100);
        status += `\n👥 In line: ${pct}% to front`;
      }
      t.setText(status ? `${l.name}\n${status}` : l.name);
      t.setColor(s.isClosed(l.id) ? "#ffb3a7" : "#ffffff");
    }
  }

  // ------------------------------------------------------------ input

  tap(w: Phaser.Math.Vector2) {
    const s = this.sim;
    if (s.act.t !== "gone") {
      const c = iso(s.pos.i, s.pos.j, 0.5);
      if (Phaser.Math.Distance.Between(w.x, w.y, c.x, c.y) < 70) return this.select({ kind: "guests" });
    }
    let best: string | null = null, bestD = Infinity;
    for (const l of LOCS) {
      if (l.id === "hub") continue;
      const c = iso(l.i, l.j, l.h / 2);
      const r = ((l.w + l.d) / 2) * HALF * 0.9 + 30;
      const d = Phaser.Math.Distance.Between(w.x, w.y, c.x, c.y);
      if (d < r && d < bestD) { best = l.id; bestD = d; }
    }
    this.select(best ? { kind: "loc", id: best } : null);
  }

  select(sel: Selection) {
    this.sel = sel;
    this.lastSide = "";
    $("side").classList.toggle("hidden", !sel);
    this.renderSide();
  }

  onSideClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest("button");
    if (!el) return;
    if (el.classList.contains("x")) return this.select(null);
    if (el.dataset.sab && this.sel?.kind === "loc") {
      const sab = SABOTAGES.find((x) => x.id === el.dataset.sab)!;
      this.sim.sabotage(this.sel.id, sab);
      this.lastSide = "";
    }
    if (el.dataset.fastpass) {
      this.sim.fastPass();
      this.lastSide = "";
    }
    if (el.dataset.eavesdrop) {
      this.sim.eavesdrop();
      this.lastSide = "";
    }
  }

  renderSide() {
    const s = this.sim, sel = this.sel;
    if (!sel) return;
    let html = `<button class="x">✕</button>`;
    if (sel.kind === "loc") {
      const st = s.loc(sel.id), l = st.def;
      const bits: string[] = [];
      if (s.isClosed(l.id)) bits.push(`Closed until ${fmtTime(st.closedUntil)} (${st.closedBy === "you" ? "your doing" : "genuinely broken"})`);
      else bits.push("Open");
      if (l.kind === "ride") bits.push(`Line: ${s.currentWait(l.id)} min${s.isSlow(l.id) ? " — slowed" : ""}`);
      if (st.vegSwap) bits.push("Vegan patties: swapped 😈");
      if (st.readerUntil > s.time) bits.push(`Cash only until ${fmtTime(st.readerUntil)}`);
      if (st.showCancelled) bits.push("7 PM show cancelled");
      html += `<h2>${l.name}</h2><div class="status">${bits.join(" · ")}`;
      if (s.guestsAt(l.id)) html += `<br><span class="here">The Hendersons are right here. Sabotage costs more.</span>`;
      html += `</div>`;
      const sabs = s.sabotagesFor(l.id);
      if (!sabs.length) html += `<div class="status">Nothing to break here.</div>`;
      for (const sab of sabs) {
        const why = s.canSabotage(l.id, sab);
        html += `<button class="sab" data-sab="${sab.id}" ${why ? "disabled" : ""}>
          <b>${sab.name}</b><small>${sab.blurb}</small>
          <span class="cost">${why ?? `Suspicion +${s.suspicionCost(l.id, sab)}`}</span></button>`;
      }
    } else {
      html += `<h2>${GROUP_NAME}</h2><div class="status">${s.activity()}</div>`;
      html += `<div class="meter"><span>Hunger</span><i><b style="--v:${s.hunger}%;--c:#d68910"></b></i></div>`;
      html += `<div class="meter"><span>Bladder</span><i><b style="--v:${s.bladder}%;--c:#3498db"></b></i></div>`;
      html += `<div class="status" style="margin-top:6px"><b>What they want today</b></div><ul>`;
      for (const w of s.wishes) {
        if (!w.revealed) { html += `<li class="hidden-wish">??? (${w.def.who})</li>`; continue; }
        const cls = w.done ? "done" : w.failed ? "failed" : "";
        const mark = w.done ? "✓" : w.failed ? "✗" : "•";
        html += `<li class="${cls}">${mark} ${w.def.label} <small>(${w.def.who})</small></li>`;
      }
      html += `</ul>`;
      const fp = s.fastPassReady <= s.time;
      html += `<button class="sab" data-fastpass="1" ${fp ? "" : "disabled"}><b>Hand them a free FastPass</b>
        <small>Skips their current line. Patience +15, misery −5. Great cover.</small>
        <span class="cost">${fp ? "Suspicion −4" : `Ready ${fmtTime(s.fastPassReady)}`}</span></button>`;
      const ready = s.eavesdropReady <= s.time && s.wishes.some((w) => !w.revealed);
      html += `<button class="sab" data-eavesdrop="1" ${ready ? "" : "disabled"}><b>Eavesdrop</b>
        <small>Lurk nearby with a broom. Reveals one thing they want.</small>
        <span class="cost">${ready ? "Suspicion +2" : s.wishes.some((w) => !w.revealed) ? `Ready ${fmtTime(s.eavesdropReady)}` : "You know everything"}</span></button>`;
    }
    if (html !== this.lastSide) {
      $("side").innerHTML = html;
      this.lastSide = html;
    }
  }

  renderHud() {
    const s = this.sim;
    $("time").textContent = fmtTime(Math.max(s.time, 0));
    $("misery").textContent = String(Math.round(s.misery));
    $("m-patience").style.setProperty("--v", `${Math.max(0, s.patience)}%`);
    $("m-suspicion").style.setProperty("--v", `${s.suspicion}%`);
    if (s.log.length !== this.lastFeed) {
      this.lastFeed = s.log.length;
      $("feed").innerHTML = s.log.slice(-4).map((e) =>
        `<div class="${e.kind}"><time>${fmtTime(e.time)}</time>${e.text}</div>`).join("");
    }
  }

  showResults() {
    const r = this.sim.result();
    const title = r.why === "closed" ? "Park closed. They stayed all day."
      : r.why === "left" ? `They left at ${fmtTime(this.sim.ended!.at)}.`
      : "You're fired.";
    const mult = r.why === "closed" ? "Full-day bonus ×1.5" : r.why === "left" ? "Left early ×1" : "Severance ×0.25";
    $("results-card").innerHTML = `
      <h1>${title}</h1>
      <div class="scoreline">${r.score} misery</div>
      <div>${r.misery} raw · ${mult} · ${r.done}/6 of their plans happened</div>
      <p><b>Their review:</b> <span class="stars">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</span></p>
      ${r.lines.map((l) => `<blockquote>${l}</blockquote>`).join("")}
      <p class="memo">${r.memo}</p>
      <button class="big" id="again">Another day</button>`;
    $("results").classList.remove("hidden");
    $("again").addEventListener("click", () => {
      $("results").classList.add("hidden");
      this.select(null);
      restartRunning = true;
      this.scene.restart();
    });
  }

  update(_t: number, dtMs: number) {
    if (this.running && !this.sim.ended) this.sim.step((dtMs / 1000) * this.speed * GAME_MIN_PER_SEC);
    if (this.running && this.sim.ended) {
      this.running = false;
      window.setTimeout(() => this.showResults(), 1200);
    }
    this.drawDynamic();
    this.updateLabels();
    this.renderHud();
    this.renderSide();
  }
}

function boot() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const size = () => ({ w: Math.max(window.innerWidth, 320) * dpr, h: Math.max(window.innerHeight, 200) * dpr });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: size().w,
    height: size().h,
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
    render: { antialias: true },
    scene: Park,
  });
  window.addEventListener("resize", () => game.scale.resize(size().w, size().h));
  (window as unknown as { park: Phaser.Game }).park = game;
}
const bootSoon = () => requestAnimationFrame(() => requestAnimationFrame(boot));
if (document.readyState === "complete") bootSoon();
else window.addEventListener("load", bootSoon);
