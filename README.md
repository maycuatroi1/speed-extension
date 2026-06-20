# FB Speed — Feed Declutter

A tiny Manifest V3 Chrome extension that makes facebook.com lighter by removing
the heaviest, lowest-value parts of the feed and stopping video autoplay.

## Why these features (measured, not guessed)

Profiled live on facebook.com (logged in) with Chrome DevTools:

| Signal | Measurement | Takeaway |
|---|---|---|
| LCP | ~1.5s lab / **~3.0s real users (p75)** | ~1.2s is JS **render delay**, not network |
| TTFB | 247 ms | server/network is **fine** |
| DOM | 3168 elements, depth 58, style recalc **202 ms** | DOM cost is real |
| Heavy feed units | "Your group suggestions" alone = **~1500 DOM nodes**; Reels/Stories trays = 260–340 each | biggest cheap win is removing these |
| Route change (open a group) | **~3.9 MB / 151 requests / 51 XHR** | navigation is expensive |
| Feed virtualization | DOM stays bounded (~3–6k) while scrolling | Facebook **already recycles** off-screen items, so we don't trim them |

Conclusion: Facebook is slow because of **JavaScript + DOM weight + autoplay**,
not the network. So this extension cuts DOM-heavy injected units and stops
autoplay instead of trying to optimize requests.

## What it does

Each feed story lives in a `div[data-virtualized]` wrapper. On a throttled,
idle-time sweep the content script classifies each story (scoped to the main
feed column, ignoring the Messenger chat list which reuses the same wrapper) and
hides the junk ones:

- **Suggestions** — "Your group suggestions", "Suggested for you", "People you may know" (heaviest)
- **Reels tray**
- **Stories tray**
- **Sponsored** — best-effort (see caveat)
- **Stop autoplay** — pauses videos once on appearance; manual click-to-play still works
- **Hide right rail** — optional (off by default)

All features are toggles in the popup; settings persist via `chrome.storage.sync`.

### Sponsored caveat

Facebook deliberately scrambles the "Sponsored" / "Được tài trợ" label (decoy
characters + CSS reordering) to defeat text matching. This extension
reconstructs the *visually rendered* label in visual order, which catches many
ads but **not all**. For airtight ad blocking, pair this with **uBlock Origin**
(it has a maintained Facebook filter list).

## Install

> Note: Chrome (stable, v137+) **no longer honors `--load-extension` from the
> command line**. Load it through the UI:

1. Open `chrome://extensions/`
2. Toggle **Developer mode** (top-right) on
3. Click **Load unpacked** and select this `speed-extension/` folder
4. Open/refresh facebook.com — junk units disappear; click the toolbar icon to toggle features

## Verified

End-to-end test (extension loaded, logged-in feed): the content script ran
(autoplay tamed), and the **Stories tray and Reels tray were hidden**
(`display: none`, ~600 DOM nodes removed) with **zero false positives** on real
posts.

## Files

- `manifest.json` — MV3 manifest (content script + popup)
- `content.js` — classification + hiding + autoplay logic
- `content.css` — `.fbspeed-hide` + right-rail rule
- `popup.html` / `popup.js` — feature toggles

## Tuning

If Facebook changes its markup and something stops being hidden, the selectors to
update live in `content.js`: `classify()` (unit detection) and the
`SUGGEST_NEEDLES` / `SPONSORED_NEEDLES` lists.
