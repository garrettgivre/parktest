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

| You | A physical worker you walk around the park. To sabotage something you have to be there |
| Structure | Roguelike-ish: each day is a run with a random group, random wishlist and a chosen loadout |
| Targets | One guest group per day while we build |
| Manager duties | Yes, but light: one at a time, optional at a cost, never a to-do list |

## Lands (v1)

| Land | Vibe |
|---|---|
| Main Street | Front of the park. Midwest main street (KC-ish, not overt): gift shops, BBQ, soda fountain, the gate |
| Around the World | Different cultures represented: carousel, balloon race, food hall, bazaar |
| Prehistoric | Dinosaurs; the kid-friendly area |
| Retro Space | 1950s–60s atomic-age space: rockets, satellites, a theater |
| Future Metropolis | Frutiger Aero: glossy glass, bubbles, clouds, sky-blue optimism |
| Rave | Gay disco: mirrorballs, glitter, neon, the nightly club show |
| Ocean | Water and sea: flume, water coaster, swings around a lagoon |

## v1 loop: worker, duties, loadout

- **Morning briefing:** meet today's group (two traits, two known wishes), then pick
  **3 of 5 offered tools** for your shift (keys, wet-floor signs, mystery patties,
  walkie-talkie, golf cart, radio scanner, mascot suit, clipboard, comp vouchers).
- **You walk.** Tap a building to walk there; actions take minutes of your time. Tap an
  action while far away to walk there and do it. You can follow the group to listen in.
- **Intel is local.** You only hear what they say (their next plans) when you're within
  earshot, unless you packed the radio scanner. So you choose between tailing them for
  information and running ahead to set things up.
- **Witnesses:** sabotage within sight of the group costs more suspicion.
- **Manager duties:** every couple of hours the manager radios one duty somewhere in the
  park. Doing it lowers suspicion and gives you an alibi in that land for a while
  (cheaper sabotage there). Skipping it costs suspicion. That's it.
- **Space matters:** guests use the nearest restroom, food and route. Closing the
  restroom near the 60-minute coaster line, or blocking a junction so they detour, are
  set-ups that pay off later.

## v1.1: making it funny and readable

- **Combos** (misery multipliers for chained set-ups): So Close!, Bladder Ambush,
  Restroom Grand Tour, Scenic Route, Hangry, Customer Feedback Loop, Double Feature,
  Déjà Vu, Drip Dry, Lasting Impression, Branson Bound, Nickel & Dimed, Thank You for
  Your Patience. Listed as rumors in the briefing; call-outs pop on screen.
- **One ★ signature move per land:** Main Street parade (blocks the street), Around the
  World industrial teacups (queasy), Prehistoric jammed T-Rex (stuck mid-ride), Retro
  Space timeshare presentation instead of the show, Future app crash (lines lost), Rave
  one-song DJ loop (area misery), Ocean monsoon splash zone (soaked), plus the Scare Barn
  surprise upcharge.
- **Guest Relations** is the guests' escape valve: at low Patience they go complain once.
  A fair hearing restores Patience *and* files a complaint (+10 suspicion). Get there first
  and route complaints to "the old company."
- Floating misery numbers, mood face and status icons over the group, line-progress bar.
- Dialogue variants for every moment, and ambient park awfulness from real reviews.
  See [docs/research.md](docs/research.md).

## v1.3: the rebuilt park

A lumpy loop of 7 lands and 7 blend zones around an irregular lagoon, with Depot Street
running from the loop out to the Front Gate and Lot Z. Land sizes follow importance.

