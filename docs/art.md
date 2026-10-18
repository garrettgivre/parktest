# Art bible: Funtier Lands

The look is **The Sims 1 / RollerCoaster Tycoon 1**: real 3D models pre-rendered into 2D
sprites at a fixed isometric angle, with slightly saturated textures, flat midday sun, soft
baked shadows and a little grime. We build it the way those games did: model in Blender,
render sprites, and let textures carry the detail.

## Pipeline

```bash
npm run assets               # write art/assets.json from the park data
npm run art                  # render every building to public/sprites/park/
npm run art -- emporium bbq  # re-render just these
```

- **`art/build_park.py`** builds each building from a *kit*: the **zone** picks materials
  and roof style, the **kind** picks the shape (food counter, ride station, restroom,
  show marquee...). A few things have their own models (spinners, drop towers, the
  T-Rex, landmarks, cars).
- **Camera:** orthographic, 60° tilt, 45° turn (2:1 dimetric), **128 px per tile**, 78 px
  per tile of height. This matches the game exactly, so sprites drop straight in.
- **Lighting:** one warm sun from the upper left, soft sky light, shadow catcher on the
  ground so shadows are baked into each sprite.
- **Output:** `public/sprites/park/<id>.png` plus `manifest.json` (each sprite's anchor:
  the pixel where the footprint centre on the ground lands). The game uses a sprite when
  one exists and falls back to the gray-box block otherwise. Settings ⚙️ has a
  **Gray-box** toggle.

## Textures (drop-in)

Put a seamless PNG in `art/textures/` with one of these names and every material that
uses it switches from procedural to your texture on the next `npm run art`. Textures are
tinted toward each zone's colour, so neutral-ish textures work best.

| File | Used for |
|---|---|
| `brick.png` | Depot Street buildings, storefronts, clock tower |
| `stucco.png` | Passport Plaza pavilions |
| `roof_tile.png` | Passport Plaza roofs |
| `wood.png` | Bone Wars planks, Foam Party Pier dock |
| `tin.png` | corrugated roofs (Bone Wars, Ozark), backstage warehouses |
| `stone.png` | Fossil Flats rock, Extinction Junction scorched stone |
| `concrete.png` | Tomorrow Mall |
| `clapboard.png` | Landlocked Lagoon cottages |
| `shingle.png` | Lagoon roofs |
| `logs.png` | Ozark Boardwalk cabins |
| `canvas.png` | Exposition Midway tents |

### ChatGPT prompt template

Paste this, swapping in the bracketed part. Ask for 1024×1024 and then check that the
edges tile.

> Seamless tileable texture, square, flat front-on view with no perspective and no
> shadows or lighting baked in. Late-1990s / early-2000s PC game texture style, like The
> Sims 1 or RollerCoaster Tycoon: slightly saturated, crisp, a little hand-painted, light
> grime. Subject: **[red clay brick wall with off-white mortar, slightly uneven bricks]**.
> No text, no logos, no borders.

Subjects for each file:

- **brick:** red clay brick wall with off-white mortar, slightly uneven bricks
- **stucco:** warm cream stucco wall, subtle trowel marks, faint water stains
- **roof_tile:** terracotta clay roof tiles in rows, sun-faded
- **wood:** weathered vertical wooden planks, brown, a few nail heads
- **tin:** corrugated galvanized metal sheet, slightly rusty at the seams
- **stone:** rough tan sandstone blocks, irregular, fossil shell imprints
- **concrete:** 1980s beige concrete panels with seams and drip stains
- **clapboard:** horizontal painted clapboard siding, faded sky blue, peeling a little
- **shingle:** dark gray asphalt roof shingles in rows
- **logs:** stacked horizontal round logs with chinking, cabin wall
- **canvas:** red and white vertical striped circus tent canvas, a little dirty

Signs, posters and menu boards come next; they'll use the same template with "flat
graphic sign" instead of "texture".

## Zone looks

The architecture stays straight. The jokes are in the signage and subtitles, and they
target the owners, never the cultures (see docs/research.md).

| Zone | Materials | Roof | Accent |
|---|---|---|---|
| Depot Street | red brick, cream trim | flat with parapet | forest green, burgundy signs |
| Exposition Midway | striped canvas | tent with flag | gold, string lights |
| Passport Plaza | cream stucco | terracotta hip | blue; every pavilion visibly the same building |
| Bone Wars Basecamp | weathered planks | tin gable | bone white |
| Fossil Flats | tan rock | leafy | bone white, kid colours |
| Extinction Junction | scorched stone | flat | glowing orange cracks |
| Atomic Acres | white + teal Googie | boomerang | starbursts, chrome |
| Tomorrow Mall | beige concrete | flat | pink/teal neon |
| Aero Heights | glossy glass, white | dome | sky blue |
| Y2K Plaza | frosted pastel, chrome | dome | purple |
| Mirrorball Mile | deep purple | marquee bulbs | hot pink + cyan neon |
| Foam Party Pier | dock wood | flat | lavender, white foam |
| Landlocked Lagoon | blue clapboard | shingle gable | red, white trim |
| Ozark Boardwalk | logs | green tin gable | pale yellow |

## What's next (art)

1. Textures for the slots above (biggest visual jump for the least effort).
2. Ground tiles to replace the painted ground (grass, pavers per zone, boardwalk, sand).
3. People: a rigged low-poly guest (Mixamo) rendered in 8 directions with a walk cycle,
   replacing the pawns. Deb, Gary, you (vest + cap) and Brad (tie, clipboard).
4. Coaster tracks as real models instead of drawn lines.
5. Hero passes on the headliners and landmarks.
