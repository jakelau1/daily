# Hong Kong, from Happy Valley

One small site, seven sections, hosted on GitHub Pages at `…/daily/` (https://jakelau1.github.io/daily/), copied from `jakelau1/main-hk`. It replaces five separate pages
(a weather page with a hiking map, a video list, a traffic-camera page, a bus-arrivals page and a day-trips page) and adds a
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
| Study 溫書 | `study/` | `study/videos.js` (lecture video links) |

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
`.github/workflows/record-weather.yml` ("Record weather and publish") runs every 10 minutes and on every push to
`main`. It saves the latest readings into `weather/data/`, then publishes only the public folders (scheduled runs only
when something changed) (not `scripts/`, `tools/`,
`partials/` or `.github/`) to GitHub Pages.

1. Settings → Pages → Build and deployment → Source: **GitHub Actions** (not "Deploy from a branch"). GitHub does not
   republish the site for commits made by an Action, so the workflow publishes it itself.
2. Settings → Actions → General → Workflow permissions → **Read and write permissions**.
3. Actions tab → "Record weather and publish" → Run workflow.

Things to know:
- The recorder commits two or three times an hour (whenever a reading changes). That is expected.
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

## The private "now" display (`now/`)

A page for an always-on phone. It is not linked from any other page. It shows the owner's private schedule, which
lives in `private/schedule.html` (git-ignored) and is only ever published encrypted with
[StatiCrypt](https://github.com/robinmoisson/staticrypt) inside `now/index.html`. Everything else in `now/` is ordinary
public code with no schedule content in it. The settings that tie the display to the schedule's own names are in
`private/config.json` (also git-ignored); the build stops if it is missing.

After saving a new `private/schedule.html`:

    npm run now                 # rebuild and check the encrypted page
    npm run now -- --publish    # the same, then commit and push it (the site updates within a few minutes)

The display picks up the new version at its next daily reload, or straight away if you reload it.

How it fits together:
- `tools/extract-schedule.mjs` reads the blocks, categories (with their floors) and routines out of the schedule file.
- `tools/build-now.mjs` encrypts that data with the password in `.env` (git-ignored) and the salt in
  `.staticrypt.json` (not secret; keep it, because a new salt makes every device ask for the password again). It then
  checks the result: no readable schedule text, no inline code, and it decrypts back to the same data.
- `tools/now-template.html` is the page around the encrypted data. StatiCrypt's own template uses inline code, which
  the site's Content-Security-Policy refuses, so this one keeps the data in a JSON block and the code in
  `now/unlock.js` (unlocking), `now/now.js` (the display) and `now/vendor/staticrypt.js` (StatiCrypt's code, made by
  the build). The policy did not need loosening.
- "Remember on this device" stores a salted hash of the password in that browser, with no expiry, so the daily
  reload unlocks by itself. To forget it on a device, open the page with `#staticrypt_logout` at the end of the address.
- `npm run check-live` checks the published page on GitHub Pages the way the phone uses it.
- `npm run test-now` tests the encrypted page end to end in headless Chromium with simulated days and times
  (screenshots in `build/screenshots/`, git-ignored).
- `tools/check-private.mjs` runs before every commit (install it once per computer with
  `node tools/check-private.mjs --install`) and stops a commit that includes `private/`, `build/`, `.env` or readable
  schedule text.

What the page does, in general terms: it shows the current item and what comes next, with weather prompts and
warnings from the official feeds, and a small picker for choices made during the day. It shifts its layout slightly
every few minutes and dims at night to reduce burn-in, asks the browser to keep the screen on, reloads once a day
when the site can be reached, greys out any number that has stopped updating, and shows a banner when the connection
is lost. Choices made on the page are saved in that browser only.

### Weather relay (`relay/`)
GitHub ran the recorder far less often than scheduled (main-hk: 7 of about 70 scheduled runs over 36 hours; this
repository: none in its first 5 hours), so its copies can be hours old. The relay is a tiny program on Cloudflare
Workers (free plan) that fetches the official files when the display asks, keeps each answer for a few minutes, and
answers only pages on `https://jakelau1.github.io`. It answers in the same shapes as the recorder's copies:
`/ocf`, `/aqhi`, `/nowcast`. No schedule data passes through it; Cloudflare sees each request's time and the phone's
internet address.

Setting it up (once, at the computer):
1. Create a free account at cloudflare.com.
2. `npx wrangler login` (opens the browser to allow access).
3. `npm run relay-deploy` (deploys it, checks it answers, saves its address in `relay/url.txt`, rebuilds the page).
   The first time, Cloudflare may ask you to choose a `workers.dev` name.
4. `npm run now -- --publish`.

Until then `relay/url.txt` doesn't exist and the display uses the recorder's copies. To test the relay on this
computer: `npx wrangler dev --config relay/wrangler.toml --var ALLOWED_ORIGINS:http://127.0.0.1:8765`.

## The Android app (`app/`)

The same files, built a second way: an Android app made with [Capacitor](https://capacitorjs.com) that holds the Now
display, the owner's private schedule and, later, more. It is never published: its files and the APK stay on the
owner's computer (git ignores them, and the build script stops if it is not).

- `app/` is the Capacitor project (its own `package.json`); `app/web/` is the app's own web code; `app/android/` is the
  Android project (screen kept on, landscape, system bars hidden, no automatic Android backups).
- `node tools/build-app.mjs` gathers the web files into `build/app-www/` (git-ignored) from this repository's sources plus the
  private schedule, and syncs them into the Android project. Add `--apk` to build `app/dist/GetReady-v….apk` and print its SHA-256.
- `node tools/test-app.mjs` tests the newest APK on an emulator (never a real phone): the page starts from the bundled
  schedule, the database keeps its data across a reload and across the app being stopped, backup and restore round-trip through
  Android's own file picker, the screen stays awake and is landscape, the feeds that block web pages can be read inside the app,
  and nothing logs an error. See the top of that file for how to start the emulator.
- What the person using it saves is kept in a SQLite database inside the app. "Back up or restore data" (in the picker
  screen) saves or reads one JSON file with Android's "Save to…" and open pickers.

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
