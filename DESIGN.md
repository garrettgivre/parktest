# Park Test — design notes

Working title. A goofy, single-player, landscape mobile game where you play a
behind-the-scenes worker at a run-down Midwest theme park whose secret job is to
ruin one guest group's day — while making it look like ordinary incompetence.

Inspired by a real (and increasingly sad) Halloween-season park visit: broken
ticket scanners, hours-long lines for rides that close as you reach the front,
meat served as the vegan option, barely any decorations.

## Decisions so far

| Topic | Decision |
|---|---|
| Audience | Personal project first; release if it turns out really fun |
| Players | Single player |
| Time | Real-time while playing (game clock, pausable), not tied to the real-world clock |
| Tone | Goofy / slapstick, with dry corporate voice from certain characters (management, owners) |
| Setting | Fictional park — an amalgamation of Midwest parks. No real park names or branding |
| Orientation | Landscape |
| Platform | Web game (TypeScript), played on phone via home-screen web app; wrap natively later if released |
| Art | Sims 1 look via the Sims 1 method: 3D models rendered in Blender at a fixed isometric angle into 2D sprites. Supplemented with images the owner generates in ChatGPT (textures, signs, posters, concept art) |

## Core loop (proposal, untested)

- One run = one park day, ~5 minutes of play, with Sims-style pause/speed controls.
- One guest group per day with a wishlist (ride X, eat Y, see the show) and traits
  (vegan, thrill-seeker, impatient, small kid…). Observing them reveals the wishlist.
- Three meters:
  - **Misery** — your score.
  - **Patience** — if it hits zero, they leave early and scoring stops. Push your luck.
  - **Suspicion** — sabotage must look like incompetence. Too many coincidences →
    complaints, a manager investigates, you get fired.
- Targeted sabotage (closing *their* coaster as they reach the front) scores more
  than random chaos.
- Sabotage drawn from real experiences: "broken" scanners, ride closures, wrong
  vegan meal, endless lines, sad decorations.
- Campaign idea: the park changes owners every season; each new owner changes
  rules, budgets and the tools available to you.

## Plan

1. Art spike — one small scene rendered Sims-1-style, viewed in landscape on a phone.
2. Gray-box gameplay prototype — placeholder art, test whether the three meters are fun.
3. Expand content and art once 1 and 2 hold up.

## Open questions

- Danger Park (board game) — which mechanics are worth borrowing?
- Park name.
