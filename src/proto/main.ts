import Phaser from "phaser";
import { COMBOS, TOOL, TOOLS, TRAITS, ToolId } from "../sim/content";
import {
  BRIDGES, CENTER, DECOR, DEPOT_V, EDGES, GATE_V, HUB_V, LANDMARKS, LOC, LOCS, LocDef, LOT_V, NODES, RING_IDS, SERVICE,
  ZONES, ZoneId, lagoonR, ringPos, shapeR, shortest, zoneAtAngle,
} from "../sim/park";
import { isMuted, setMuted, sfx, unlock } from "./sfx";
import { ActionView, OPEN, Sim, Target, fmtTime } from "../sim/sim";

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// First-time tips. Each fires once (remembered per browser) when its condition holds.
const TIPS: { id: string; when: (s: Sim) => boolean; text: string }[] = [
  { id: "gate", when: (s) => s.time < OPEN + 4, text: "Tip: tap the Front Gate. They haven't scanned in yet, and those scanners look fragile\u2026" },
  { id: "queue", when: (s) => s.g.act.t === "queue" && !!s.g.act.wish && s.heard(), text: "Tip: they're in line for something they want. Close it when the bar over them turns red for a \u201cSo Close!\u201d" },
  { id: "earshot", when: (s) => !s.heard() && s.time > OPEN + 25, text: "Tip: you're out of earshot. Tail them (\ud83d\udc65) to overhear plans, or go set a trap somewhere." },
  { id: "duty", when: (s) => !!s.duty, text: "Tip: Brad's duties lower suspicion and give you an alibi in that land. Skipping one costs you." },
  { id: "brad", when: (s) => s.suspicion >= 45, text: "Tip: Brad is getting curious. Never sabotage inside his red sight ring (+20 suspicion)." },
  { id: "patience", when: (s) => s.patience < 40, text: "Tip: their Patience is low. Ease off or comp a churro \u2014 at zero they go home." },
  { id: "complain", when: (s) => s.g.act.t === "walk" && s.g.act.goal.purpose === "complain", text: "Tip: they're heading to Guest Relations! Beat them there and route complaints to \u201cthe old company.\u201d" },
  { id: "heat", when: (s) => s.heat(), text: "Tip: heat advisory! Unplugged queue fans hit much harder until 4 PM." },
  { id: "haunt", when: (s) => s.time >= 18 * 60 + 20, text: "Tip: the Haunt opens at 7. Its monsters can be\u2026 sent on break." },
];

const CROWD = 44;
const GRAYBOX = store.get("park.graybox") === "1"; // Settings: show gray-box blocks instead of rendered art
const SHIRTS = [0xe74c3c, 0x3498db, 0x9b59b6, 0x1abc9c, 0xf1c40f, 0xe67e22, 0xecf0f1, 0x34495e, 0x16a085, 0xd35400];

// Gameplay test v1: big gray-box park, a worker you walk around, DOM panels.

const HALF = 64; // half a tile's screen width
const ZPX = 78; // screen px per tile of height
const GAME_MIN_PER_SEC = 1.5; // 1x: a 12-hour day lasts 8 minutes
const DPR = Math.min(window.devicePixelRatio || 1, 2); // 3x phones: 2x is plenty and far cheaper to fill

const $ = (id: string) => document.getElementById(id)!;
const iso = (i: number, j: number, z = 0) => ({ x: (i - j) * HALF, y: (i + j) * (HALF / 2) - z * ZPX });
const uv = (u: number, v: number) => ({ x: u * HALF, y: v * (HALF / 2) });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

type Selection = Target | null;

let wired = false;
let current: Park;
let skipIntro = false; // "Another day" goes straight to the briefing

let toastTimer = 0;
let comboTimer = 0;
function comboCallout(text: string) {
  const el = $("combo");
  el.textContent = text;
  el.classList.remove("show");
  void el.offsetWidth; // restart the pop animation
  el.classList.add("show");
  clearTimeout(comboTimer);
  comboTimer = window.setTimeout(() => el.classList.remove("show"), 2200);
}

