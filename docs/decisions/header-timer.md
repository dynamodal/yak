# Header timer and running cue: decisions to review

The running timer is visible and controllable on every page, and a minimised window still shows whether it runs.
Each row says what was decided, why, and how to change it.

| # | Decision | Why | How to change it |
| --- | --- | --- | --- |
| H1 | A new `registerHeaderItem` slot in `src/app/registry.ts`, rendered by `App.tsx` right after the app name | The shell must not import a feature module; neither `registerGlobal` (above the navigation) nor `registerBanner` (above the view) is in the header | Drop the slot and render the control as a global, at the cost of a second bar under the header |
| H2 | The header timer shows on every view, the Timer page included | The same control in the same place on every page is easier to learn than one that comes and goes; on the Timer page it duplicates the big Stop button | Hide it on `#/timer` in `HeaderTimer.tsx` (read the route with `useRoute`) |
| H3 | Running: project colour, description (opens the Timer page), elapsed time, Stop. Stopped: Start, "Not tracking" (opens the Timer page), and Continue with the last entry's description | As asked; Start and Continue cover the two ways a Toggl desktop user restarts work without opening the app | `HeaderTimer.tsx` |
| H4 | Start in the header starts an empty entry in the active space and stays on the current page | Starting must be one click from anywhere; the description can be filled in later on the Timer page, as with Toggl | Navigate to `#/timer` and focus the description after starting |
| H5 | "Continue last entry" continues the entry that stopped last, in any space, in that entry's space | Matches "the work I was just doing"; continuing in the active space instead could put work time in Personal | `lastStopped` in `src/time/cue.ts` |
| H6 | Title while running: `▶ 0:12:34 Description – Yak`; while stopped: `◼ Not tracking – Yak` | The taskbar cuts the title off from the right, so the mark and the time come first; the stopped marker is words as well as a symbol so it cannot be mistaken for a paused clock | `cueTitle` in `src/time/cue.ts` |
| H7 | A hidden page shows `H:MM` instead of `H:MM:SS` in the title | Chrome slows timers in hidden tabs to about once a minute, so seconds would look frozen or jump | `formatElapsed` in `src/time/cue.ts` |
| H8 | Descriptions in the title are cut to 40 characters with an ellipsis | Only the start shows in a taskbar or tab; long Markdown-ish text would push the app name out of reach | `TITLE_DESCRIPTION_MAX` in `src/time/cue.ts` |
| H9 | Favicon: own SVGs, a green disc with a white play triangle while running and a grey ring with a square while stopped | Two shapes as well as two colours, so the cue survives colour blindness and a 16 px icon; nothing borrowed from Toggl | `src/time/icons/*.svg` |
| H10 | The favicons are bundled as hashed files, never as `data:` URIs (`assetsInlineLimit` keeps SVGs as files) | Same-origin as asked; hashed files are in the service worker's precache, so the cue also works offline | `vite.config.ts` |
| H11 | The `<link rel="icon">` is created by the time module at start-up, not written in `index.html` | `index.html` is the shell's; a link to a time-module file there would couple them | `setFavicon` in `src/time/TimerCue.tsx` |
| H12 | App badge: a plain badge (a dot, no number) while running, cleared when stopped; cleared once at start-up too | A number would have to change every minute and is hard to read; clearing at start-up removes a badge left by a closed window. Feature-detected; refusals are ignored | `applyBadge` in `src/time/cue.ts` |
| H13 | Running is marked with the existing `--ok` token (green) | No `--running` token exists yet; the theme-tokens branch plans one | Switch `time.css` to `--running` once `src/app/theme/tokens.css` lands |
| H14 | The play, stop and continue glyphs are small inline SVGs in `HeaderTimer.tsx` | The shared icon module (`src/app/ui/icons.tsx`) is not on `main` yet | Move them there when it lands |
| H15 | Header layout (#132, replaces the own-row rule): one row on screens ≥ 64 rem (`name | tabs | timer | status dot`); 40–64 rem: name, timer and dot on row one, tabs on row two; ≤ 40 rem: the name is hidden, the timer and dot are row one, the tabs row two. The header, tabs included, is sticky | The own timer row cost about 50 px on a phone and the banner and chip rows more; the header timer keeps its slot (H1) and sits next to the status dot in `.topbar-end` | `@media` blocks in `app.css`; `.header-timer` in `time.css` |
| H-21 | **Header start uses the bar's draft (#21).** The Timer bar's draft (description, project, tags, billable) lives in a small module store (`src/time/timer-draft.ts`) instead of the bar's state, so the header ▶ starts with it and clears it, as the bar's own start does. Header buttons are 44 px below 40 rem or on a coarse pointer; below 40 rem "Continue" is its icon only (the name stays in its label and title) | A draft typed on Timer was lost by the header ▶; phone taps missed 32 px targets |

## Browser assumptions and fallbacks

- `document.title` and `<link rel="icon">` changes work in every browser; some browsers show favicon changes only for the active tab or after a short delay.
- `navigator.setAppBadge` / `clearAppBadge` exist only in Chrome and Edge, and show only for an installed app; elsewhere nothing happens and the title and favicon carry the cue.
- Hidden tabs tick about once a minute (H7), so a minimised window's title can lag the real time by up to a minute.

## Tests

- Unit: `src/time/cue.test.ts` (title formats, hidden-page precision, shortening, negative time, badge set, clear, missing API and refusals, last stopped entry across spaces).
- Browser: `scripts/e2e/header-timer.mjs` (start on Timer, stop from the header on Notes, title, favicon and badge follow, continue and start from the header, one running timer across spaces, reload, 375 px on seven views).
