# Hong Kong

One small site, seven sections, hosted on GitHub Pages at `…/daily/` (https://jakelau1.github.io/daily/). The same files are
also built into an Android app (see "The Android app" below). The site holds nothing personal: personal data lives in
`private/` (git-ignored) and only ever goes into the app or an encrypted page.

| Section | Folder | Data |
|---|---|---|
| Home 香港 | `index.html`, `assets/js/home.js` | live stats from the Observatory, Transport Department and Citybus |
| Weather 天氣 | `weather/` | Hong Kong Observatory, EPD air quality, plus the recorder's saved data in `weather/data/` |
| Hiking 行山 | `hiking/` | AFCD and Lands Department (saved files in `hiking/data/`, live closures from the CSDI Portal) |
| Arrivals 到站 | `arrivals/` | Citybus, KMB and green-minibus real-time feeds on DATA.GOV.HK; look up any route and add its stops to a board |
| Roads 路況 | `cams/` | Transport Department journey times and camera images |
| Day trips 一日遊 | `trips/` | hand-written content in `trips/trips-data.js` |
| Savings 儲蓄 | `savings/` | none (calculator) |
| Study 溫書 | `study/` | `study/videos.js` (lecture video links) |

There is no build step for the site itself: the files in the repository are what gets published.

## How it is put together
- **One design system:** `assets/css/site.css` (colours, glass, type, buttons, shared loading/empty/error/stale states),
  `assets/js/motion.js` (scroll and reveal motion), `assets/js/art.js` (the pointillist section art, drawn in code),
  `assets/js/net.js` (fetch with timeout and retry, plain-English errors, the state blocks), `assets/js/chrome.js`
  (nav panel, offline banner). Each section adds its own small CSS and JS next to its page.
- **Section colours** come from `<html data-section="...">` (see the top of `site.css`).
- **Shared header, footer and `<head>`** live in `partials/`. After editing them, or the section list in
  `tools/stamp.mjs`, run `node tools/stamp.mjs`; it rewrites the marked blocks in every page. Commit the result.
- **Fonts** are self-hosted (SIL Open Font License): Bricolage Grotesque and Martian Mono (Latin), and LXGW WenKai TC
  cut down to just the Chinese characters the site uses. Run `node tools/fonts.mjs` after adding new Chinese text to
  any page; it re-downloads and regenerates `assets/css/fonts.css`. Licences: see `assets/fonts/LICENSES.md`.
- **Security policy:** every page has a strict Content-Security-Policy that allows only its own files and the specific
  data servers it needs. Inline `<script>`, `<style>` and `style=""` are all refused, so never add them: put code and
  styles in files, and set dynamic sizes from JS (`el.style.setProperty(...)`).
- **Saved settings** (all in this browser only): `hkwx.region` and `hkwx.cache.v1` (weather), `hvEta.*` (arrivals: routes
  looked up, stops on the board, remembered stop names), `roadcams.jtFrom` (roads).
- **Optional preset files:** `arrivals/presets.js` and `cams/presets.js` are empty on the public site. The Android app build
  replaces them with its own presets from `private/`.
- **Old links:** an old root link such as `…/daily/#stanley` is forwarded to `weather/#stanley` by `assets/js/home.js`.
  `404.html` uses `<base href="/daily/">` because GitHub Pages serves it at any depth; if the site moves to another
  repository, change that one line.

## Publishing
`.github/workflows/record-weather.yml` ("Record weather and publish") is set to run every 10 minutes and on every push to
`main`. It saves the latest readings into `weather/data/` and publishes only the public folders (not `scripts/`,
`tools/`, `partials/` or `.github/`) to GitHub Pages; scheduled runs publish only when something changed.

1. Settings → Pages → Build and deployment → Source: **GitHub Actions** (not "Deploy from a branch"). GitHub does not
   republish the site for commits made by an Action, so the workflow publishes it itself.
2. Settings → Actions → General → Workflow permissions → **Read and write permissions**.
3. Actions tab → "Record weather and publish" → Run workflow.

Things to know:
- **GitHub's timer is unreliable.** Measured over about 14 hours: 4 scheduled runs instead of about 84. GitHub's documentation
  says scheduled runs can be delayed or dropped when it is busy. So the saved history has many gaps; the Weather page counts
  the hours it has ("from 5 of 12 hours recorded") and says that gaps mean no reading was recorded. The recorder keeps
  36 hours.
- In public repositories GitHub switches off scheduled workflows after 60 days without activity.
- The Android app records its own readings (see below); the recorder is best effort for the website.
- The weather page's hourly forecast comes from the Observatory's automatic forecast data file. It works and is on the
  Observatory's own server, but it is not in the documented open-data list, so the Observatory could change it without notice.
- The Observatory's regional wind and 1-minute temperature files can't be read by web pages (CORS), so the "Wind"
  view under Across Hong Kong shows an empty state.

## Privacy
No analytics, cookies or third-party scripts or fonts. Each page can only contact its own site and the government
servers listed in its Content-Security-Policy. Nothing from `private/`, `build/`, `.env`, APKs or signing keys is ever
committed: `tools/check-private.mjs` runs before every commit (install it once per computer with
`node tools/check-private.mjs --install`) and refuses a commit that includes them, readable text from the private schedule,
or any term on a private list of sensitive words. `node tools/check-private.mjs --audit` lists tracked files that still contain one.

## The display page (`now/`)
A page for an always-on phone, not linked from any other page. Its data (a private schedule) is read from
`private/schedule.html` and is only ever published encrypted with [StatiCrypt](https://github.com/robinmoisson/staticrypt)
inside `now/index.html`; everything else in `now/` is ordinary public code with no private content. The settings that tie it
to the private data are in `private/config.json` (git-ignored); the build stops if it is missing. The Android app is replacing
this page; it stays until the app does everything it does.

    npm run now                 # rebuild and check the encrypted page
    npm run now -- --publish    # the same, then commit and push it

- `tools/extract-schedule.mjs` reads the private data; `tools/build-now.mjs` encrypts it with the password in `.env`
  (git-ignored) and the salt in `.staticrypt.json` (not secret; keep it, a new salt makes every device ask again), then checks
  the result: no readable private text, no inline code, and it decrypts back to the same data.
- `tools/now-template.html` is the page around the encrypted data (the markup lives here, not in `now/index.html`, which is
  build output). The code is in `now/unlock.js`, `now/now.js`, `now/wx.js` (weather), `now/plan.js` and `now/vendor/staticrypt.js`.
- Weather for the display: warnings, current readings and sunset straight from the Observatory; the forecast, air quality and
  rain nowcast (which block web pages) through the relay, else the recorder's copies. Each reading keeps its own time and greys
  out when old. Only Typhoon Signal 8 or higher and the black rainstorm warning take over the screen; lower signals and amber or
  red rainstorms show as a strip.
- `npm run test-now` tests it end to end in headless Chromium with simulated days and times (screenshots in `build/screenshots/`,
  git-ignored). `npm run check-live` checks the published page the way the phone uses it.

### Weather relay (`relay/`)
A small program on Cloudflare Workers (free plan) that fetches the three official feeds that block web pages, keeps each answer
for a few minutes, and answers only pages on `https://jakelau1.github.io`, in the same shapes as the recorder's copies: `/ocf`,
`/aqhi`, `/nowcast`. Its configuration switches Cloudflare's request logging off. It is for the website only; the Android app
reads the feeds itself. Deploying it needs a Cloudflare sign-in (`npx wrangler login`, then `npx wrangler logout` straight
after); no Cloudflare token or password is ever saved in a file. `npm run relay-deploy` deploys it and records its address in
`relay/url.txt`.

## The Android app (`app/`)
The same files, built a second way: an Android app made with [Capacitor](https://capacitorjs.com) that holds the display,
the private schedule and, later, more. It is never published: its files and APKs stay on the owner's computer (git ignores
them, and the build script stops if it does not).

- `app/` is the Capacitor project; `app/web/` is the app's own web code (database, backup panel, direct feed reader, weather
  recorder); `app/android/` is the Android project (screen kept on, landscape, system bars hidden, no automatic Android backups).
- `node tools/build-app.mjs` gathers the web files into `build/app-www/` (git-ignored) from this repository's sources plus the
  private data, and syncs them into the Android project. `--apk` builds `app/dist/GetReady-v….apk` (debug-signed) and prints its
  SHA-256. `--release` builds the release-signed APK; it asks for the key password in a terminal prompt and never stores it.
- `node tools/release-key.mjs create | check | check-backup` makes the release key outside the project folder, and checks a
  backup copy of it by fingerprint. Run it in a real terminal.
- The app reads the forecast, air-quality and rain feeds directly (`app/web/direct-feeds.js`), fetching the large rain file only when
  it has changed and only while it is needed, and records its own temperature and rain-gauge readings in its database
  (`app/web/wx-record.js`). What the user saves is kept in a SQLite database; "Back up or restore data" saves or reads one JSON file.
- `node tools/test-app.mjs` tests the newest APK on an emulator (never a real phone). See the top of that file for how to start it.
- `node tools/test-arrivals.mjs` tests the Arrivals page against fake bus servers (no real requests): first visit asks for nothing,
  requests are shared and paced, stop names are remembered, and "429 Too Many Requests" makes everything wait.

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

The files in `hiking/data/` are made by a separate data pipeline kept on the maintainer's computer, which works out the heights, climbs and times. Its `pipeline/`
folder has the full details: `README.md`, `DECISIONS.md` and `SOURCES.md`.

### Refreshing the data
In the pipeline project folder:
1. `.venv/bin/python pipeline/run.py` (or `--closures` for just the closures snapshot). Read the
   summary at the end; it should say "Nothing needs attention".
2. `.venv/bin/python pipeline/run.py --copy` copies the new files into this repository's
   `hiking/data/` and lists what changed. It doesn't commit or publish anything.
3. In this repository: pull first (the recorder commits here regularly), open the Hiking page
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