function caughtCallout(text: string) {
  const el = $("combo");
  el.textContent = text;
  el.classList.add("caught");
  comboCallout(text);
  window.setTimeout(() => el.classList.remove("caught"), 2300);
}

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
  trainPhase = 0;
  night!: Phaser.GameObjects.Rectangle;
  swans: { img: Phaser.GameObjects.Image; f: number; phase: number; speed: number }[] = [];
  clouds: Phaser.GameObjects.Image[] = [];
  wheels: { wg: Phaser.GameObjects.Graphics; cars: Phaser.GameObjects.Rectangle[]; cx: number; cy: number; r: number }[] = [];
  drops: { img: Phaser.GameObjects.Image; i: number; j: number; top: number; t: number }[] = [];
  glows: Phaser.GameObjects.Image[] = [];
  ground!: { rt: Phaser.GameObjects.RenderTexture; lo: { x: number; y: number }; S: number };
  sprites!: { deb: Phaser.GameObjects.Image; gary: Phaser.GameObjects.Image; me: Phaser.GameObjects.Image; brad: Phaser.GameObjects.Image;
    // last positions, for facing and walk animation
    _last?: Map<Phaser.GameObjects.Image, { x: number; y: number; dir: number; moving: number }>;
    cars: Phaser.GameObjects.Image[]; gondolas: Phaser.GameObjects.Image[] };
  skyPhase = 0;
  bubble!: Phaser.GameObjects.Text;
  icons!: Phaser.GameObjects.Text[];
  lastSide = "";
  lastFeed = -1;
  lastHud = "";
  pinch: { d: number; zoom: number } | null = null;
  camFollow = true; // camera tracks you until you drag the map
  crowd: { pos: { i: number; j: number }; route: string[]; prev: string; color: number; img: Phaser.GameObjects.Image }[] = [];
  lineImgs: Record<string, Phaser.GameObjects.Image[]> = {};
  // Static things that are only drawn while near the camera (big win on phones).
  cullables: { obj: { setVisible(v: boolean): unknown }; x0: number; y0: number; x1: number; y1: number }[] = [];
  cullAt = 0;
  linesAt = 0;
  tipQueue: string[] = [];
  tipAt = 0;
  lastSky = "";
  seenTips = new Set<string>((store.get("park.tips") ?? "").split(",").filter(Boolean));
  gestured = false;

  /** Load rendered building sprites if they exist (npm run art). Missing ones fall back to gray-box. */
  preload() {
    if (GRAYBOX) return;
    this.load.json("groundArt", "sprites/ground/manifest.json");
    this.load.once("filecomplete-json-groundArt", () => {
      const m = this.cache.json.get("groundArt") as { textures: Record<string, unknown> } | undefined;
      for (const k of Object.keys(m?.textures ?? {})) this.load.image("gnd_" + k, `sprites/ground/${k}.webp`);
    });
    this.load.json("peopleArt", "sprites/people/manifest.json");
    this.load.once("filecomplete-json-peopleArt", () => {
      const m = this.cache.json.get("peopleArt") as { frameW: number; frameH: number; people: string[] } | undefined;
      for (const id of m?.people ?? []) {
        this.load.spritesheet("ppl_" + id, `sprites/people/${id}.webp`, { frameWidth: m!.frameW, frameHeight: m!.frameH });
      }
    });
    this.load.json("parkArt", "sprites/park/manifest.json");
    this.load.once("filecomplete-json-parkArt", () => {
      const m = this.cache.json.get("parkArt") as { sprites: Record<string, unknown> } | undefined;
      for (const id of Object.keys(m?.sprites ?? {})) this.load.image("spr_" + id, `sprites/park/${id}.webp`);
    });
  }

  /** Place a rendered sprite for an asset if we have one. Returns false to fall back to a block. */
  sprite(id: string, i: number, j: number) {
    const m = this.cache.json.get("parkArt") as { sprites: Record<string, { w: number; h: number; ax: number; ay: number }> } | undefined;
    const sp = m?.sprites[id];
    if (GRAYBOX || !sp || !this.textures.exists("spr_" + id)) return false;
    const p = iso(i, j);
    const img = this.add.image(p.x, p.y, "spr_" + id).setOrigin(sp.ax / sp.w, sp.ay / sp.h).setDepth(i + j);
    this.cullables.push({ obj: img, x0: p.x - sp.ax, y0: p.y - sp.ay, x1: p.x - sp.ax + sp.w, y1: p.y - sp.ay + sp.h });
    return true;
  }

  create() {
    current = this;
    this.sim = new Sim();
    this.running = false;
    this.sel = null;
    this.lastSide = this.lastHud = "";
    this.lastFeed = -1;
    this.locLabels = {};
    this.cullables = [];
    this.wheels = [];
    this.drops = [];
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
    this.bakePawns();
    this.buildNight();
    this.buildLagoon();
    if (!this.textures.exists("dropring")) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0x2c3e50, 1).fillEllipse(48, 16, 96, 30);
      g.fillStyle(0xf1c40f, 1).fillEllipse(48, 12, 96, 26);
      for (let k = 0; k < 8; k++) g.fillStyle(k % 2 ? 0xe74c3c : 0x3498db, 1).fillCircle(10 + k * 11, 14 + Math.sin((k / 7) * Math.PI) * 6, 4);
      g.generateTexture("dropring", 96, 32);
      g.destroy();
    }
    // Cloud shadows drifting over the park (the "glow" texture, darkened).
    const lo2 = uv(-95, -45), hi2 = uv(95, LOT_V + 22);
    this.clouds = [0, 1, 2, 3, 4].map((k) =>
      this.add.image(lo2.x + ((hi2.x - lo2.x) * k) / 5, lo2.y + ((hi2.y - lo2.y) * ((k * 37) % 10)) / 10, "glow")
        .setTint(0x000000).setAlpha(0.16).setScale(14 + k * 3, 6 + k).setDepth(5400));
    for (const l of LOCS) {
      if (l.id !== "glitter" && l.id !== "meteor") continue;
      const img = this.add.image(0, 0, "dropring").setDepth(l.i + l.j + 0.7);
      this.drops.push({ img, i: l.i, j: l.j, top: l.h * 1.12, t: Math.random() * 10 });
    }
    const sp = (key: string) => this.person(key.replace("p_", ""), key).setDepth(5001);
    this.sprites = {
      deb: sp("p_deb"), gary: sp("p_gary"), me: sp("p_me").setDepth(5002), brad: sp("p_brad"),
      cars: [0, 1, 2, 3].map((c) => this.add.image(0, 0, c === 0 ? "car0" : "car1").setOrigin(0.5, 1).setDepth(4995)),
      gondolas: [0, 1, 2, 3, 4, 5].map(() => this.add.image(0, 0, "gon0").setOrigin(0.5, 0).setDepth(4001)),
    };
    const ids = Object.keys(NODES).filter((id) => !/^t\d+$/.test(id) && id !== "lot");
    this.crowd = Array.from({ length: CROWD }, (_, k) => {
      const n = NODES[ids[k % ids.length]];
      const img = this.person("crowd" + (k % 6), "pawn" + (k % SHIRTS.length)).setDepth(4990);
      return { pos: { i: n.i + Math.random() - 0.5, j: n.j + Math.random() - 0.5 }, route: [], prev: n.id, color: SHIRTS[k % SHIRTS.length], img };
    });
    // Queue people at each ride, placed once along the path to its door.
    this.lineImgs = {};
    for (const l of LOCS) {
      if (l.kind !== "ride") continue;
      const a = NODES[l.node], b = this.doorPoint(l);
      this.lineImgs[l.id] = Array.from({ length: 9 }, (_, q) => {
        const t = 0.15 + (q / 10) * 0.8;
        const p = iso(a.i + (b.i - a.i) * t + (q % 2) * 0.12, a.j + (b.j - a.j) * t - (q % 2) * 0.12);
        const im = this.person("crowd" + ((q * 3 + l.id.length) % 6), "qpawn" + ((q * 3 + l.id.length) % SHIRTS.length));
        // face along the line, toward the ride
        const di = b.i - a.i, dj = b.j - a.j;
        if (im.texture.key.startsWith("ppl_")) im.setFrame(this.facing(di, dj) * 4);
        return im.setPosition(p.x, p.y).setDepth(4989).setVisible(false);
      });
    }
    this.autoPause = store.get("park.autopause") !== "0";
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
    $("gear").addEventListener("click", () => {
      const el = $("settings");
      el.classList.toggle("hidden");
      (el.querySelector("[data-set=autopause]") as HTMLInputElement).checked = current.autoPause;
      (el.querySelector("[data-set=sound]") as HTMLInputElement).checked = !isMuted();
      (el.querySelector("[data-set=graybox]") as HTMLInputElement).checked = GRAYBOX;
    });
    $("settings").addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.set === "autopause") { current.autoPause = el.checked; store.set("park.autopause", el.checked ? "1" : "0"); }
      if (el.dataset.set === "sound") { setMuted(!el.checked); unlock(); sfx.tap(); }
      if (el.dataset.set === "graybox") { store.set("park.graybox", el.checked ? "1" : "0"); location.reload(); }
    });
    $("settings").addEventListener("click", (e) => {
      if ((e.target as HTMLElement).dataset.set === "tips") {
        current.seenTips.clear();
        store.set("park.tips", "");
        toast("Tips will show again.");
      }
    });
    document.addEventListener("pointerdown", () => unlock(), { once: true });
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
    const lo = uv(-82, -30), hi = uv(82, LOT_V + 16);
    cam.setBounds(lo.x, lo.y, hi.x - lo.x, hi.y - lo.y);
    cam.setZoom((34 * DPR) / (HALF * 2)); // a tile ~34 css px wide
    this.centerOn(NODES.depot_b.i, NODES.depot_b.j);

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
    this.drawGround();
    const pt = (id: string) => iso(NODES[id].i, NODES[id].j);
    const circle = (gr: Phaser.GameObjects.Graphics, i: number, j: number, r: number, color: number, alpha = 1) =>
      gr.fillStyle(color, alpha).fillEllipse(iso(i, j).x, iso(i, j).y, r * 2 * HALF * Math.SQRT2, r * HALF * Math.SQRT2);

    // Plazas: Fountain Circle, and an entrance plaza where each land meets the promenade.
    const plaza = this.add.graphics().setDepth(-92);
    const hub = NODES.hub;
    circle(plaza, hub.i, hub.j, 5.2, 0x8d7b60);
    circle(plaza, hub.i, hub.j, 4.8, 0xd9ccb4);
    for (const id of RING_IDS) if (ZONES[id].kind === "land") circle(plaza, NODES[id].i, NODES[id].j, 2.6, 0xd9ccb4);

    // Paths by mode: walkways, the footbridge, train rails.
    const paths = this.add.graphics().setDepth(-90);
    const isBridge = (a2: string, b2: string) => BRIDGES.some(([x, y]) => (x === a2 && y === b2) || (x === b2 && y === a2));
    for (const e of EDGES) {
      const pa = pt(e.a), pb = pt(e.b);
      if (e.mode === "train") {
        paths.lineStyle(26, 0x6e4b2a, 1).lineBetween(pa.x, pa.y, pb.x, pb.y);
        paths.lineStyle(6, 0xb3b6b7, 1).lineBetween(pa.x, pa.y - 7, pb.x, pb.y - 7).lineBetween(pa.x, pa.y + 7, pb.x, pb.y + 7);
      } else if (e.mode === "foot") {
        if (isBridge(e.a, e.b)) paths.lineStyle(80, 0x6e4b2a, 1).lineBetween(pa.x, pa.y, pb.x, pb.y);
        else paths.lineStyle(76, 0x8d7f6a, 1).lineBetween(pa.x, pa.y, pb.x, pb.y); // curb
        paths.lineStyle(isBridge(e.a, e.b) ? 60 : 64, 0xd9ccb4, 1).lineBetween(pa.x, pa.y, pb.x, pb.y);
      }
    }
    for (const l of LOCS) {
      const n = NODES[l.node], door = this.doorPoint(l);
      const pa = iso(n.i, n.j), pb = iso(door.i, door.j);
      paths.lineStyle(30, 0xd9ccb4, 1).lineBetween(pa.x, pa.y, pb.x, pb.y);
    }
    for (const [a2, b2] of SERVICE) {
      const pa = pt(a2), pb = pt(b2);
      const len = Phaser.Math.Distance.Between(pa.x, pa.y, pb.x, pb.y), n = Math.floor(len / 70);
      for (let k = 0; k < n; k += 2) {
        const t0 = k / n, t1 = (k + 1) / n;
        paths.lineStyle(14, 0x5d4e37, 0.75).lineBetween(
          pa.x + (pb.x - pa.x) * t0, pa.y + (pb.y - pa.y) * t0, pa.x + (pb.x - pa.x) * t1, pa.y + (pb.y - pa.y) * t1);
      }
    }
    for (const n of Object.values(NODES)) {
      if (/^t\d+$/.test(n.id)) continue;
      const q = iso(n.i, n.j);
      paths.fillStyle(0xd9ccb4, 1).fillEllipse(q.x, q.y, 120, 60);
    }
    // Paver seams: short darker ticks across every walkway.
    for (const e of EDGES) {
      if (e.mode !== "foot" || isBridge(e.a, e.b)) continue;
      const pa = pt(e.a), pb = pt(e.b);
      const len = Phaser.Math.Distance.Between(pa.x, pa.y, pb.x, pb.y);
      const nx = -(pb.y - pa.y) / len, ny = (pb.x - pa.x) / len;
      for (let d = 40; d < len - 40; d += 46) {
        const x = pa.x + ((pb.x - pa.x) * d) / len, y = pa.y + ((pb.y - pa.y) * d) / len;
        paths.lineStyle(4, 0xb8a98f, 0.8).lineBetween(x - nx * 26, y - ny * 26, x + nx * 26, y + ny * 26);
      }
    }

    this.bakeIntoGround(plaza);
    this.bakeIntoGround(paths);
    this.drawTrees();

    // Sky Buckets cable, strung high over the lagoon.
    const sky = EDGES.find((e) => e.mode === "sky")!;
    const sa = pt(sky.a), sb = pt(sky.b);
    const cable = this.add.graphics().setDepth(4000);
    cable.lineStyle(5, 0x2c3e50, 0.8).lineBetween(sa.x, sa.y - 170, sb.x, sb.y - 170);
    for (const q of [sa, sb]) cable.fillStyle(0x7f8c8d, 1).fillRect(q.x - 8, q.y - 170, 16, 170);

    // Coaster track loops and the Ferris wheel.
    for (const l of LOCS) {
      if (l.coaster) this.coasterTrack(l);
      if (l.wheel) this.ferrisWheel(l);
    }

    // Buildings, decor, landmarks, labels.
    for (const l of [...LOCS].sort((x, y) => x.i + x.j - (y.i + y.j))) {
      if (!this.sprite(l.id, l.i, l.j)) this.block(l);
      const top = iso(l.i, l.j, l.h);
      this.locLabels[l.id] = this.add.text(top.x, top.y - 16, l.name, {
        fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: "40px", color: "#ffffff",
        stroke: "#000000", strokeThickness: 8, align: "center",
      }).setOrigin(0.5, 1).setDepth(6000);
    }
    for (const [k, d] of DECOR.entries()) {
      const ij = { i: (d.u + d.v) / 2, j: (d.v - d.u) / 2 };
      const art = this.sprite("decor" + k, ij.i, ij.j);
      if (!art) this.block({ ...ij, w: d.w, d: d.d, h: d.h, color: d.color } as LocDef);
      const top = iso(ij.i, ij.j, d.h);
      if (d.icon && !art) this.add.text(top.x, top.y + 6, d.icon, { fontSize: "64px" }).setOrigin(0.5, 1).setDepth(ij.i + ij.j + 0.5);
      if (d.label) {
        this.add.text(top.x, top.y - 50, d.label, {
          fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: "30px", color: "#dddddd", stroke: "#000", strokeThickness: 6,
        }).setOrigin(0.5, 1).setDepth(5950);
      }
    }
    for (const [k, m] of LANDMARKS.entries()) {
      const ij = { i: (m.u + m.v) / 2, j: (m.v - m.u) / 2 };
      const art = this.sprite("landmark" + k, ij.i, ij.j);
      if (!art) this.block({ ...ij, w: 0.9, d: 0.9, h: m.h, color: m.color } as LocDef);
      const top = iso(ij.i, ij.j, m.h);
      if (!art) this.add.text(top.x, top.y + 10, m.icon, { fontSize: "110px" }).setOrigin(0.5, 1).setDepth(ij.i + ij.j + 0.5);
    }
    for (const id of [...RING_IDS, "hub", "lot"] as ZoneId[]) {
      const z = ZONES[id];
      const q = id === "hub" ? { u: 0, v: HUB_V + 3.5 } : id === "lot" ? { u: 0, v: LOT_V + 7 } : ringPos(z.angle! + (z.kind === "land" ? z.span! * 0.22 : 0), z.kind === "land" ? 1.2 : 1.12);
      const at = uv(q.u, q.v);
      const big = z.kind === "land" || z.kind === "lot";
      this.landLabels.push(this.add.text(at.x, at.y, big ? z.name.toUpperCase() : z.name, {
        fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: big ? "64px" : "48px", color: "#ffffff",
        stroke: "#00000099", strokeThickness: 10, fontStyle: big ? "bold" : "bold italic",
      }).setOrigin(0.5, 0.5).setDepth(5900).setAlpha(0.95));
    }
  }

  /** Ground colour for a point, or null outside the park. Zone borders are noisy, blends fade between lands. */
  groundAt(u: number, v: number): number | null {
    const noise = (x: number, y: number) => 0.5 * Math.sin(x * 1.7 + Math.sin(y * 1.3)) + 0.5 * Math.sin(y * 2.1 + Math.sin(x * 0.9));
    if (Math.abs(u) < 11 && v > DEPOT_V - 2 && v < GATE_V + 4) return ZONES.depot.ground;
    if (Math.abs(u) < 26 + noise(u * 0.2, v * 0.2) && v >= GATE_V + 4 && v < LOT_V + 13) return ZONES.lot.ground;
    const du = u - CENTER.u, dv = v - CENTER.v, r = Math.hypot(du, dv);
    const deg = (Math.atan2(dv, du) * 180) / Math.PI;
    const R = shapeR(deg), L = lagoonR(deg), n = noise(u * 0.12, v * 0.12);
    if (r < 3.2 + n * 0.6) return 0xe5d3a1; // the island
    if (r < L - 0.8) return Phaser.Display.Color.GetColor(40, 120 + Math.min(40, (L - r) * 4), 180 + Math.min(40, (L - r) * 3));
    if (r < L + 0.9) return 0xe5d3a1; // beach
    if (r > R * 2.0 + n * 3) return null;
    const zone = ZONES[zoneAtAngle(deg + n * 7)];
    const shade = (c: number, k: number) => {
      const o = Phaser.Display.Color.IntegerToColor(c);
      return Phaser.Display.Color.GetColor(Math.min(255, o.red * k), Math.min(255, o.green * k), Math.min(255, o.blue * k));
    };
    const k = 0.96 + 0.06 * noise(u * 0.9, v * 0.9);
    if (zone.kind === "land") return shade(zone.ground, k);
    // Blends fade from the previous land's colour to the next one's.
    const off = (((deg + n * 7 - zone.angle! + 540) % 360) - 180) / zone.span! + 0.5;
    const [pa, pb] = zone.parents!.map((x) => Phaser.Display.Color.IntegerToColor(ZONES[x].ground));
    const t = Phaser.Math.Clamp(off, 0, 1);
    const mixed = Phaser.Display.Color.GetColor(pa.red + (pb.red - pa.red) * t, pa.green + (pb.green - pa.green) * t, pa.blue + (pb.blue - pa.blue) * t);
    const zc = Phaser.Display.Color.IntegerToColor(zone.ground), mc = Phaser.Display.Color.IntegerToColor(mixed);
    return shade(Phaser.Display.Color.GetColor((mc.red + zc.red) / 2, (mc.green + zc.green) / 2, (mc.blue + zc.blue) / 2), k);
  }

  /** Paint the ground once, tile by tile, into a quarter-resolution texture. */
  drawGround() {
    const S = 0.25;
    const lo = uv(-95, -45), hi = uv(95, LOT_V + 22);
    const W = Math.ceil((hi.x - lo.x) * S), H = Math.ceil((hi.y - lo.y) * S);
    const gg = this.make.graphics({}, false);
    for (let i = Math.floor((-95 - 45) / 2); i <= Math.ceil((95 + LOT_V + 22) / 2); i++) {
      for (let j = Math.floor((-45 - 95) / 2); j <= Math.ceil((LOT_V + 22 + 95) / 2); j++) {
        const c = this.groundAt(i + 0.5 - (j + 0.5), i + 0.5 + j + 0.5);
        if (c === null) continue;
        const q = [iso(i, j), iso(i + 1, j), iso(i + 1, j + 1), iso(i, j + 1)].map((p2) => ({ x: (p2.x - lo.x) * S, y: (p2.y - lo.y) * S }));
        gg.fillStyle(c, 1).beginPath().moveTo(q[0].x, q[0].y);
        for (const p2 of q.slice(1)) gg.lineTo(p2.x, p2.y);
        gg.closePath().fillPath();
      }
    }
    const rt = this.add.renderTexture(lo.x, lo.y, W, H).setOrigin(0, 0).setScale(1 / S).setDepth(-100);
    rt.draw(gg);
    this.ground = { rt, lo, S };
    gg.destroy();
    this.paintSurfaces(lo, W, H, S);
  }

  /** Surface (texture + colour wash) for a ground point, or null to keep the painted colour. */
  surfaceAt(u: number, v: number): { surf: string; tint: number; a: number } | null {
    const noise = (x: number, y: number) => 0.5 * Math.sin(x * 1.7 + Math.sin(y * 1.3)) + 0.5 * Math.sin(y * 2.1 + Math.sin(x * 0.9));
    const has = (k: string) => this.textures.exists("gnd_" + k);
    const LAND: Partial<Record<string, [string, number, number]>> = {
      depot: ["brick", 0xc9ae86, 0.12], passport: ["stone", 0xe2c35a, 0.3], fossil: ["stone", 0x8fb85a, 0.45],
      atomic: ["pavers", 0x9d8fd0, 0.35], aero: ["pavers", 0xc6dde4, 0.35], mirrorball: ["pavers", 0xd58ad8, 0.4],
      lagoon: ["sand", 0xd8cc9c, 0.1],
      // blends with a surface of their own
      extinction: ["stone", 0x2f2826, 0.55], mall: ["concrete", 0xb08fc4, 0.12], foam: ["wood", 0xc4b9d8, 0.15], ozark: ["wood", 0xa9b98a, 0.08],
    };
    if (Math.abs(u) < 11 && v > DEPOT_V - 2 && v < GATE_V + 4) return has("brick") ? { surf: "brick", tint: 0xc9ae86, a: 0.12 } : null;
    if (v >= GATE_V + 4) return has("asphalt") ? { surf: "asphalt", tint: 0x3d3d42, a: 0.1 } : null;
    const du = u - CENTER.u, dv = v - CENTER.v, r = Math.hypot(du, dv);
    const deg = (Math.atan2(dv, du) * 180) / Math.PI, n = noise(u * 0.12, v * 0.12);
    if (r < lagoonR(deg) + 0.9 || r > shapeR(deg) * 2.0 + n * 3) return null;
    let zone = ZONES[zoneAtAngle(deg + n * 7)];
    if (zone.kind === "blend" && !(LAND[zone.id] && has(LAND[zone.id]![0]))) {
      // Blends without their own surface patch between their two lands' surfaces.
      const off = (((deg + n * 7 - zone.angle! + 540) % 360) - 180) / zone.span! + 0.5;
      zone = ZONES[off + noise(u * 0.8, v * 0.8) * 0.35 > 0.5 ? zone.parents![1] : zone.parents![0]];
    }
    const s2 = LAND[zone.id];
    return s2 && has(s2[0]) ? { surf: s2[0], tint: s2[1], a: s2[2] } : null;
  }

  /** Lay textured surfaces (brick street, flagstones, boardwalk...) over the painted ground. */
  paintSurfaces(lo: { x: number; y: number }, W: number, H: number, S: number) {
    const gm = this.cache.json.get("groundArt") as { textures: Record<string, unknown> } | undefined;
    if (!gm || !Object.keys(gm.textures).some((k) => this.textures.exists("gnd_" + k))) return;
    const cv = this.textures.createCanvas("groundSurf", W, H)!;
    const ctx = cv.getContext();
    const pats: Record<string, CanvasPattern> = {};
    for (const k of Object.keys(gm.textures)) {
      if (!this.textures.exists("gnd_" + k)) continue;
      const p = ctx.createPattern(this.textures.get("gnd_" + k).getSourceImage() as HTMLImageElement, "repeat")!;
      p.setTransform(new DOMMatrix().translate(-lo.x * S, -lo.y * S).scale(S));
      pats[k] = p;
    }
    // One path per (surface, wash) so overlapping cell edges never double up.
    const groups = new Map<string, { path: Path2D; surf: string; tint: number; a: number }>();
    for (let i = Math.floor((-95 - 45) / 2); i <= Math.ceil((95 + LOT_V + 22) / 2); i++) {
      for (let j = Math.floor((-45 - 95) / 2); j <= Math.ceil((LOT_V + 22 + 95) / 2); j++) {
        const sf = this.surfaceAt(i - j, i + j + 1);
        if (!sf) continue;
        const key = `${sf.surf}|${sf.tint}|${sf.a}`;
        let gr = groups.get(key);
        if (!gr) { gr = { path: new Path2D(), ...sf }; groups.set(key, gr); }
        const c = iso(i + 0.5, j + 0.5);
        const q = [iso(i - 0.02, j - 0.02), iso(i + 1.02, j - 0.02), iso(i + 1.02, j + 1.02), iso(i - 0.02, j + 1.02)];
        gr.path.moveTo((q[0].x - lo.x) * S, (q[0].y - lo.y) * S);
        for (const p2 of q.slice(1)) gr.path.lineTo((p2.x - lo.x) * S, (p2.y - lo.y) * S);
        gr.path.closePath();
        void c;
      }
    }
    for (const gr of groups.values()) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = pats[gr.surf];
      ctx.fill(gr.path);
      ctx.globalAlpha = gr.a;
      ctx.fillStyle = "#" + gr.tint.toString(16).padStart(6, "0");
      ctx.fill(gr.path);
    }
    cv.refresh();
    this.ground.rt.stamp("groundSurf", undefined, 0, 0, { originX: 0, originY: 0 });
    this.textures.remove("groundSurf");
  }

  /** Trees fill every gap that isn't a path, a building or water, plus a berm around the edge. */
  drawTrees() {
    const segs: [number, number, number, number][] = [];
    for (const e of EDGES) if (e.mode !== "sky") segs.push([NODES[e.a].i, NODES[e.a].j, NODES[e.b].i, NODES[e.b].j]);
    for (const [a2, b2] of SERVICE) segs.push([NODES[a2].i, NODES[a2].j, NODES[b2].i, NODES[b2].j]);
    for (const l of LOCS) { const d = this.doorPoint(l); segs.push([NODES[l.node].i, NODES[l.node].j, d.i, d.j]); }
    const segDist = (i: number, j: number, [x1, y1, x2, y2]: [number, number, number, number]) => {
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
      const t = Phaser.Math.Clamp(((i - x1) * dx + (j - y1) * dy) / L2, 0, 1);
      return Math.hypot(i - (x1 + dx * t), j - (y1 + dy * t));
    };
    const blocks = [...LOCS.map((l) => ({ i: l.i, j: l.j, r: Math.max(l.w, l.d) / 2 + (l.coaster ? 4.5 : 1.3) })),
      ...DECOR.map((d) => ({ i: (d.u + d.v) / 2, j: (d.v - d.u) / 2, r: Math.max(d.w, d.d) / 2 + 0.8 })),
      ...LANDMARKS.map((m) => ({ i: (m.u + m.v) / 2, j: (m.v - m.u) / 2, r: 1.2 }))];
    const hash = (n: number) => { const x = Math.sin(n * 91.7) * 43758.5453; return x - Math.floor(x); };
    const TW = 140, TH = 170; // tree texture size; trees are drawn with their base at (TW/2, TH-14)
    const styles = ["palm", "pine", "round0", "round1"];
    for (const st of styles) {
      if (this.textures.exists("tree_" + st)) continue;
      const tg = this.make.graphics({}, false);
      this.tree(tg, { x: TW / 2, y: TH - 14 }, st.startsWith("round") ? "round" : st, st === "round1" ? 0.9 : 0.2);
      tg.generateTexture("tree_" + st, TW, TH);
      tg.destroy();
    }
    const blit: Record<string, Phaser.GameObjects.Blitter> = {};
    for (const st of styles) blit[st] = this.add.blitter(0, 0, "tree_" + st).setDepth(-50);
    let n = 0;
    for (let u = -92; u <= 92; u += 2.4) {
      for (let v = -42; v <= LOT_V + 18; v += 2.4) {
        n++;
        const uu = u + (hash(n) - 0.5) * 2.2, vv = v + (hash(n + 0.5) - 0.5) * 2.2;
        const du = uu - CENTER.u, dv = vv - CENTER.v, r = Math.hypot(du, dv);
        const deg = (Math.atan2(dv, du) * 180) / Math.PI;
        const R = shapeR(deg);
        if (r < lagoonR(deg) + 2) continue;
        if (Math.abs(uu) < 13 && vv > DEPOT_V - 3 && vv < LOT_V + 14) continue;
        const berm = r > R * 1.95 && r < R * 2.35;
        if (r > R * 2.35) continue;
        if (!berm && hash(n + 0.25) < 0.45) continue; // keep the park airy
        const i = (uu + vv) / 2, j = (vv - uu) / 2;
        if (segs.some((sg) => segDist(i, j, sg) < 1.5)) continue;
        if (blocks.some((bk) => Math.hypot(i - bk.i, j - bk.j) < bk.r)) continue;
        const zone = r > R * 1.95 ? null : zoneAtAngle(deg);
        const style = zone && ["lagoon", "foam", "ozark", "y2k"].includes(zone) ? "palm"
          : zone && ["bonewars", "ozark", "extinction"].includes(zone) ? "pine" : "round";
        const q = iso(i, j);
        const key = style === "round" ? (hash(n + 0.75) > 0.5 ? "round1" : "round0") : style;
        const bob = blit[key].create(q.x - TW / 2, q.y - (TH - 14));
        this.cullables.push({ obj: bob, x0: q.x - TW / 2, y0: q.y - TH, x1: q.x + TW / 2, y1: q.y + 14 });
      }
    }
  }

  tree(g: Phaser.GameObjects.Graphics, p: { x: number; y: number }, style: string, k: number) {
    g.fillStyle(0x000000, 0.18).fillEllipse(p.x + 10, p.y, 70, 26);
    if (style === "palm") {
      g.lineStyle(9, 0x8b6b43, 1).lineBetween(p.x, p.y, p.x + 8, p.y - 95);
      for (let a = 0; a < 5; a++) {
        const t = (a / 5) * Math.PI * 2 + k;
        g.fillStyle(0x2e8b57, 1).fillEllipse(p.x + 8 + Math.cos(t) * 28, p.y - 95 + Math.sin(t) * 10, 56, 18);
      }
      return;
    }
    if (style === "pine") {
      g.fillStyle(0x5d4037, 1).fillRect(p.x - 5, p.y - 22, 10, 22);
      g.fillStyle(0x1e5631, 1).fillTriangle(p.x - 34, p.y - 20, p.x + 34, p.y - 20, p.x, p.y - 110);
      g.fillStyle(0x2d6a3e, 1).fillTriangle(p.x - 26, p.y - 55, p.x + 26, p.y - 55, p.x, p.y - 125);
      return;
    }
    const r = 34 + k * 16;
    g.fillStyle(0x5d4037, 1).fillRect(p.x - 5, p.y - 30, 10, 30);
    g.fillStyle(k > 0.5 ? 0x2e7d32 : 0x388e3c, 1).fillCircle(p.x, p.y - 30 - r * 0.7, r);
    g.fillStyle(0xffffff, 0.12).fillCircle(p.x - r * 0.3, p.y - 30 - r, r * 0.45);
  }

  /** A looping coaster track on supports, sprawling out behind the station. */
  coasterTrack(l: LocDef) {
    const out = { i: l.i - (CENTER.u + CENTER.v) / 2, j: l.j - (CENTER.v - CENTER.u) / 2 };
    const len = Math.hypot(out.i, out.j) || 1;
    const small = l.id === "raptor";
    const cx = l.i + (out.i / len) * (small ? 2.5 : 4), cy = l.j + (out.j / len) * (small ? 2.5 : 4);
    const rx = small ? 2.6 : 5, ry = small ? 1.8 : 3.2;
    const ang = Math.atan2(out.j, out.i);
    const g = this.add.graphics().setDepth(cx + cy + 1);
    const pts: { x: number; y: number; gx: number; gy: number }[] = [];
    for (let k = 0; k <= 64; k++) {
      const t = (k / 64) * Math.PI * 2;
      const a1 = rx * Math.cos(t) * (1 + 0.25 * Math.sin(3 * t)), b1 = ry * Math.sin(2 * t) * 0.9 + ry * 0.5 * Math.sin(t);
      const i = cx + a1 * Math.cos(ang) - b1 * Math.sin(ang), j = cy + a1 * Math.sin(ang) + b1 * Math.cos(ang);
      const z = (small ? 0.6 : 1) * (0.9 + 0.8 * Math.sin(2 * t + 1) + (k < 12 ? (k / 12) * 1.2 : 0));
      const top = iso(i, j, Math.max(0.3, z)), ground = iso(i, j);
      pts.push({ x: top.x, y: top.y, gx: ground.x, gy: ground.y });
    }
    const xs = pts.flatMap((q) => [q.x, q.gx]), ys = pts.flatMap((q) => [q.y, q.gy]);
    this.cullables.push({ obj: g, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    const c = l.wet ? 0xd6eaf8 : Phaser.Display.Color.IntegerToColor(l.color).lighten(25).color;
    pts.forEach((q, k) => { if (k % 4 === 0) g.lineStyle(5, 0x7f8c8d, 0.8).lineBetween(q.x, q.y, q.gx, q.gy); });
    g.lineStyle(14, 0x2c3e50, 0.6).beginPath().moveTo(pts[0].x, pts[0].y);
    for (const q of pts.slice(1)) g.lineTo(q.x, q.y);
    g.strokePath();
    g.lineStyle(8, c, 1).beginPath().moveTo(pts[0].x, pts[0].y);
    for (const q of pts.slice(1)) g.lineTo(q.x, q.y);
    g.strokePath();
  }

  ferrisWheel(l: LocDef) {
    const base = iso(l.i, l.j, l.h), c = iso(l.i, l.j, l.h + 1.9);
    const g = this.add.graphics().setDepth(l.i + l.j + 0.6);
    const r = 150;
    this.cullables.push({ obj: g, x0: c.x - r - 30, y0: c.y - r - 30, x1: c.x + r + 30, y1: base.y + 10 });
    g.lineStyle(10, 0x7f8c8d, 1).lineBetween(base.x - 60, base.y, c.x, c.y).lineBetween(base.x + 60, base.y, c.x, c.y);
    // The wheel turns (its own graphics, drawn around 0,0); gondolas hang level as it goes.
    const wg = this.add.graphics().setPosition(c.x, c.y).setDepth(l.i + l.j + 0.55);
    wg.lineStyle(8, 0xf39c12, 1).strokeCircle(0, 0, r);
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      wg.lineStyle(3, 0xf5cba7, 1).lineBetween(0, 0, Math.cos(t) * r, Math.sin(t) * r);
    }
    const cars = Array.from({ length: 12 }, (_, k) =>
      this.add.rectangle(0, 0, 28, 24, [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71][k % 4]).setOrigin(0.5, 0).setDepth(l.i + l.j + 0.65));
    this.wheels.push({ wg, cars, cx: c.x, cy: c.y, r });
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
    this.cullables.push({ obj: g, x0: iso(i0, j1).x - 20, y0: iso(i0, j0, l.h).y - 20, x1: iso(i1 + 0.4, j0).x + 20, y1: iso(i1 + 0.4, j1 + 0.3).y + 20 });
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

  floatText(text: string, color: string, big = false) {
    const s = this.sim, zoom = this.cameras.main.zoom;
    const c = iso(s.g.pos.i, s.g.pos.j);
    const t = this.add.text(c.x + (Math.random() - 0.5) * 40, c.y - 150, text, {
      fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: big ? "52px" : "44px", color,
      stroke: "#000000", strokeThickness: 8, fontStyle: "bold",
    }).setOrigin(0.5, 1).setDepth(9000).setScale(Math.max(0.5, ((big ? 16 : 14) * DPR) / (44 * zoom)));
    this.tweens.add({ targets: t, y: t.y - 160 / Math.max(zoom, 0.3) * 0.3, alpha: 0, duration: 1600, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
  }

  drainFx() {
    let ouch = false;
    for (const f of this.sim.fx.splice(0)) {
      if (f.type === "misery") { this.floatText(f.text, "#ff6b5b"); ouch = true; }
      else if (f.type === "caught") { caughtCallout(f.text); sfx.caught(); }
      else { this.floatText(f.text, "#ffd166", true); comboCallout(`COMBO! ${f.text}`); sfx.combo(); }
    }
    if (ouch) sfx.misery();
    for (const b of this.sim.banners.splice(0)) { toast(b, 4500); sfx.banner(); }
  }

  /** Stamp a static vector layer into the ground texture so it costs nothing per frame. */
  bakeIntoGround(g: Phaser.GameObjects.Graphics) {
    const { rt, lo, S } = this.ground;
    g.setScale(S);
    rt.draw(g, -lo.x * S, -lo.y * S);
    g.destroy();
  }

  /** A person: the rendered sprite sheet if we have it, else the gray-box pawn texture. */
  person(id: string, fallback: string): Phaser.GameObjects.Image {
    const m = this.cache.json.get("peopleArt") as { frameW: number; frameH: number; ax: number; ay: number } | undefined;
    if (m && this.textures.exists("ppl_" + id)) return this.add.image(0, 0, "ppl_" + id, 0).setOrigin(m.ax / m.frameW, m.ay / m.frameH);
    const tex = this.textures.get(fallback).getSourceImage() as { height: number };
    return this.add.image(0, 0, fallback).setOrigin(0.5, fallback.startsWith("p_") ? 102 / 110 : (tex.height - 4) / tex.height);
  }

  /** Sheet row for a direction of travel in tile space: 0 SE (+i), 1 NE (-j), 2 NW (-i), 3 SW (+j). */
  facing(di: number, dj: number) {
    return Math.abs(di) >= Math.abs(dj) ? (di > 0 ? 0 : 2) : (dj > 0 ? 3 : 1);
  }

  /** Move a person sprite, turning to face its direction and stepping through the walk cycle. */
  walk(img: Phaser.GameObjects.Image, x: number, y: number) {
    if (!img.texture.key.startsWith("ppl_")) { img.setPosition(x, y); return; }
    const last = (this.sprites._last ??= new Map());
    const prev = last.get(img) ?? { x, y, dir: 0, moving: 0 };
    const dx = x - prev.x, dy = y - prev.y;
    let { dir, moving } = prev;
    if (Math.hypot(dx, dy) > 0.5) {
      // screen delta back to tile delta: i = (x/64 + y/32)/2, j = (y/32 - x/64)/2
      dir = this.facing(dx / 64 + dy / 32, dy / 32 - dx / 64);
      moving = this.time.now;
    }
    const walking = this.time.now - moving < 180;
    const frame = walking ? Math.floor(this.time.now / 140) % 4 : 0;
    img.setPosition(x, y).setFrame(dir * 4 + frame);
    last.set(img, { x, y, dir, moving });
  }

  /** A ground circle of r tiles as a 24-point polygon (cheaper than strokeEllipse every frame). */
  ring(x: number, y: number, r: number) {
    const rx = r * HALF * Math.SQRT2, ry = (r * HALF * Math.SQRT2) / 2;
    return Array.from({ length: 24 }, (_, k) => {
      const t = (k / 24) * Math.PI * 2;
      return new Phaser.Math.Vector2(x + Math.cos(t) * rx, y + Math.sin(t) * ry);
    });
  }

  /** Is a world-space box near the camera's view? */
  inView(x0: number, y0: number, x1 = x0, y1 = y0, pad = 400) {
    const v = this.cameras.main.worldView;
    return x1 >= v.x - pad && x0 <= v.right + pad && y1 >= v.y - pad && y0 <= v.bottom + pad;
  }

  /** Pre-render the little background people once, one texture per shirt colour. */
  bakePawns() {
    const bake = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({}, false);
      draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };
    bake("p_deb", 50, 110, (g) => this.pawn(g, 25, 102, 0xe84393));
    bake("p_gary", 50, 110, (g) => this.pawn(g, 25, 102, 0xf39c12));
    bake("p_me", 50, 110, (g) => this.pawn(g, 25, 102, 0x2ecc71, true));
    bake("p_brad", 50, 110, (g) => this.pawn(g, 25, 102, 0xdfe6e9, false, 1, true));
    bake("car0", 66, 40, (g) => { g.fillStyle(0x922b21, 1).fillRoundedRect(3, 3, 60, 34, 8); g.lineStyle(3, 0x000000, 0.6).strokeRoundedRect(3, 3, 60, 34, 8); });
    bake("car1", 66, 40, (g) => { g.fillStyle(0x1e8449, 1).fillRoundedRect(3, 3, 60, 34, 8); g.lineStyle(3, 0x000000, 0.6).strokeRoundedRect(3, 3, 60, 34, 8); });
    for (const [k, c] of [["gon0", 0xf1c40f], ["gon1", 0xe67e22]] as [string, number][]) {
      bake(k, 36, 48, (g) => { g.lineStyle(3, 0x2c3e50, 0.8).lineBetween(18, 0, 18, 20); g.fillStyle(c, 1).fillRoundedRect(2, 20, 32, 26, 6); });
    }
    SHIRTS.forEach((color, k) => {
      if (!this.textures.exists("pawn" + k)) {
        const g = this.make.graphics({}, false);
        this.pawn(g, 20, 66, color, false, 0.6);
        g.generateTexture("pawn" + k, 40, 70);
        g.destroy();
      }
      if (!this.textures.exists("qpawn" + k)) {
        const g = this.make.graphics({}, false);
        g.fillStyle(color, 1).fillRoundedRect(3, 14, 14, 24, 5);
        g.fillStyle(0xf1c27d, 1).fillCircle(10, 8, 7);
        g.generateTexture("qpawn" + k, 20, 40);
        g.destroy();
      }
    });
  }

  /** Background guests wander between junctions (visual only). */
  tickCrowd(dtGame: number) {
    const ids = Object.keys(NODES).filter((id) => !/^t\d+$/.test(id) && id !== "lot");
    for (const c of this.crowd) {
      if (!c.route.length) {
        const r = shortest(c.prev, ids[Math.floor(Math.random() * ids.length)], new Set(), false, new Set(["train", "sky"]));
        c.route = r ? r.path.slice(1) : [];
      }
      let left = 1.2 * dtGame;
      while (left > 0 && c.route.length) {
        const n = NODES[c.route[0]];
        const d = Math.hypot(n.i - c.pos.i, n.j - c.pos.j);
        if (d <= left) { c.pos = { i: n.i, j: n.j }; c.prev = c.route.shift()!; left -= d; }
        else { c.pos = { i: c.pos.i + ((n.i - c.pos.i) / d) * left, j: c.pos.j + ((n.j - c.pos.j) / d) * left }; left = 0; }
      }
    }
  }

  checkTips() {
    const s = this.sim;
    for (const t of TIPS) {
      if (this.seenTips.has(t.id) || !t.when(s)) continue;
      this.seenTips.add(t.id);
      store.set("park.tips", [...this.seenTips].join(","));
      this.tipQueue.push(t.text);
    }
    if (this.tipQueue.length && this.time.now > this.tipAt) {
      toast(this.tipQueue.shift()!, 6000);
      this.tipAt = this.time.now + 6500;
    }
  }

  updateSky() {
    const s = this.sim;
    const night = Math.min(1, Math.max(0, (s.time - 18 * 60) / 120));
    const cls = (s.raining() ? "rain " : "") + (s.heat() ? "heat" : "");
    const key = `${night.toFixed(2)}|${cls}`;
    if (key === this.lastSky) return;
    this.lastSky = key;
    const el = $("sky");
    el.className = cls;
    // Night happens inside the game now: a multiply tint over the park, with lights glowing through it.
    this.night.setAlpha(night * 0.62);
    for (const gl of this.glows) gl.setAlpha(night * gl.getData("a"));
  }

  /** The lagoon: twinkling sun glints on the water and swan boats paddling slow laps. */
  buildLagoon() {
    if (!this.textures.exists("glint")) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0xffffff, 1).fillEllipse(16, 6, 32, 8);
      g.generateTexture("glint", 32, 12);
      g.destroy();
    }
    if (!this.textures.exists("swan")) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0x000000, 0.2).fillEllipse(34, 44, 60, 16);
      g.fillStyle(0xf4f6f7, 1).fillEllipse(34, 34, 56, 24);
      g.fillStyle(0xe8ecee, 1).fillRoundedRect(14, 22, 40, 14, 6);
      g.lineStyle(8, 0xf4f6f7, 1).beginPath().arc(50, 18, 9, Math.PI * 0.5, Math.PI * 1.6).strokePath();
      g.fillStyle(0xe8836f, 1).fillTriangle(42, 9, 36, 12, 42, 14);
      g.fillStyle(0xd35400, 1).fillRect(28, 14, 4, 10);
      g.generateTexture("swan", 70, 52);
      g.destroy();
    }
    const rnd = (k: number) => { const x = Math.sin(k * 77.7) * 43758.5453; return x - Math.floor(x); };
    for (let k = 0; k < 70; k++) {
      const deg = rnd(k) * 360, r = (0.15 + 0.8 * Math.sqrt(rnd(k + 0.5))) * (lagoonR(deg) - 1.2);
      const u = CENTER.u + r * Math.cos((deg * Math.PI) / 180), v = CENTER.v + r * Math.sin((deg * Math.PI) / 180);
      const p = uv(u, v);
      const gl = this.add.image(p.x, p.y, "glint").setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(-60).setScale(1 + rnd(k + 0.2));
      this.tweens.add({ targets: gl, alpha: { from: 0, to: 0.55 }, duration: 900 + rnd(k + 0.3) * 900, yoyo: true, repeat: -1, delay: rnd(k + 0.4) * 3000, hold: 200 });
    }
    // Swan boats loop the lagoon at different radii and speeds.
    this.swans = [0, 1, 2, 3].map((k) => ({
      img: this.add.image(0, 0, "swan").setDepth(-55).setOrigin(0.5, 0.8),
      f: 0.45 + k * 0.12, phase: k * 1.7, speed: 0.06 + k * 0.015,
    }));
  }

  /** Lights for the night: warm lamps on the paths and doors, neon where the land calls for it. */
  buildNight() {
    if (!this.textures.exists("glow")) {
      const c = this.textures.createCanvas("glow", 128, 128)!;
      const ctx = c.getContext();
      const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      c.refresh();
    }
    const lo = uv(-95, -45), hi = uv(95, LOT_V + 22);
    this.night = this.add.rectangle(lo.x, lo.y, hi.x - lo.x, hi.y - lo.y, 0x1b2456).setOrigin(0, 0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(5500).setAlpha(0);
    this.glows = [];
    const NEON: Partial<Record<string, number[]>> = {
      mirrorball: [0xff4fd8, 0x5ff2ff], y2k: [0xd7a8ff, 0x8fe8ff], mall: [0xff5fb0, 0x5fffe8], aero: [0x8fd8ff],
      extinction: [0xff7a1a], foam: [0xc9a8ff], expo: [0xffd27a],
    };
    const glow = (i: number, j: number, color: number, size: number, a: number) => {
      const p = iso(i, j);
      const g = this.add.image(p.x, p.y, "glow").setTint(color).setBlendMode(Phaser.BlendModes.ADD)
        .setScale(size, size / 2).setDepth(5600).setAlpha(0).setData("a", a);
      this.glows.push(g);
      this.cullables.push({ obj: g, x0: p.x - 64 * size, y0: p.y - 32 * size, x1: p.x + 64 * size, y1: p.y + 32 * size });
    };
    for (const n of Object.values(NODES)) {
      if (/^t\d+$/.test(n.id) || n.id === "island") continue;
      glow(n.i, n.j, 0xffd9a0, 4.2, 0.55);
    }
    for (const l of LOCS) {
      const d = this.doorPoint(l), cols = NEON[l.zone];
      const col = cols ? cols[(l.id.length) % cols.length] : 0xffc878;
      glow(d.i, d.j, col, cols ? 5.5 : 3.6, cols ? 0.85 : 0.6);
    }
    for (const m of LANDMARKS) {
      const i = (m.u + m.v) / 2, j = (m.v - m.u) / 2, cols = NEON[m.zone];
      glow(i, j, cols ? cols[0] : 0xfff0c0, 6, 0.7);
    }
  }

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

    // The Prairie Line (cosmetic train) and the Sky Buckets gondolas.
    const track = Object.values(NODES).filter((n) => /^t\d+$/.test(n.id)).sort((x, y) => +x.id.slice(1) - +y.id.slice(1));
    for (let c = 0; c < 4; c++) {
      const f = (((this.trainPhase - c * 0.012) % 1) + 1) % 1 * track.length;
      const k0 = Math.floor(f), k1 = (k0 + 1) % track.length, t = f - k0;
      const q = iso(track[k0].i + (track[k1].i - track[k0].i) * t, track[k0].j + (track[k1].j - track[k0].j) * t);
      this.sprites.cars[c].setPosition(q.x, q.y - 3);
    }
    const skyE = EDGES.find((e) => e.mode === "sky")!;
    const s0 = iso(NODES[skyE.a].i, NODES[skyE.a].j), s1 = iso(NODES[skyE.b].i, NODES[skyE.b].j);
    for (let c = 0; c < 6; c++) {
      const t = (this.skyPhase + c / 6) % 1, back = t > 0.5, tt = back ? 1 - (t - 0.5) * 2 : t * 2;
      const x = s0.x + (s1.x - s0.x) * tt, y = s0.y + (s1.y - s0.y) * tt - 170 + (back ? -14 : 14);
      this.sprites.gondolas[c].setPosition(x, y - 20).setTexture(back ? "gon1" : "gon0");
    }

    // Background crowd (pre-baked pawn images), scaled with how busy the park is.
    const h = s.time / 60;
    const busy = (0.6 + 0.6 * Math.exp(-((h - 15) ** 2) / 8)) / 1.2;
    const shown = Math.round(this.crowd.length * busy);
    this.crowd.forEach((c, n) => {
      const vis = n < shown;
      c.img.setVisible(vis);
      if (vis) { const p = iso(c.pos.i, c.pos.j); this.walk(c.img, p.x + ((n * 37) % 30) - 15, p.y + ((n * 53) % 20) - 10); }
    });
    // Visible lines at open rides: show as many queued people as the wait suggests.
    if (this.time.now > this.linesAt) {
      this.linesAt = this.time.now + 500;
      for (const [id, imgs] of Object.entries(this.lineImgs)) {
        const n = s.isClosed(id) ? 0 : Math.min(imgs.length, Math.round(s.currentWait(id) / 7));
        imgs.forEach((im, q) => im.setVisible(q < n));
      }
    }
    // Brad, and his sight ring (red once he's suspicious).
    const bp = iso(s.brad.pos.i, s.brad.pos.j);
    const alarmed = s.suspicion >= 50;
    g.lineStyle(alarmed ? 6 : 3, alarmed ? 0xff3b30 : 0xffffff, alarmed ? 0.55 : 0.18)
      .strokePoints(this.ring(bp.x, bp.y, 6), true);
    this.walk(this.sprites.brad, bp.x, bp.y);
    k = this.icon(k, alarmed ? "👔❗" : "👔", bp.x, bp.y - 104, 44);

    // Earshot ring around you.
    const wp = iso(s.w.pos.i, s.w.pos.j);
    if (!s.has("radio")) {
      g.lineStyle(4, 0xffffff, 0.25).strokePoints(this.ring(wp.x, wp.y, 9), true);
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
      this.walk(this.sprites.deb.setVisible(true), c.x - 16, c.y - 6);
      this.walk(this.sprites.gary.setVisible(true), c.x + 16, c.y + 6);
      k = this.icon(k, [s.mood(), ...s.statuses()].join(""), c.x, c.y - 104, 48);
      if (ga.t === "queue") {
        const pct = 1 - ga.left / ga.total;
        g.fillStyle(0x000000, 0.6).fillRect(c.x - 50, c.y - 172, 100, 12);
        g.fillStyle(pct > 0.6 ? 0xff6b5b : 0x7ec84a, 1).fillRect(c.x - 50, c.y - 172, 100 * pct, 12);
      }
      const show = s.thoughtUntil > s.time && !!s.thought;
      this.bubble.setVisible(show);
      if (show) {
        this.bubble.setText(s.thought).setPosition(c.x, c.y - 190)
          .setScale(Math.max(0.5, (13 * DPR) / (40 * zoom)));
      }
    } else {
      this.bubble.setVisible(false);
      this.sprites.deb.setVisible(false);
      this.sprites.gary.setVisible(false);
    }
    // You: green vest, cap.
    this.walk(this.sprites.me, wp.x, wp.y);
    if (s.w.task) {
      const pct = 1 - s.w.task.left / s.w.task.total;
      g.fillStyle(0x000000, 0.6).fillRect(wp.x - 40, wp.y - 120, 80, 12);
      g.fillStyle(0xffd166, 1).fillRect(wp.x - 40, wp.y - 120, 80 * pct, 12);
    }
    for (let n = k; n < this.icons.length; n++) this.icons[n].setVisible(false);

    // Labels hold a constant on-screen size; hide building names when zoomed far out.
    const tileCss = (zoom * HALF * 2) / DPR;
    const ls = (12 * DPR) / (40 * zoom);
    for (const t of Object.values(this.locLabels)) {
      const vis = tileCss >= 20 && this.inView(t.x, t.y);
      if (t.visible !== vis) t.setVisible(vis);
      if (vis && t.scaleX !== ls) t.setScale(ls);
    }
    for (const t of this.landLabels) t.setScale(Math.max(ls * 1.2, 1)).setAlpha(tileCss >= 20 ? 0.55 : 0.95);
  }

  pawn(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, worker = false, k = 1, tie = false) {
    g.fillStyle(0x000000, 0.3).fillEllipse(x, y, 40 * k, 18 * k);
    g.fillStyle(color, 1).fillRoundedRect(x - 13 * k, y - 70 * k, 26 * k, 58 * k, 9 * k);
    g.fillStyle(0xf1c27d, 1).fillCircle(x, y - 82 * k, 14 * k);
    if (k >= 1) g.lineStyle(3, 0x000000, 0.7).strokeRoundedRect(x - 13, y - 70, 26, 58, 9).strokeCircle(x, y - 82, 14);
    if (worker) g.fillStyle(0x1e5631, 1).fillRect(x - 15, y - 98, 30, 9);
    if (tie) g.fillStyle(0xc0392b, 1).fillTriangle(x - 4, y - 66, x + 4, y - 66, x, y - 36);
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
      const color = s.isClosed(l.id) ? "#ffb3a7" : st.def.kind === "ride" ? "#ffffff" : "#fff3c4";
      if (t.style.color !== color) t.setColor(color);
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
      if (/^t\d+$/.test(n.id)) continue;
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
    sfx.tap();
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
      html += `<button class="sab ${v.def.signature ? "sig" : ""}" data-act="${v.def.id}" ${v.why ? "disabled" : ""}>
        <b>${v.def.signature ? "★ " : ""}${esc(v.def.name)}</b><small>${esc(v.def.blurb)}</small>
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
      const land = ZONES[l.zone];
      const bits: string[] = [];
      if (s.isClosed(l.id)) bits.push(`<span class="warn">Closed until ${fmtTime(st.closedUntil)} (${st.closedBy === "you" ? "your doing" : "genuinely broken"})</span>`);
      else bits.push("Open");
      if (l.kind === "ride") bits.push(`Line: ${s.currentWait(l.id)} min${s.isSlow(l.id) ? " (slowed)" : ""}`);
      if (l.vegan) bits.push("Vegan menu");
      if (l.shows) bits.push(`${l.showName}: ${l.shows.map(fmtTime).join(", ")}${st.showCancelled ? " — next one CANCELLED" : ""}`);
      if (st.vegSwap) bits.push("Vegan patties: swapped 😈");
      if (st.readerUntil > s.time) bits.push(`Cash only until ${fmtTime(st.readerUntil)}`);
      html += `<h2>${esc(l.name)}</h2>${l.sub ? `<div class="status sub">${esc(l.sub)}</div>` : ""}<div class="status">${land.name} · ${bits.join(" · ")}</div>`;
      const notes: string[] = [];
      if (s.guestsAtLoc(l.id)) notes.push(`<span class="here">The Hendersons are right here.</span>`);
      if (s.isWitnessed(sel)) notes.push(`<span class="warn">They'd see you do it (+50% suspicion).</span>`);
      if (s.hasAlibi(l.zone)) notes.push(`<span class="ok">You have an alibi in ${land.name} (−40%).</span>`);
      if (s.duty?.loc === l.id) notes.push(`<span class="here">📋 Your duty is here.</span>`);
      if (s.bradSees(sel)) notes.push(`<span class="warn">👔 Brad can see this spot (+20 suspicion).</span>`);
      if (l.kind === "ride" && s.heat()) notes.push(`<span class="warn">☀️ Heat advisory: this line is cooking them.</span>`);
      if (s.raining() && s.isClosed(l.id) && s.loc(l.id).closedBy === "park") notes.push(`<span class="ok">🌧 Closed for lightning. Not your fault!</span>`);
      if (notes.length) html += `<div class="status">${notes.join("<br>")}</div>`;
      if (!s.workerAt(l.node)) html += `<button class="walk" data-walk="1">🚶 Walk here (${Math.ceil(s.walkMinutes(l.node))} min)</button>`;
      else html += `<div class="status ok">You're here.</div>`;
      const views = s.actionsFor(sel);
      html += views.length ? this.actionButtons(views) : `<div class="status">Nothing to break here.</div>`;
    } else if (sel.kind === "node") {
      const n = NODES[sel.id];
      const land = ZONES[n.zone];
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
        <details><summary><b>Rumored combos</b> (chain set-ups for bonus misery)</summary><ul class="known">${COMBOS.map((c) =>
          `<li><b>${c.name}</b> ×${c.mult} — ${c.hint}</li>`).join("")}</ul><p><i>Every land also has one ★ signature move. Go find them.</i></p></details>
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
        unlock();
        sfx.done();
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
      <div class="grade"><b>${r.grade}</b><span>${esc(r.title)}</span></div>
      <div class="scoreline">${r.score} misery</div>
      <div>${r.misery} raw · ${mult} · ${r.done}/${r.total} of their plans happened · duties ${r.duties}</div>
      ${r.combos.length ? `<p><b>Combos:</b> ${r.combos.map((c) => `<span class="tagline">${esc(c)}</span>`).join(" ")}</p>` : ""}
      ${r.breakdown.length ? `<div class="breakdown">${r.breakdown.map((b) =>
        `<div><span>${esc(b.label)}</span><i><b style="width:${Math.round((b.value / r.breakdown[0].value) * 100)}%"></b></i><em>${b.value}</em></div>`).join("")}</div>` : ""}
      <p><b>Their review:</b> <span class="stars">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</span></p>
      ${r.lines.map((l) => `<blockquote>${esc(l)}</blockquote>`).join("")}
      <p class="memo">${esc(r.memo)}</p>
      <button class="big" id="again">Another day</button>`;
    $("results").classList.remove("hidden");
    if (r.grade === "F" || r.grade === "D") sfx.sad(); else sfx.combo();
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
      const dtGame = (dtMs / 1000) * this.speed * GAME_MIN_PER_SEC;
      this.tickCrowd(dtGame);
      if (s.trainDownUntil <= s.time) this.trainPhase = (this.trainPhase + dtGame / 30) % 1;
      if (s.skyDownUntil <= s.time) this.skyPhase = (this.skyPhase + dtGame / 24) % 1;
      this.checkTips();
      if (s.pauses.length) {
        const msg = s.pauses.splice(0).join(" · ");
        if (msg.includes("duty")) sfx.radio(); else sfx.banner();
        if (this.autoPause && this.speed > 0) this.setSpeed(0);
        toast(`⏸ ${msg}`, 3500);
      }
    }
    if (this.running && s.ended) {
      this.running = false;
      window.setTimeout(() => this.showResults(), 1200);
    }
    if (this.time.now > this.cullAt) {
      this.cullAt = this.time.now + 120;
      for (const c of this.cullables) c.obj.setVisible(this.inView(c.x0, c.y0, c.x1, c.y1));
    }
    this.drainFx();
    this.updateSky();
    if (this.camFollow) {
      const cam = this.cameras.main, p = iso(s.w.pos.i, s.w.pos.j);
      const k = Math.min(1, dtMs / 250);
      cam.centerOn(cam.midPoint.x + (p.x - cam.midPoint.x) * k, cam.midPoint.y + (p.y - cam.midPoint.y) * k);
    }
    // Rides in motion (they stop when the ride is closed).
    for (const wh of this.wheels) {
      const spin = this.sim.isClosed("wheel") ? 0 : dtMs / 1000 * 0.12;
      wh.wg.rotation += spin;
      wh.cars.forEach((car, k) => {
        const t = wh.wg.rotation + (k / 12) * Math.PI * 2;
        car.setPosition(wh.cx + Math.cos(t) * wh.r, wh.cy + Math.sin(t) * wh.r);
      });
    }
    for (const d of this.drops) {
      const id = Math.abs(d.i - LOC.glitter.i) < 0.01 ? "glitter" : "meteor";
      if (!this.sim.isClosed(id)) d.t = (d.t + dtMs / 1000) % 10;
      // climb slowly (0-6s), hang (6-7.5s), DROP (7.5-8s), settle (8-10s)
      const z = d.t < 6 ? 0.4 + (d.top - 0.4) * (d.t / 6) : d.t < 7.5 ? d.top : d.t < 8 ? d.top - (d.top - 0.4) * ((d.t - 7.5) / 0.5) ** 2 : 0.4;
      const p = iso(d.i, d.j, z);
      d.img.setPosition(p.x, p.y);
    }
    {
      const lo2 = uv(-95, -45), hi2 = uv(95, LOT_V + 22);
      for (const c of this.clouds) {
        c.x += dtMs * 0.06;
        c.y += dtMs * 0.012;
        if (c.x > hi2.x + 1200) { c.x = lo2.x - 1200; }
        if (c.y > hi2.y + 600) { c.y = lo2.y - 600; }
      }
    }
    for (const sw of this.swans) {
      sw.phase += (dtMs / 1000) * sw.speed;
      const deg = (sw.phase * 180) / Math.PI;
      const r = lagoonR(deg) * sw.f + 1;
      const p = uv(CENTER.u + r * Math.cos(sw.phase), CENTER.v + r * Math.sin(sw.phase));
      sw.img.setPosition(p.x, p.y + Math.sin(this.time.now / 400 + sw.f * 9) * 3).setFlipX(Math.sin(sw.phase) > 0); // texture faces right; moving left when sin > 0
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
    render: { antialias: true, powerPreference: "high-performance" },
    scene: Park,
  });
  window.addEventListener("resize", () => game.scale.resize(size().w, size().h));
  (window as unknown as { park: Phaser.Game }).park = game;
}
const bootSoon = () => requestAnimationFrame(() => requestAnimationFrame(boot));
if (document.readyState === "complete") bootSoon();
else window.addEventListener("load", bootSoon);
