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

## Gameplay test (v0) — what's in it

Placeholder park name: **Funtier Lands**. One day, 10 AM–10 PM (~4 real minutes at 1×),
one target group (Deb & Gary Henderson), gray-box map, 8 sabotages + 2 guest actions.

- Guests have a hidden 6-item wishlist; two are known at the start, the rest are revealed
  as they decide to do them, or by **Eavesdrop**. They also get hungry and need the restroom.
- After their wishlist rides they keep re-riding things (worth less to ruin), so the
  afternoon isn't dead.
- **Close for "maintenance"** is the signature move: closing a ride while they're near
  the front of its line is worth the most, but costs extra suspicion because they're right there.
- Suspicion rises per sabotage, more when they witness it, more again when sabotages
  cluster ("coincidences"), and slowly decays. The park also breaks things on its own
  twice a day, which *lowers* suspicion (cover).
- **FastPass** (goodwill): patience +15, misery −5, suspicion −4. Lets a skilled player
  push harder without sending them home.
- Score = misery × 1.5 if they stay until close, × 1 if they leave early, × 0.25 if you're fired.

### Balance check (`npm run balance`, 200 simulated days per bot)

| Bot | Score | Outcome (closed / left / fired) |
|---|---|---|
| Does nothing | ~1 | 200 / 0 / 0 |
| Greedy, stops at 60 suspicion | ~170 | 102 / 98 / 0 |
| Greedy, ignores suspicion | ~47 | 0 / 17 / 183 |
| Watches suspicion *and* patience, uses FastPass | ~200–220 | ~170 / ~25 / ~5 |

So both failure modes bite, and paying attention beats spamming. Bots are dumb; a human
who times closures well should do better.

## Plan

1. ~~Art spike~~ — done (`spike.html`).
2. ~~Gray-box gameplay test~~ — v0 playable (`index.html`). Needs real playtesting.
3. Next: playtest feedback, then decide what a full game is (more guests? multiple days?
   the changing-owners campaign?) before investing in art.

## Open questions

- Danger Park (board game) — which mechanics are worth borrowing?
- Final park name (Funtier Lands is a placeholder).
- Is one group per day enough, or should there be bystanders / multiple targets?
