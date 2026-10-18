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


```

## Park art

```bash
npm run assets             # export art/assets.json from the park data
npm run art                # render every building with the Blender kit (needs Blender 4.5)
npm run art -- bbq rocket  # re-render specific buildings
```

Sprites land in `public/sprites/park/`. Textures go in `art/textures/`. The look, the
pipeline and ChatGPT texture prompts are in [docs/art.md](docs/art.md).
