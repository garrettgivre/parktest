import Phaser from "phaser";
import { TOOL, TOOLS, TRAITS, ToolId } from "../sim/content";
import { EDGES, LAKE, LANDS, LOC, LOCS, LocDef, NODES } from "../sim/park";
import { ActionView, Sim, Target, fmtTime } from "../sim/sim";

// Gameplay test v1: big gray-box park, a worker you walk around, DOM panels.

const HALF = 64; // half a tile's screen width
const ZPX = 78; // screen px per tile of height
const GAME_MIN_PER_SEC = 1.5; // 1x: a 12-hour day lasts 8 minutes
const DPR = Math.min(window.devicePixelRatio || 1, 3);

const $ = (id: string) => document.getElementById(id)!;
const iso = (i: number, j: number, z = 0) => ({ x: (i - j) * HALF, y: (i + j) * (HALF / 2) - z * ZPX });
const uv = (u: number, v: number) => ({ x: u * HALF, y: v * (HALF / 2) });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

type Selection = Target | null;

let wired = false;
let current: Park;
let skipIntro = false; // "Another day" goes straight to the briefing

let toastTimer = 0;
function toast(msg: string, ms = 2600) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), ms);
}

class Park extends Phaser.Scene {
  sim!: Sim;
  speed = 1;
  running = false;
  autoPause = true;
  sel: Selection = null;
  dyn!: Phaser.GameObjects.Graphics;
  locLabels: Record<string, Phaser.GameObjects.Text> = {};
  landLabels: Phaser.GameObjects.Text[] = [];
  bubble!: Phaser.GameObjects.Text;
  icons!: Phaser.GameObjects.Text[];
  lastSide = "";
  lastFeed = -1;
  lastHud = "";
  pinch: { d: number; zoom: number } | null = null;
  camFollow = true; // camera tracks you until you drag the map
  gestured = false;

  create() {
    current = this;
    this.sim = new Sim();
    this.running = false;
    this.sel = null;
    this.lastSide = this.lastHud = "";
    this.lastFeed = -1;
    this.locLabels = {};
    this.landLabels = [];
    this.cameras.main.setBackgroundColor("#2c4a2e");
    this.drawStatic();
    this.dyn = this.add.graphics().setDepth(5000);
    this.icons = [];
    this.bubble = this.add.text(0, 0, "", {
      fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: "40px", color: "#222",
      backgroundColor: "#ffffffee", padding: { x: 14, y: 8 }, wordWrap: { width: 640 }, align: "center",
    }).setOrigin(0.5, 1).setDepth(8000).setVisible(false);

    this.setupCamera();
    if (!wired) this.wireDom();
    this.setSpeed(1);
    if (skipIntro) this.showBriefing();
    else this.showIntro();
    this.renderTools();
  }

  // ------------------------------------------------------------ setup

