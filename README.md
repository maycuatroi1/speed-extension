# FB Speed: Feed Declutter

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

- **Suggestions**: "Your group suggestions", "Suggested for you", "People you may know" (heaviest)
- **Reels tray**
- **Stories tray**
- **Sponsored**: best-effort (see caveat)
- **Stop autoplay**: pauses videos once on appearance; manual click-to-play still works
- **Hide right rail**: optional (off by default)

All features are toggles in the popup; settings persist via `chrome.storage.sync`.

### How Sponsored detection works

Facebook no longer renders the word "Sponsored" / "Được tài trợ" as text: the
visible label is assembled from **sprite image slices** (`<i background-image>`
with shuffled `background-position`, plus decoys) specifically to defeat text
matching.

Instead of trying to decode the sprite, this extension keys off the structural
markup Facebook uses to *build* an ad: every ad's sub-components are tagged with
**`data-ad-rendering-role`** (`profile_name`, `story_message`, `cta-`, `title`,
`like_button`, …) and the wrapper carries **`data-ad-comet-preview` /
`data-ad-preview`**. Those attributes appear only on ads, so the ad is detected
reliably regardless of how the label is obfuscated. (A visual-order text
reconstruction is kept as a fallback for surfaces that still use a text label.)

Verified live: a real sponsored post (VietnamWorks ad) was caught while
scrolling and hidden (`display: none`). If Facebook renames these attributes,
update the selector in `classify()`; for a second layer, pair with **uBlock
Origin**.

## Install

On another machine, first get the code:

```bash
git clone https://github.com/maycuatroi1/speed-extension.git
```

> Note: Chrome (stable, v137+) **no longer honors `--load-extension` from the
> command line**, so the last step must happen in the UI.

**Quick (Windows):** run the helper: it pulls the latest, copies the folder
path to your clipboard, and opens the extensions page:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

**Manual (any OS):**

1. Open `chrome://extensions/`
2. Toggle **Developer mode** (top-right) on
3. Click **Load unpacked** and select this `speed-extension/` folder
4. Open/refresh facebook.com: junk units disappear; click the toolbar icon to toggle features

After updating the code, click the **reload** (⟳) icon on the extension card.

## Verified

End-to-end test (extension loaded, logged-in feed): the content script ran
(autoplay tamed), and the **Stories tray and Reels tray were hidden**
(`display: none`, ~600 DOM nodes removed) with **zero false positives** on real
posts.

## Files

- `manifest.json`: MV3 manifest (content script + popup)
- `content.js`: classification + hiding + autoplay logic
- `content.css`: `.fbspeed-hide` + right-rail rule
- `popup.html` / `popup.js`: feature toggles

## Tuning

If Facebook changes its markup and something stops being hidden, the selectors to
update live in `content.js`: `classify()` (unit detection) and the
`SUGGEST_NEEDLES` / `SPONSORED_NEEDLES` lists.
