# A-League Live

An unofficial A-League Men and Women app, styled after aleagues.com.au and built for the Huawei P30 Pro (a 360 × 780 screen in Chrome). It's an installable web app (PWA): plain HTML, CSS and JS with no build step.

**Live at: https://jdonnelly84.github.io/aleague-live/** (GitHub Pages, from the `main` branch of `jdonnelly84/aleague-live`). Any push to `main` updates it within about a minute.

## What it does

- **Latest**: a live-match banner or a countdown to the next kick-off, this round's matches as a strip of cards, your club, the top 6, the latest results and news.
- **Matches**: every round of the season, with chips to jump between rounds. Times show in the phone's own time zone.
- **Ladder**: the full table with finals markers and position changes. A Form view shows each club's last 5. The ladder switches to the live ladder while matches are being played.
- **Stats**: the leaders for goals, assists and cards, worked out from every finished match's timeline.
- **News**: the latest articles from aleagues.com.au, which open in the browser.
- **Match centre**: the score, the live clock and scorers. The Timeline tab lists goals, assists, cards, substitutions and VAR checks, and the Info tab shows the venue, crowd and officials. Upcoming matches show a countdown, both clubs' form, earlier meetings this season and a ticket link.
- **Club pages**: position, points, W-D-L record, form, fixtures, results and the club's top scorers. Set any club as **My club** with ★.
- A **Men / Women** switch sits in the top bar. Tap ⟳ or pull down to refresh. During live matches the app polls every 20 s and shows a "GOAL!" pop-up when the score changes.

## Where the data comes from

- `https://match.api.aleagues.football`: the feed aleagues.com.au uses itself. It's public and doesn't need a key, and it allows requests from any website. That means the phone reads it directly, with no server or PC in between.
  - `/v1/competitions/{comp}/ladder` (or `/ladder/live`): the ladder and the current season id
  - `/middleware/v2/fixturesAndResultsV2?competitionId=…&tournamentId={season}`: the whole season's fixtures
  - `/v1/matches/{id}`: the timeline, officials and periods for one match (used for live scores, the match centre and stats)
- `https://aleagues.com.au/wp-json/wp/v2/posts`: news
- Competition ids are set in `app.js` (`COMPS`): Men `xwnjb1az11zffwty3m6vn8y6`, Women `9p3nnxhdjahfn8qswpzy8oyc3`. The app picks up the season id from the ladder feed, so a new season should be found without any changes.

The app saves the last data it got on the phone (localStorage), so it opens instantly and still works offline. A finished match's timeline is downloaded only once.

## Run it on the PC

Double-click `start.bat`, or run `python serve.py`, then open http://localhost:8765.

## Put it on the Huawei P30 Pro

**Quick test (PC must be on, same Wi-Fi):** run `start-phone.bat`. It prints an address like `http://192.168.1.20:8765`. Open that address in Chrome on the phone, then go to ⋮ menu > **Add to Home screen**.

**Proper install (works anywhere, no PC):** the folder has to be hosted on a free HTTPS host such as GitHub Pages or Netlify. Open that https address in Chrome on the phone and choose ⋮ > **Install app** (or **Add to Home screen**). It then opens full screen from its own icon, with the blue status bar, and keeps working offline. Huawei Browser also offers "Add to home screen".

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell (top bar, bottom tabs) |
| `app.css` | Styling (A-Leagues colours: blue #151A95, yellow #FFCD00, charcoal #18191A) |
| `app.js` | The whole app: data, live polling, screens, routing |
| `sw.js` | Service worker that caches the app shell and crests for instant and offline start |
| `manifest.webmanifest`, `icons/` | Install details and home-screen icons |
| `crests/` | Club crests, taken from aleagues.com.au |
| `serve.py`, `start.bat`, `start-phone.bat` | Local server |

If you change `app.js` or `app.css`, bump `CACHE` in `sw.js` (for example to `aleague-live-v2`) so installed phones pick up the update.
