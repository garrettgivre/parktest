# Park Test

A goofy landscape mobile game about secretly ruining a theme-park visit. See [DESIGN.md](DESIGN.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN, for testing on a phone)
```

## Art pipeline

Props are built from primitives in `art/render_sprites.py` and rendered by Blender
into `public/sprites/` with a fixed 2:1 isometric camera, the same way Sims 1 and
RollerCoaster Tycoon pre-rendered their art.

```bash
npm run sprites             # re-render everything (needs Blender 4.5; set BLENDER=path to override)
npm run sprites -- bench    # re-render just one prop
```
