// Runs art/build_park.py in Blender. Override the path with BLENDER=...
// Extra args are asset ids to re-render only those: `npm run art -- emporium bbq`.
import { spawnSync } from "node:child_process";

const blender = process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe";
// `--people` renders the character sprite sheets instead of buildings.
const people = process.argv[2] === "--people";
const rest = process.argv.slice(people ? 3 : 2);
const args = ["--background", "--factory-startup", "--python", people ? "art/build_people.py" : "art/build_park.py", "--", ...rest];
const r = spawnSync(blender, args, { stdio: "inherit" });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