  wireDom() {
    // DOM outlives scene restarts, so wire it once and route to the live scene.
    wired = true;
    document.querySelectorAll<HTMLButtonElement>(".speed button").forEach((b) =>
      b.addEventListener("click", () => current.setSpeed(Number(b.dataset.speed))),
    );
    $("side").addEventListener("click", (e) => current.onSideClick(e));
    $("duty").addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button") && current.sim.duty) {
        current.select({ kind: "loc", id: current.sim.duty.loc });
        current.centerOnLoc(current.sim.duty.loc);
      }
    });
    $("follow").addEventListener("click", () => {
      const s = current.sim;
      s.setFollow(!s.w.follow);
      if (s.w.follow) current.camFollow = true;
      if (s.w.follow) toast("Tailing the Hendersons. Stay in earshot to hear their plans.");
    });
    $("findme").addEventListener("click", () => {
      current.camFollow = true;
      current.centerOn(current.sim.w.pos.i, current.sim.w.pos.j);
    });
    $("findthem").addEventListener("click", () => {
      current.camFollow = false;
      current.centerOn(current.sim.g.pos.i, current.sim.g.pos.j);
    });
    $("tools").addEventListener("click", (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>(".tool")?.dataset.tool as ToolId | undefined;
      if (id) toast(`${TOOL[id].icon} ${TOOL[id].name}: ${TOOL[id].blurb}`, 4000);
    });
    $("me").addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) current.sim.cancelTask();
    });
  }

  setSpeed(s: number) {
    this.speed = s;
    document.querySelectorAll<HTMLButtonElement>(".speed button").forEach((o) =>
      o.classList.toggle("on", Number(o.dataset.speed) === s),
    );
  }

  setupCamera() {
    const cam = this.cameras.main;
    const lo = uv(-56, -14), hi = uv(56, 90);
    cam.setBounds(lo.x, lo.y, hi.x - lo.x, hi.y - lo.y);
    cam.setZoom((36 * DPR) / (HALF * 2)); // a tile ~36 css px wide
    this.centerOn(NODES.M1.i, NODES.M1.j - 0.5);

    this.input.addPointer(1);
    this.input.on("pointerdown", () => { if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) this.gestured = false; });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (!this.pinch) this.pinch = { d, zoom: cam.zoom };
        this.zoomAt(this.pinch.zoom * (d / this.pinch.d), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        this.gestured = true;
        return;
      }
      this.pinch = null;
      if (!p.isDown) return;
      if (p.getDistance() > 10) { this.gestured = true; this.camFollow = false; }
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) this.pinch = null;
      if (this.gestured) return;
      this.tap(cam.getWorldPoint(p.x, p.y));
    });
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(cam.zoom * (dy > 0 ? 0.88 : 1.14), p.x, p.y);
    });
  }

  zoomAt(z: number, sx: number, sy: number) {
    const cam = this.cameras.main;
    const minZ = (9 * DPR) / (HALF * 2), maxZ = (110 * DPR) / (HALF * 2);
    z = Phaser.Math.Clamp(z, minZ, maxZ);
    const w = cam.width, h = cam.height;
    const wx = cam.scrollX + w / 2 + (sx - w / 2) / cam.zoom;
    const wy = cam.scrollY + h / 2 + (sy - h / 2) / cam.zoom;
    cam.setZoom(z);
    cam.scrollX = wx - (sx - w / 2) / z - w / 2;
    cam.scrollY = wy - (sy - h / 2) / z - h / 2;
  }

  centerOn(i: number, j: number) {
    const p = iso(i, j);
    this.cameras.main.centerOn(p.x, p.y);
  }
  centerOnLoc(id: string) { const l = LOC[id]; this.centerOn(l.i, l.j); }

  // ------------------------------------------------------------ static map

  drawStatic() {
    const g = this.add.graphics().setDepth(-100);
    // Lands as soft rounded regions.
    for (const land of LANDS) {
      const [u0, v0, u1, v1] = land.box;
      const a = uv(u0, v0), b = uv(u1, v1);
      g.fillStyle(land.ground, 1).fillRoundedRect(a.x, a.y, b.x - a.x, b.y - a.y, 120);
    }
    for (const land of LANDS) {
      const [u0, v0, u1, v1] = land.box;
      const a = uv(u0, v0), b = uv(u1, v1);
      g.lineStyle(6, 0x000000, 0.12).strokeRoundedRect(a.x, a.y, b.x - a.x, b.y - a.y, 120);
    }
    const lake = uv(LAKE.u, LAKE.v);
    g.fillStyle(0x2e86c1, 1).fillEllipse(lake.x, lake.y, LAKE.ru * 2 * HALF, LAKE.rv * 2 * (HALF / 2));
    g.lineStyle(10, 0xd6eaf8, 0.6).strokeEllipse(lake.x, lake.y, LAKE.ru * 2 * HALF, LAKE.rv * 2 * (HALF / 2));

    // Paths, spurs to doors, junctions.
    const paths = this.add.graphics().setDepth(-90);
    const line = (ax: number, ay: number, bx: number, by: number, w: number) =>
      paths.lineStyle(w, 0xd9ccb4, 1).lineBetween(ax, ay, bx, by);
    for (const [a, b] of EDGES) {
      const pa = iso(NODES[a].i, NODES[a].j), pb = iso(NODES[b].i, NODES[b].j);
      line(pa.x, pa.y, pb.x, pb.y, 60);
    }
    for (const l of LOCS) {
      const n = NODES[l.node], door = this.doorPoint(l);
      const pa = iso(n.i, n.j), pb = iso(door.i, door.j);
      line(pa.x, pa.y, pb.x, pb.y, 30);
    }
    for (const n of Object.values(NODES)) {
      const p = iso(n.i, n.j);
      paths.fillStyle(0xd9ccb4, 1).fillEllipse(p.x, p.y, 120, 60);
    }

    for (const l of [...LOCS].sort((a, b) => a.i + a.j - (b.i + b.j))) {
      this.block(l);
      const top = iso(l.i, l.j, l.h);
      this.locLabels[l.id] = this.add.text(top.x, top.y - 16, l.name, {
        fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: "40px", color: "#ffffff",
        stroke: "#000000", strokeThickness: 8, align: "center",
      }).setOrigin(0.5, 1).setDepth(6000);
    }
    for (const land of LANDS) {
      const p = uv(land.label[0], land.label[1]);
      this.landLabels.push(this.add.text(p.x, p.y, land.name.toUpperCase(), {
        fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: "60px", color: "#ffffff",
        stroke: "#00000088", strokeThickness: 10, fontStyle: "bold",
      }).setOrigin(0.5, 0.5).setDepth(5900).setAlpha(0.9));
    }
  }

  doorPoint(l: LocDef) {
    const n = NODES[l.node];
    const dx = n.i - l.i, dy = n.j - l.j, len = Math.hypot(dx, dy) || 1;
    const r = Math.max(l.w, l.d) / 2;
    return { i: l.i + (dx / len) * r, j: l.j + (dy / len) * r };
  }

  block(l: LocDef) {
    const g = this.add.graphics().setDepth(l.i + l.j);
    const i0 = l.i - l.w / 2, i1 = l.i + l.w / 2, j0 = l.j - l.d / 2, j1 = l.j + l.d / 2;
    const c = Phaser.Display.Color.IntegerToColor(l.color);
    const shade = (k: number) => Phaser.Display.Color.GetColor(c.red * k, c.green * k, c.blue * k);
    const face = (pts: { x: number; y: number }[], color: number) => {
      g.fillStyle(color, 1).lineStyle(3, 0x000000, 0.35).beginPath().moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.closePath().fillPath().strokePath();
    };
    g.fillStyle(0x000000, 0.18).beginPath();
    [iso(i0 + 0.2, j0 + 0.3), iso(i1 + 0.4, j0 + 0.3), iso(i1 + 0.4, j1 + 0.3), iso(i0 + 0.2, j1 + 0.3)]
      .forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath().fillPath();
    face([iso(i1, j0), iso(i1, j1), iso(i1, j1, l.h), iso(i1, j0, l.h)], shade(0.72));
    face([iso(i0, j1), iso(i1, j1), iso(i1, j1, l.h), iso(i0, j1, l.h)], shade(0.55));
    face([iso(i0, j0, l.h), iso(i1, j0, l.h), iso(i1, j1, l.h), iso(i0, j1, l.h)], shade(1.0));
  }

  // ------------------------------------------------------------ dynamic

  icon(k: number, text: string, x: number, y: number, size = 56) {
    let t = this.icons[k];
    if (!t) {
      t = this.add.text(0, 0, "", { fontSize: "56px" }).setOrigin(0.5, 1).setDepth(7000);
      this.icons[k] = t;
    }
    t.setText(text).setPosition(x, y).setVisible(true).setFontSize(size);
    return k + 1;
  }

  drawDynamic() {
    const s = this.sim, g = this.dyn;
    const zoom = this.cameras.main.zoom;
    g.clear();
    let k = 0;
    const bob = Math.sin(this.time.now / 250) * 8;

    for (const l of LOCS) {
      const st = s.loc(l.id);
      const top = iso(l.i, l.j, l.h);
      if (s.isClosed(l.id)) {
        g.lineStyle(12, st.closedBy === "you" ? 0xff9900 : 0xff3333, 1);
        g.lineBetween(top.x - 40, top.y - 40, top.x + 40, top.y + 40);
        g.lineBetween(top.x - 40, top.y + 40, top.x + 40, top.y - 40);
      }
      if (s.isSlow(l.id)) k = this.icon(k, "🐌", top.x + 70, top.y);
      if (st.vegSwap) k = this.icon(k, "🍖", top.x + 70, top.y);
      if (st.showCancelled) k = this.icon(k, "🚫", top.x + 70, top.y);
      if (st.readerUntil > s.time) k = this.icon(k, "💵", top.x + 70, top.y);
      if (s.duty?.loc === l.id) k = this.icon(k, "📋", top.x, top.y - 70 + bob, 72);
      if (this.sel?.kind === "loc" && this.sel.id === l.id) {
        const b = iso(l.i, l.j);
        g.lineStyle(8, 0xffd166, 1).strokeEllipse(b.x, b.y, (l.w + l.d) * HALF + 50, ((l.w + l.d) * HALF) / 2 + 25);
      }
    }
    for (const [id, until] of Object.entries(s.blocked)) {
      if (until <= s.time) continue;
      const n = NODES[id], p = iso(n.i, n.j);
      k = this.icon(k, "⚠️", p.x, p.y, 64);
    }
    if (this.sel?.kind === "node") {
      const n = NODES[this.sel.id], p = iso(n.i, n.j);
      g.lineStyle(8, 0xffd166, 1).strokeEllipse(p.x, p.y, 160, 80);
    }

    // Earshot ring around you.
    const wp = iso(s.w.pos.i, s.w.pos.j);
    if (!s.has("radio")) {
      g.lineStyle(4, 0xffffff, 0.25).strokeEllipse(wp.x, wp.y, 9 * 2 * HALF * Math.SQRT2, 9 * HALF * Math.SQRT2);
    }
    // Your route.
    if (s.w.route.length) {
      g.lineStyle(10, 0x7ec84a, 0.8).beginPath().moveTo(wp.x, wp.y);
      for (const id of s.w.route) { const p = iso(NODES[id].i, NODES[id].j); g.lineTo(p.x, p.y); }
      g.strokePath();
    }
    // Their route, if you can hear where they're going.
    const ga = s.g.act;
    if (ga.t === "walk" && s.heard() && s.g.route.length) {
      const gp = iso(s.g.pos.i, s.g.pos.j);
      g.lineStyle(8, 0xff66cc, 0.7).beginPath().moveTo(gp.x, gp.y);
      for (const id of s.g.route) { const p = iso(NODES[id].i, NODES[id].j); g.lineTo(p.x, p.y); }
      g.strokePath();
    }

    // The Hendersons.
    if (ga.t !== "gone") {
      const c = iso(s.g.pos.i, s.g.pos.j);
      if (this.sel?.kind === "guests") g.lineStyle(8, 0xffd166, 1).strokeEllipse(c.x, c.y, 150, 75);
      [[0xe84393, -16], [0xf39c12, 16]].forEach(([col, dx]) => this.pawn(g, c.x + dx, c.y + (dx > 0 ? 6 : -6), col));
      const show = s.thoughtUntil > s.time && !!s.thought;
      this.bubble.setVisible(show);
      if (show) {
        this.bubble.setText(s.thought).setPosition(c.x, c.y - 120)
          .setScale(Math.max(0.5, (13 * DPR) / (40 * zoom)));
      }
    } else {
      this.bubble.setVisible(false);
    }
    // You: green vest, cap.
    this.pawn(g, wp.x, wp.y, 0x2ecc71, true);
    if (s.w.task) {
      const pct = 1 - s.w.task.left / s.w.task.total;
      g.fillStyle(0x000000, 0.6).fillRect(wp.x - 40, wp.y - 120, 80, 12);
      g.fillStyle(0xffd166, 1).fillRect(wp.x - 40, wp.y - 120, 80 * pct, 12);
    }
    for (let n = k; n < this.icons.length; n++) this.icons[n].setVisible(false);

    // Labels hold a constant on-screen size; hide building names when zoomed far out.
    const tileCss = (zoom * HALF * 2) / DPR;
    const ls = (12 * DPR) / (40 * zoom);
    for (const t of Object.values(this.locLabels)) t.setScale(ls).setVisible(tileCss >= 20);
    for (const t of this.landLabels) t.setScale(Math.max(ls * 1.2, 1)).setAlpha(tileCss >= 20 ? 0.55 : 0.95);
  }

  pawn(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, worker = false) {
    g.fillStyle(0x000000, 0.3).fillEllipse(x, y, 40, 18);
    g.fillStyle(color, 1).fillRoundedRect(x - 13, y - 70, 26, 58, 9);
    g.fillStyle(0xf1c27d, 1).fillCircle(x, y - 82, 14);
    g.lineStyle(3, 0x000000, 0.7).strokeRoundedRect(x - 13, y - 70, 26, 58, 9).strokeCircle(x, y - 82, 14);
    if (worker) g.fillStyle(0x1e5631, 1).fillRect(x - 15, y - 98, 30, 9);
  }

  updateLabels() {
    const s = this.sim;
    for (const l of LOCS) {
      const t = this.locLabels[l.id];
      const st = s.loc(l.id);
      let status = "";
      if (s.isClosed(l.id)) status = "CLOSED";
      else if (l.kind === "ride") status = `${s.currentWait(l.id)} min`;
      const ga = s.g.act;
      if (ga.t === "queue" && ga.loc === l.id) status += ` · 👥 ${Math.round((1 - ga.left / ga.total) * 100)}% to front`;
      const text = status ? `${l.name}\n${status}` : l.name;
      if (t.text !== text) t.setText(text);
      t.setColor(s.isClosed(l.id) ? "#ffb3a7" : st.def.kind === "ride" ? "#ffffff" : "#fff3c4");
    }
  }

  // ------------------------------------------------------------ input

  tap(w: Phaser.Math.Vector2) {
    const s = this.sim;
    if (!this.running) return;
    if (s.g.act.t !== "gone") {
      const c = iso(s.g.pos.i, s.g.pos.j, 0.5);
      if (Phaser.Math.Distance.Between(w.x, w.y, c.x, c.y) < 90) return this.select({ kind: "guests" });
    }
    let best: string | null = null, bestD = Infinity;
    for (const l of LOCS) {
      const c = iso(l.i, l.j, l.h / 2);
      const r = ((l.w + l.d) / 2) * HALF * 0.85 + 30;
      const d = Phaser.Math.Distance.Between(w.x, w.y, c.x, c.y);
      if (d < r && d < bestD) { best = l.id; bestD = d; }
    }
    if (best) return this.select({ kind: "loc", id: best });
    // Junctions; otherwise walk to the nearest one.
    let node = "", nd = Infinity;
    for (const n of Object.values(NODES)) {
      const p = iso(n.i, n.j);
      const d = Phaser.Math.Distance.Between(w.x, w.y, p.x, p.y);
      if (d < nd) { nd = d; node = n.id; }
    }
    if (nd < 90) return this.select({ kind: "node", id: node });
    if (nd < 900) {
      this.select(null);
      s.walkTo(node);
      return;
    }
    this.select(null);
  }

  select(sel: Selection) {
    this.sel = sel;
    this.lastSide = "";
    $("side").classList.toggle("hidden", !sel);
    this.renderSide();
  }

  onSideClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest("button");
    if (!el || !this.sel) return;
    const s = this.sim;
    if (el.classList.contains("x")) return this.select(null);
    if (el.dataset.walk) {
      if (this.sel.kind === "guests") s.setFollow(true);
      else s.walkTo(this.sel.kind === "loc" ? LOC[this.sel.id].node : this.sel.id);
    }
    if (el.dataset.act) {
      const view = s.actionsFor(this.sel).find((a) => a.def.id === el.dataset.act);
      if (view && s.doAction(this.sel, view.def) && view.walk > 0) toast(`Walking over to: ${view.def.name}`);
    }
    this.lastSide = "";
  }

  actionButtons(views: ActionView[]) {
    let html = "";
    for (const v of views) {
      const time = `⏱ ${v.def.minutes} min`;
      const cost = v.susp === 0 ? "" : v.susp < 0 ? ` · Suspicion ${v.susp}` : ` · Suspicion +${v.susp}`;
      const walk = v.walk > 0.05 ? `🚶 ${Math.ceil(v.walk)} min walk, then ` : "";
      html += `<button class="sab" data-act="${v.def.id}" ${v.why ? "disabled" : ""}>
        <b>${esc(v.def.name)}</b><small>${esc(v.def.blurb)}</small>
        <span class="cost">${v.why ? esc(v.why) : `${walk}${time}${cost}`}</span></button>`;
    }
    return html;
  }

  renderSide() {
    const s = this.sim, sel = this.sel;
    if (!sel) return;
    let html = `<button class="x">✕</button>`;
    if (sel.kind === "loc") {
      const st = s.loc(sel.id), l = st.def;
      const land = LANDS.find((x) => x.id === l.land)!;
      const bits: string[] = [];
      if (s.isClosed(l.id)) bits.push(`<span class="warn">Closed until ${fmtTime(st.closedUntil)} (${st.closedBy === "you" ? "your doing" : "genuinely broken"})</span>`);
      else bits.push("Open");
      if (l.kind === "ride") bits.push(`Line: ${s.currentWait(l.id)} min${s.isSlow(l.id) ? " (slowed)" : ""}`);
      if (l.vegan) bits.push("Vegan menu");
      if (l.shows) bits.push(`${l.showName}: ${l.shows.map(fmtTime).join(", ")}${st.showCancelled ? " — next one CANCELLED" : ""}`);
      if (st.vegSwap) bits.push("Vegan patties: swapped 😈");
      if (st.readerUntil > s.time) bits.push(`Cash only until ${fmtTime(st.readerUntil)}`);
      html += `<h2>${esc(l.name)}</h2><div class="status">${land.name} · ${bits.join(" · ")}</div>`;
      const notes: string[] = [];
      if (s.guestsAtLoc(l.id)) notes.push(`<span class="here">The Hendersons are right here.</span>`);
      if (s.isWitnessed(sel)) notes.push(`<span class="warn">They'd see you do it (+50% suspicion).</span>`);
      if (s.hasAlibi(l.land)) notes.push(`<span class="ok">You have an alibi in ${land.name} (−40%).</span>`);
      if (s.duty?.loc === l.id) notes.push(`<span class="here">📋 Your duty is here.</span>`);
      if (notes.length) html += `<div class="status">${notes.join("<br>")}</div>`;
      if (!s.workerAt(l.node)) html += `<button class="walk" data-walk="1">🚶 Walk here (${Math.ceil(s.walkMinutes(l.node))} min)</button>`;
      else html += `<div class="status ok">You're here.</div>`;
      const views = s.actionsFor(sel);
      html += views.length ? this.actionButtons(views) : `<div class="status">Nothing to break here.</div>`;
    } else if (sel.kind === "node") {
      const n = NODES[sel.id];
      const land = LANDS.find((x) => x.id === n.land)!;
      html += `<h2>Path junction</h2><div class="status">${land.name}${s.isBlocked(n.id) ? ` · <span class="warn">Wet Floor sign until ${fmtTime(s.blocked[n.id])}</span>` : ""}</div>`;
      if (!s.workerAt(n.id)) html += `<button class="walk" data-walk="1">🚶 Walk here (${Math.ceil(s.walkMinutes(n.id))} min)</button>`;
      const views = s.actionsFor(sel);
      html += views.length ? this.actionButtons(views) : `<div class="status">Pack Wet Floor signs to block junctions.</div>`;
    } else {
      const heard = s.heard();
      html += `<h2>The Hendersons</h2><div class="status">${esc(s.activity())}</div>`;
      html += `<div class="traits">${s.traits.map((t) => `<span class="trait">${TRAITS.find((x) => x.id === t)!.label}</span>`).join("")}</div>`;
      if (heard) {
        html += `<div class="meter"><span>Hunger</span><i><b style="--v:${s.hunger}%;--c:#d68910"></b></i></div>`;
        html += `<div class="meter"><span>Bladder</span><i><b style="--v:${s.bladder}%;--c:#3498db"></b></i></div>`;
      } else {
        html += `<div class="status warn">Too far away to tell how they're doing.</div>`;
      }
      html += `<div class="status" style="margin-top:6px"><b>What they want today</b></div><ul>`;
      for (const w of s.wishes) {
        if (!w.revealed) { html += `<li class="hidden-wish">??? (${w.def.who}) — get within earshot</li>`; continue; }
        const cls = w.done ? "done" : w.failed ? "failed" : "";
        const mark = w.done ? "✓" : w.failed ? "✗" : "•";
        html += `<li class="${cls}">${mark} ${esc(w.def.label)} <small>(${w.def.who})</small></li>`;
      }
      html += `</ul>`;
      html += `<button class="walk" data-walk="1">${s.w.follow ? "👥 Tailing them" : "👥 Tail them"}</button>`;
      html += this.actionButtons(s.actionsFor(sel));
    }
    if (html !== this.lastSide) {
      $("side").innerHTML = html;
      this.lastSide = html;
    }
  }

  renderTools() {
    const s = this.sim;
    $("tools").innerHTML = (Object.keys(s.tools) as ToolId[]).map((id) => {
      const n = s.tools[id]!;
      const charges = TOOL[id].charges ? `<small>${n}</small>` : "";
      return `<button class="tool ${n <= 0 ? "empty" : ""}" data-tool="${id}">${TOOL[id].icon}${charges}</button>`;
    }).join("");
  }

  renderHud() {
    const s = this.sim;
    $("time").textContent = fmtTime(Math.max(s.time, 0));
    $("misery").textContent = String(Math.round(s.misery));
    $("m-patience").style.setProperty("--v", `${Math.max(0, s.patience)}%`);
    $("m-suspicion").style.setProperty("--v", `${s.suspicion}%`);
    if (s.log.length !== this.lastFeed) {
      this.lastFeed = s.log.length;
      $("feed").innerHTML = s.log.slice(-3).map((e) =>
        `<div class="${e.kind}"><time>${fmtTime(e.time)}</time>${esc(e.text)}</div>`).join("");
      this.renderTools();
    }
    const duty = s.duty
      ? `<span>📋 <b>${esc(LOC[s.duty.loc].name)}</b> by ${fmtTime(s.duty.deadline)}</span><button>Show</button>`
      : "";
    const me = s.w.task
      ? `${esc(s.workerStatus())} <button>✕</button>`
      : s.w.pending ? `${esc(s.workerStatus())} <button>✕</button>` : s.w.follow ? "👥 Tailing the Hendersons" : "";
    const hud = duty + "|" + me + "|" + s.w.follow;
    if (hud !== this.lastHud) {
      this.lastHud = hud;
      $("duty").innerHTML = duty;
      $("duty").classList.toggle("hidden", !duty);
      $("me").innerHTML = me;
      $("follow").classList.toggle("on", s.w.follow);
    }
  }

  // ------------------------------------------------------------ flow

  showIntro() {
    $("intro-card").innerHTML = `
      <h1>Funtier Lands</h1>
      <p class="tag">Fright Fest-ish season. Under new ownership. Again.</p>
      <p>You're a park employee. Management has one goal this quarter: guest satisfaction must go <b>down</b>.
      Each day you get one target group. Ruin their day, and make it look like ordinary incompetence.</p>
      <ul>
        <li><b>Walk around.</b> Tap a building to walk there and sabotage it. Tap a path to just walk.</li>
        <li><b>Listen in.</b> You only hear their plans inside your earshot ring. Tail them (👥) or run ahead and set traps.</li>
        <li><b>Misery</b> is your score. Keep them here until 10 PM for a <b>1.5×</b> bonus. If <b>Patience</b> runs out they go home.</li>
        <li><b>Suspicion:</b> worse if they see you, if sabotage piles up, or if you skip your manager's 📋 duties. 100 = fired.</li>
      </ul>
      <button class="big" id="go-brief">Morning briefing →</button>`;
    $("intro").classList.remove("hidden");
    $("go-brief").addEventListener("click", () => this.showBriefing());
  }

  showBriefing() {
    const s = this.sim;
    const traits = s.traits.map((t) => TRAITS.find((x) => x.id === t)!);
    const known = s.wishes.filter((w) => w.revealed);
    const offer = [...TOOLS].sort(() => Math.random() - 0.5).slice(0, 5);
    const chosen = new Set<ToolId>();
    const render = () => {
      $("intro-card").innerHTML = `
        <h1>Morning briefing</h1>
        <p class="tag">Today's target: <b>The Hendersons</b> (Deb &amp; Gary)</p>
        <div>${traits.map((t) => `<span class="tagline"><b>${t.label}</b> — ${t.blurb}</span>`).join(" ")}</div>
        <h2>Intel says they want to…</h2>
        <ul class="known">${known.map((w) => `<li>${esc(w.def.label)}</li>`).join("")}<li><i>…plus ${s.wishes.length - known.length} more things you'll have to overhear.</i></li></ul>
        <h2>Pick 3 tools for your shift</h2><div class="picks">${offer.map((t) =>
          `<button class="pick ${chosen.has(t.id) ? "on" : ""}" data-pick="${t.id}"><b>${t.icon} ${t.name}${t.charges ? ` ×${t.charges}` : ""}</b>${t.blurb}</button>`).join("")}</div>
        <button class="big" id="clockin" ${chosen.size !== 3 ? "disabled" : ""}>Clock in</button>`;
      $("intro-card").querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) =>
        b.addEventListener("click", () => {
          const id = b.dataset.pick as ToolId;
          if (chosen.has(id)) chosen.delete(id);
          else if (chosen.size < 3) chosen.add(id);
          render();
        }),
      );
      $("clockin").addEventListener("click", () => {
        s.equip([...chosen]);
        $("intro").classList.add("hidden");
        this.renderTools();
        this.running = true;
        toast("Psst: the gate is right by you. Those scanners look fragile…", 3500);
      });
    };
    $("intro").classList.remove("hidden");
    render();
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
      <div>${r.misery} raw · ${mult} · ${r.done}/${r.total} of their plans happened · duties ${r.duties}</div>
      <p><b>Their review:</b> <span class="stars">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</span></p>
      ${r.lines.map((l) => `<blockquote>${esc(l)}</blockquote>`).join("")}
      <p class="memo">${esc(r.memo)}</p>
      <button class="big" id="again">Another day</button>`;
    $("results").classList.remove("hidden");
    $("again").addEventListener("click", () => {
      $("results").classList.add("hidden");
      this.select(null);
      skipIntro = true;
      this.scene.restart();
    });
  }

  update(_t: number, dtMs: number) {
    const s = this.sim;
    if (this.running && !s.ended) {
      s.step((dtMs / 1000) * this.speed * GAME_MIN_PER_SEC);
      if (s.pauses.length) {
        const msg = s.pauses.splice(0).join(" · ");
        if (this.autoPause && this.speed > 0) this.setSpeed(0);
        toast(`⏸ ${msg}`, 3500);
      }
    }
    if (this.running && s.ended) {
      this.running = false;
      window.setTimeout(() => this.showResults(), 1200);
    }
    if (this.camFollow) {
      const cam = this.cameras.main, p = iso(s.w.pos.i, s.w.pos.j);
      const k = Math.min(1, dtMs / 250);
      cam.centerOn(cam.midPoint.x + (p.x - cam.midPoint.x) * k, cam.midPoint.y + (p.y - cam.midPoint.y) * k);
    }
    this.drawDynamic();
    this.updateLabels();
    this.renderHud();
    this.renderSide();
  }
}

function boot() {
  const size = () => ({ w: Math.max(window.innerWidth, 320) * DPR, h: Math.max(window.innerHeight, 200) * DPR });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: size().w,
    height: size().h,
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR },
    render: { antialias: true },
    scene: Park,
  });
  window.addEventListener("resize", () => game.scale.resize(size().w, size().h));
  (window as unknown as { park: Phaser.Game }).park = game;
}
const bootSoon = () => requestAnimationFrame(() => requestAnimationFrame(boot));
if (document.readyState === "complete") bootSoon();
else window.addEventListener("load", bootSoon);
