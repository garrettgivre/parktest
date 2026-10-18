// Runs art/render_sprites.py in Blender. Override the path with BLENDER=...
// Extra args are prop names to re-render only those, e.g. `npm run sprites -- bench`.
import { spawnSync } from "node:child_process";

const blender = process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe";
const args = ["--background", "--factory-startup", "--python", "art/render_sprites.py", "--", "public/sprites", ...process.argv.slice(2)];
const r = spawnSync(blender, args, { stdio: "inherit" });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