| Zone | Kind | Between |
|---|---|---|
| Depot Street | land (front) | |
| Exposition Midway | blend | Depot Street ↔ Passport Plaza |
| Passport Plaza | land | |
| Bone Wars Basecamp | blend | Passport Plaza ↔ Fossil Flats |
| Fossil Flats | land (kids) | |
| Extinction Junction | blend | Fossil Flats ↔ Atomic Acres |
| Atomic Acres | land (1958's future) | |
| Tomorrow Mall | blend (1985's future) | Atomic Acres ↔ Aero Heights |
| Aero Heights | land (2008's future) | |
| Y2K Plaza | blend | Aero Heights ↔ Mirrorball Mile |
| Mirrorball Mile | land | |
| Foam Party Pier | blend | Mirrorball Mile ↔ Landlocked Lagoon |
| Landlocked Lagoon | land | |
| Ozark Boardwalk | blend | Landlocked Lagoon ↔ Depot Street |

Plus Fountain Circle (hub on the lagoon), a footbridge across the lagoon via the island,
the Prairie Line train (stations at Depot Street, Fossil Flats, Aero Heights), the Sky
Buckets across the lagoon, staff service roads, and a backstage yard with Brad's office.

- **Bleed:** land-wide effects work at full strength in their land and half in the
  neighbouring blends (DJ loop, splash zone, industrial teacups, app crash). Alibis and
  meteor smoke spread to neighbours too. Blend ground colours fade between their lands.
- **Blend moves:** rig the ring toss, Scenic Mode mine train, meteor smoke (hides you from
  Brad and them from you), arcade power surge, scaffold the Bubble Wall, foam cannons,
  run the party boat out of gas. Plus stop the train / Sky Buckets (riders get stranded)
  and take the parking tram "out of service."
- **Naming rules** (from research, see docs/research.md): every joke targets the company
  (cheapness, sponsors, rebrands, over-promising), never a culture. Passport Plaza names
  specific places and the joke is the executives who built it; Mirrorball Mile is run by
  its own queens and the joke is corporate trying to rename it.

## v1.2: more systems for the first day

- **Brad the manager** walks the park. Calm below 50 suspicion; patrols your land from 50;
  tails you from 75. Sabotage inside his sight ring costs +20 and he calls it out. Doing a
  duty in front of him earns extra goodwill. He also sends the duties.
- **Staff service roads** (dashed) only you and Brad can use: get ahead of the guests.
- **Day arc:** heat advisory 1–4 PM (lines drain patience; unplugged queue fans hit
  hard), one random storm closes outdoor coasters (free misery, cover), the Haunt opens at
  7 PM (a new "scream at the Haunt" wish; monsters can be sent on break), night falls.
- **Megaphone** tool: announce their destination is closed; they re-plan. Herding.
- **Crowds** wander the paths; rides show visible lines.
- **Tips** fire once per browser for the first time each situation comes up; **sound**
  (synthesized) and **auto-pause** toggles in ⚙️.
- **Results** get a grade (S–F) with a title, a misery-by-category breakdown, combos, the
  review and Brad's memo.

## Core loop (v0 proposal, superseded by v1 above where they differ)

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

### v1 balance check (`npm run balance`, 150 days per bot)

| Bot | Score | Outcome (closed / left / fired) |
|---|---|---|
| Does nothing | ~6 | 150 / 0 / 0 |
| Reckless (ignores suspicion) | ~84 | 0 / 58 / 92 |
| Careful, skips duties | ~137 | 133 / 17 / 0 |
| Careful, does duties | ~179 | 114 / 36 / 0 |
| Careful + comp vouchers | ~186 | 129 / 21 / 0 |

Duties are worth doing (alibi + suspicion relief), and loadouts change results.

## Plan

1. ~~Art spike~~ — done (`spike.html`).
2. ~~Gray-box gameplay test v0~~ — too fast, too few decisions, park too small.
3. ~~v1~~ — big park with 7 lands, walking worker, local intel, light duties, loadout.
4. Next: playtest v1. Then likely: more sabotage set-ups per land, a run-to-run
   meta (the owners changing hands), then art.

## Open questions

- Danger Park (board game) — which mechanics are worth borrowing?
- Final park name (Funtier Lands is a placeholder).
- Should time pause while a building's menu is open?
