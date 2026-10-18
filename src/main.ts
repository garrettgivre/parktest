import Phaser from "phaser";

// Art spike: one corner of the park, assembled from Blender-rendered sprites.
// Sprites are anchored at their footprint centre; see art/render_sprites.py.

type SpriteInfo = { w: number; h: number; ax: number; ay: number };
type Manifest = { tileW: number; sprites: Record<string, SpriteInfo> };

const LOT = 10; // ground is LOT x LOT tiles

// Game tile coords (i, j) of each prop's footprint centre.
const LAYOUT: [string, number, number][] = [
  ["ticket_booth", 2.5, 1.4],
  ["fence", 0.5, 2.5], ["fence", 1.5, 2.5], ["fence", 2.5, 2.5], ["fence", 3.5, 2.5],
  ["turnstile", 4.5, 2.5], ["turnstile", 5.5, 2.5],
  ["fence", 6.5, 2.5], ["fence", 7.5, 2.5], ["fence", 8.5, 2.5], ["fence", 9.5, 2.5],
  ["lamp_post", 3.4, 4.2],
  ["lamp_post", 7.8, 3.4],
  ["bench", 7.4, 5.2],
  ["trash_can", 8.7, 4.3],
  ["food_cart", 3.0, 6.6],
  ["hay_bale", 7.2, 7.8],
  ["guest", 5.0, 1.6],
];

const $ = (id: string) => document.getElementById(id)!;

class Park extends Phaser.Scene {
  manifest!: Manifest;
  half = 64;
  clock = 10 * 60; // minutes since midnight
  speed = 1;
  misery = 10;
  patience = 90;
  suspicion = 5;
  scannerBroken = false;
  bubble?: Phaser.GameObjects.Container;
  guest?: Phaser.GameObjects.Image;

  preload() {
    this.load.json("manifest", "sprites/manifest.json");
    this.load.once("filecomplete-json-manifest", () => {
      const m = this.cache.json.get("manifest") as Manifest;
      for (const name of Object.keys(m.sprites)) this.load.image(name, `sprites/${name}.png`);
    });
  }

  iso(i: number, j: number) {
    return { x: (i - j) * this.half, y: (i + j) * (this.half / 2) };
  }

  place(name: string, i: number, j: number, depth?: number) {
    const s = this.manifest.sprites[name];
    const p = this.iso(i, j);
    return this.add
      .image(p.x, p.y, name)
      .setOrigin(s.ax / s.w, s.ay / s.h)
      .setDepth(depth ?? p.y);
  }

  create() {
    this.manifest = this.cache.json.get("manifest");
    this.half = this.manifest.tileW / 2;
    this.cameras.main.setBackgroundColor("#2a4a2a");

    this.place("ground", LOT / 2, LOT / 2, -1e6);
    for (const [name, i, j] of LAYOUT) {
      const img = this.place(name, i, j);
      if (name === "guest") this.guest = img;
      if (name === "turnstile") {
        img.setInteractive({ pixelPerfect: true, useHandCursor: true });
        img.on("pointerup", (p: Phaser.Input.Pointer) => {
          if (p.getDistance() < 10) this.breakScanner();
        });
      }
    }
    this.say("Ooh, Fright Fest!");

    // Drag to pan, fit-to-screen zoom.
    const cam = this.cameras.main;
    const top = this.iso(0, 0), bottom = this.iso(LOT, LOT);
    cam.setBounds(this.iso(0, LOT).x - 200, top.y - 400, LOT * this.half * 2 + 400, bottom.y - top.y + 600);
    this.fit();
    this.scale.on("resize", () => this.fit());
    cam.centerOn(0, this.iso(LOT / 2, LOT / 2).y - 140);
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });

    document.querySelectorAll<HTMLButtonElement>(".speed button").forEach((b) =>
      b.addEventListener("click", () => {
        this.speed = Number(b.dataset.speed);
        document.querySelectorAll(".speed button").forEach((o) => o.classList.toggle("on", o === b));
      }),
    );
    toast("Tap a turnstile to “maintain” it.");
  }

  fit() {
    const { width, height } = this.scale;
    const lotW = LOT * this.half * 2, lotH = LOT * this.half;
    this.cameras.main.setZoom(Math.min(width / lotW, height / lotH) * 1.05);
  }

  say(line: string) {
    this.bubble?.destroy();
    if (!this.guest) return;
    const t = this.add.text(0, 0, line, {
      fontFamily: "Trebuchet MS, Verdana, sans-serif", fontSize: "20px", color: "#222",
      align: "center", wordWrap: { width: 220 },
    }).setOrigin(0.5);
    const w = t.width + 24, h = t.height + 16;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.95).lineStyle(3, 0x333333, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12).strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    g.fillCircle(-w / 4, h / 2 + 10, 6).strokeCircle(-w / 4, h / 2 + 10, 6);
    this.bubble = this.add.container(this.guest.x + 40, this.guest.y - 260, [g, t]).setDepth(1e6);
  }

  breakScanner() {
    if (this.scannerBroken) {
      toast("It's already broken. Suspicion +10 for hovering.");
      this.suspicion = Math.min(100, this.suspicion + 10);
    } else {
      this.scannerBroken = true;
      this.misery += 25;
      this.patience -= 20;
      this.suspicion += 15;
      toast("Scanner “malfunctioning.” Staff instructed to mime scanning.");
      this.say("Did it... beep? Is that a yes?");
    }
    this.updateMeters();
  }

  updateMeters() {
    const set = (id: string, v: number) => $(id).style.setProperty("--v", `${Math.max(0, Math.min(100, v))}%`);
    set("m-misery", this.misery);
    set("m-patience", this.patience);
    set("m-suspicion", this.suspicion);
  }

  update(_t: number, dt: number) {
    this.clock += (dt / 1000) * this.speed * 2; // 2 game-minutes per second at 1x
    const h = Math.floor(this.clock / 60) % 24, m = Math.floor(this.clock % 60);
    $("time").textContent = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2800);
}

// Render at device resolution so sprites stay crisp on phone screens. Boot a
// frame after load so the viewport has settled (a mid-load resize can leave
// WebGL with an unusable framebuffer).
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
}
window.addEventListener("load", () => requestAnimationFrame(() => requestAnimationFrame(boot)));
