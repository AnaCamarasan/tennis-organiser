# Baseline — Tennis Session Organiser (UI prototype v0.2)

A mobile-first React + TypeScript website, built around the existing tennis matchmaking engine. Designed for a single organiser using an iPhone. **Online-only:** no service worker or offline cache.

## Start locally

Prerequisites: Node.js 20+ and npm with package registry access.

```sh
npm install
npm run dev
```

Open the printed local address in a browser. To test from an iPhone on the same Wi-Fi, open `http://<your-computer-local-IP>:5173` (you may need to allow firewall access).

```sh
npm run build       # Production build
npm run preview     # Preview production build
npm run test:engine # Original engine tests
npm run simulate -- 19 5 8
```

## MVP workflow

1. **Players** → Add your roster or click **Load sample players**. Names, gender (M/F), and ratings (1–10 in 0.5 increments) are editable.
2. **Create session** → Everyone starts checked; uncheck absent players. Set the available number of courts.
3. **Generate round** → The existing matchmaking algorithm allocates rests and balances doubles teams.
4. **Tap two players** (including those resting) to swap. Use Undo, Regenerate, or Cancel.
5. **Confirm round** → Assignment and rests are recorded as a confirmed round.
6. Adjust attendance/courts for the next round and **Generate round N+1**.
7. **History** shows all confirmed rounds. **Correct** a round to replace its recorded pairings and rest assignments. Existing subsequent matches remain unchanged; future generations use the corrected history.
8. **End session** discards current session history; players persist.

## Persistence and constraints

- Stores the player directory, active session, confirmed round history, and draft in browser IndexedDB on the current device. No accounts, sync or server database.
- Import/export the whole app state using JSON files. Important on iPhone: Safari and an added home-screen web app may not have identical storage contexts; use the same launch method consistently. Back up regularly.
- Changing attendance/court capacity affects *subsequent* generated rounds. It does not silently change a current draft or confirmed round.
- When editing a previously confirmed round, the original eligible roster is used. Existing player ratings and genders cannot be edited during an active session. New players can be added with a rating.
- No offline support, as requested; an internet connection is required to load the app.
- Gender is recorded as M or F only in this UI and matchmaking engine.

## GitHub Pages deployment

This project includes `.github/workflows/pages.yml`. Push to a **public** GitHub repository named `tennis-organiser`. Under repository **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. Push to `main`; the workflow builds and deploys the site to `https://YOUR_USERNAME.github.io/tennis-organiser/`.

For a different repo name, change `base` in `vite.config.ts` and the workflow's `GITHUB_PAGES` build configuration. A Vite build produces static assets in `dist/`.

## Scope / notes

- The web app does not need a backend or a real-time database.
- Skill score and rest logic are inherited from the v0.1 engine, with the previously discussed gender `X` input removed.
- The editor deliberately supports **swap only** (not court locks or manual court creation).
- Current correction UX allows correcting confirmed rounds. Old confirmed rounds are not re-generated after a correction.
- **UI-first prototype:** it needs browser and device acceptance testing with actual player ratings and across several rounds before relying on it during a real session.
