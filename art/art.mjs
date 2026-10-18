// Runs art/build_park.py in Blender. Override the path with BLENDER=...
// Extra args are asset ids to re-render only those: `npm run art -- emporium bbq`.
import { spawnSync } from "node:child_process";

const blender = process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe";
// `--people` renders the character sprite sheets instead of buildings.
// `--ground` bakes the isometric ground tiles from art/textures.
const mode = process.argv[2] === "--people" ? "people" : process.argv[2] === "--ground" ? "ground" : "park";
const rest = process.argv.slice(mode === "park" ? 2 : 3);
const script = { people: "art/build_people.py", ground: "art/bake_ground.py", park: "art/build_park.py" }[mode];
const args = ["--background", "--factory-startup", "--python", script, "--", ...rest];
const r = spawnSync(blender, args, { stdio: "inherit" });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
