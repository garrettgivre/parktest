// Runs art/build_park.py in Blender. Override the path with BLENDER=...
// Extra args are asset ids to re-render only those: `npm run art -- emporium bbq`.
import { spawnSync } from "node:child_process";

const blender = process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe";
const args = ["--background", "--factory-startup", "--python", "art/build_park.py", "--", ...process.argv.slice(2)];
const r = spawnSync(blender, args, { stdio: "inherit" });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
