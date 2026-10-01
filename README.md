# Hong Kong, from Happy Valley

One small site, seven sections, hosted on GitHub Pages at `…/daily/` (https://jakelau1.github.io/daily/), copied from `jakelau1/main-hk`. It replaces five separate pages
(private-hk-weather + its hiking map, phl245-videos, hk-traffic-cams, happy-valley-arrivals, hk-day-trips) and adds a
compound-interest calculator.

| Section | Folder | Data |
|---|---|---|
| Home 香港 | `index.html`, `assets/js/home.js` | live stats from the Observatory, Transport Department and Citybus |
| Weather 天氣 | `weather/` | Hong Kong Observatory, EPD air quality, plus the recorder's saved data in `weather/data/` |
| Hiking 行山 | `hiking/` | AFCD and Lands Department (saved files in `hiking/data/`, live closures from the CSDI Portal) |
| Arrivals 到站 | `arrivals/` | Citybus, KMB and green-minibus real-time feeds on DATA.GOV.HK |
| Roads 路況 | `cams/` | Transport Department journey times and camera images |
| Day trips 一日遊 | `trips/` | hand-written content in `trips/trips-data.js` |
| Savings 儲蓄 | `savings/` | none (calculator) |
| Study 溫書 | `study/` | `study/videos.js` (PHL245 videos) |

There is no build step for the site itself: the files in the repository are what gets published.

## How it is put together
- **One design system:** `assets/css/site.css` (colours, glass, type, buttons, shared loading/empty/error/stale states),
  `assets/js/motion.js` (scroll and reveal motion, ported from NTTCB), `assets/js/art.js` (the pointillist section art,
  drawn in code), `assets/js/net.js` (fetch with timeout and retry, plain-English errors, the state blocks),
  `assets/js/chrome.js` (nav panel, offline banner). Each section adds its own small CSS and JS next to its page.
- **Section colours** come from `<html data-section="...">` (see the top of `site.css`).
- **Shared header, footer and `<head>`** live in `partials/`. After editing them, or the section list in
  `tools/stamp.mjs`, run `node tools/stamp.mjs`; it rewrites the marked blocks in every page. Commit the result.
- **Fonts** are self-hosted (SIL Open Font License): Bricolage Grotesque and Martian Mono (Latin), and LXGW WenKai TC
  cut down to just the Chinese characters the site uses. Run `node tools/fonts.mjs` after adding new Chinese text to
  any page; it re-downloads and regenerates `assets/css/fonts.css`. Licences: see `assets/fonts/LICENSES.md`.
- **Security policy:** every page has a strict Content-Security-Policy that allows only its own files and the specific
  data servers it needs. Inline `<script>`, `<style>` and `style=""` are all refused, so never add them: put code and
  styles in files, and set dynamic sizes from JS (`el.style.setProperty(...)`).
- **Saved settings** (all in this browser only): `hkwx.region` and `hkwx.cache.v1` (weather), `hvEta.*` (arrivals),
  `roadcams.jtFrom` (roads).
- **Old links:** an old root link like `…/daily/#happy-valley` is forwarded to `weather/#happy-valley`
  by `assets/js/home.js`. `404.html` uses `<base href="/daily/">` because GitHub Pages serves it at any
  depth; if the site moves to another repository, change that one line.

## Publishing
`.github/workflows/record-weather.yml` ("Record weather and publish") runs twice an hour and on every push to `main`.
It saves the latest readings into `weather/data/`, then publishes only the public folders (not `scripts/`, `tools/`,
`partials/` or `.github/`) to GitHub Pages.

1. Settings → Pages → Build and deployment → Source: **GitHub Actions** (not "Deploy from a branch"). GitHub does not
   republish the site for commits made by an Action, so the workflow publishes it itself.
2. Settings → Actions → General → Workflow permissions → **Read and write permissions**.
3. Actions tab → "Record weather and publish" → Run workflow.

Things to know:
- The recorder commits about once or twice an hour. That is expected.
- GitHub can run scheduled jobs late or skip them when busy, so the odd past hour may be missing.
- In public repositories GitHub may switch off scheduled workflows after 60 days without activity. If the past hours
  stop appearing, check the Actions tab and re-enable it.
- The weather page's hourly forecast comes from the Observatory's automatic forecast (ARWF) data file. It works and
  is on the Observatory's own server, but it is not in the documented open-data list, so the Observatory could change
  it without notice.
- The Observatory's regional wind and 1-minute temperature files can't be read by web pages (CORS), so the "Wind"
  view under Across Hong Kong shows an empty state.

## Privacy
No analytics, cookies or third-party scripts or fonts. Each page can only contact its own site and the government
servers listed in its Content-Security-Policy.

## Hiking section

`hiking/` is the Hiking section at `…/daily/hiking/`. It shows Hong Kong's country park hiking routes on a Lands Department map, with each
route's height profile, estimated climb and time, closures, campsites, visitor centres and
distance posts. Everything it needs is in `hiking/`; the workflow publishes it with the rest of
the site.

### Where the data comes from
- **Routes, distance posts, closures, campsites, visitor centres:** AFCD (Agriculture, Fisheries
  and Conservation Department), via the CSDI Portal and DATA.GOV.HK.
- **Heights and place names:** Lands Department, via the CSDI Portal and DATA.GOV.HK.
- **Map and place-name labels:** Lands Department Map API (`mapapi.geodata.gov.hk`). Its terms
  require the Lands Department logo and "Map from Lands Department" on the map, and forbid large
  bursts of requests; the page loads only the tiles on screen and never downloads tiles in bulk.
- **Live closures:** fetched from the CSDI Portal once per visit. If that fails or looks wrong,
  the page uses the saved copy in `hiking/data/closed_trails.geojson` and shows its date.

The files in `hiking/data/` are made by a separate project on Jake's computer (the "Hiking
Trails Webapp Data" pipeline), which works out the heights, climbs and times. Its `pipeline/`
folder has the full details: `README.md`, `DECISIONS.md` and `SOURCES.md`.

### Refreshing the data
In the pipeline project folder:
1. `.venv/bin/python pipeline/run.py` (or `--closures` for just the closures snapshot). Read the
   summary at the end; it should say "Nothing needs attention".
2. `.venv/bin/python pipeline/run.py --copy` copies the new files into this repository's
   `hiking/data/` and lists what changed. It doesn't commit or publish anything.
3. In this repository: pull first (the recorder commits here twice an hour), open the Hiking page
   locally to check it, then commit and push. The push republishes the site.

### Other files
- `hiking/vendor/leaflet-1.9.4/`: the Leaflet map library (BSD licence), stored here so the page
  never loads code from another server. `SOURCE.md` there records where it came from.
- `hiking/img/landsd-logo.jpg`: the Lands Department logo, as used in their own Map API sample code.

### Privacy
The Hiking page's Content-Security-Policy only allows requests to the page's own site,
mapapi.geodata.gov.hk (map tiles) and portal.csdi.gov.hk (live closures). No analytics,
cookies, web fonts or third-party scripts. "My location" asks for permission only when pressed,
and the position never leaves the device.
