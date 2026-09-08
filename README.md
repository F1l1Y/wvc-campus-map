# West Valley Campus Map

An interactive map of West Valley College, built by the **AI Builders Club**.
Live: <https://f1l1y.github.io/wvc-campus-map/>

Type a room code (`PE 10`, `LASS 30`, `LRC 141`) and the map takes you to the building and, where
a floor plan has been captured, highlights the room inside it. Also: restrooms, AEDs, evacuation
assembly sites and walking routes to them, parking and EV charging.

## The rule this project runs on

**Nothing here is placed by eye.** Every building is a surveyed footprint, every amenity is a
symbol printed on an official document positioned by a measured transform, and every room carries
the source and date it came from. Where the data does not exist, the app says so instead of
guessing. Tap **What's missing** in the footer to see exactly where the gaps are.

## Data

| File | What | Source |
|---|---|---|
| `campus.geojson` | 74 building footprints, 13 parking lots, 14 sport features | OpenStreetMap (ODbL); codes and field names from the official campus map, Feb 2024 |
| `rooms.json` | 199 searchable rooms | posted plans (PE, CC), the LRC wayfinding display, the Fall 2026 Schedule of Classes |
| `plans/pe.json` | Physical Education, 60 spaces as real geometry | posted sheet 23-2A Rev. 9/90 |
| `amenities.json` | 84 amenity points | official campus map Feb 2024, georeferenced (mean 4.32 m) |
| `evac_routes.json` | 23 evacuation walking routes | Dijkstra over 1,701 OSM path nodes |
| `coverage.json` | per-building coverage, ranked by class sections | Fall 2026 Schedule of Classes |
| `georef.json` | the fitted transform and its measured residuals | — |

## Adding a building

1. Photograph the plan posted inside it, **straight on**, whole sheet in frame. See
   `../CAPTURE_GUIDE.md` and `../CAPTURE_LIST.md`.
2. Transcribe rooms into `rooms.json` with `source` and the capture date.
3. Redraw the plan as `plans/<code>.json` (`width`, `height`, `rooms[].poly` in plan pixels),
   then add its code to the plan list in `app.js`.
4. Check the tracing with `../tools/render_plan.py`, which renders the JSON to a PNG.

## Deploying

Run `../tools/bump.sh` first — it bumps the `?v=` asset stamp. Without it GitHub Pages serves
the previous build from cache. Then commit and push to `main`.

## Stack

Leaflet on OpenStreetMap tiles. One HTML, one CSS, one JS file plus JSON. No backend, no API keys,
no build step, no analytics. "Where am I" uses the browser's geolocation, stays on the device, and
is never stored or transmitted.

Map data © OpenStreetMap contributors (ODbL). Not an official West Valley College product;
no college marks are used.
