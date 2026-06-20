/* FB Speed: Feed Declutter
 *
 * Investigation that motivated this (measured live with Chrome DevTools on
 * facebook.com, logged in):
 *   - LCP ~1.5s lab / ~3.0s real users; ~1.2s of it is JS "render delay".
 *   - The feed is virtualized: stories live in `div[data-virtualized]` wrappers
 *     and Facebook already recycles off-screen nodes (DOM stays ~3-6k elements),
 *     so we do NOT need to trim off-screen items ourselves.
 *   - The real DOM cost comes from heavy INJECTED units inside the feed:
 *       * "Your group suggestions" / "Suggested for you" (one unit = ~1500 nodes!)
 *       * Reels tray, Stories tray
 *       * Sponsored posts
 *   - Autoplay videos add CPU (decode) + bandwidth.
 *
 * Strategy: cheaply classify each virtualized story on a throttled sweep and
 * hide the junk units; stop video autoplay once (manual play still works).
 *
 * Note on Sponsored: Facebook scrambles the "Sponsored"/"Được tài trợ" label
 * (decoy characters + CSS reordering) specifically to defeat text matching.
 * We reconstruct the *visually rendered* label in visual order, which catches
 * many but not all ads. For airtight ad blocking, pair this with uBlock Origin.
 */

(() => {
  "use strict";

  const DEFAULTS = {
    hideSponsored: true,
    hideReels: true,
    hideStories: true,
    hideSuggestions: true,
    hideRightRail: false,
    stopAutoplay: true,
  };

  let settings = { ...DEFAULTS };

  // ---- text utilities -------------------------------------------------------

  // Reconstruct the text that is actually painted, in visual (top→left) order,
  // dropping decoy spans that Facebook hides via CSS. Returns lowercased,
  // whitespace-stripped string.
  function paintedVisualText(root) {
    const frags = [];
    const walk = (n) => {
      if (n.nodeType === 3) {
        const p = n.parentElement;
        if (!p) return;
        const cs = getComputedStyle(p);
        if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return;
        if (parseFloat(cs.fontSize) === 0) return;
        if (p.closest('[aria-hidden="true"]')) return;
        const r = p.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (cs.position === "absolute" && (r.left < -4000 || r.top < -4000)) return;
        const t = n.textContent.trim();
        if (t) frags.push({ t, x: r.left, y: r.top });
        return;
      }
      if (n.nodeType !== 1) return;
      for (const c of n.childNodes) walk(c);
    };
    walk(root);
    frags.sort((a, b) => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x));
    return frags.map((f) => f.t).join("").replace(/\s+/g, "").toLowerCase();
  }

  const SPONSORED_NEEDLES = ["sponsored", "đượctàitrợ", "tàitrợ", "quảngcáo"];
  const SUGGEST_NEEDLES = [
    "suggestedforyou",
    "suggestedgroups",
    "yourgroupsuggestions",
    "peopleyoumayknow",
    "peoplealsoshared",
    "reelsandshortvideos",
    "gợiýchobạn",
    "gợiýnhóm",
    "nhữngngườibạncóthểbiết",
    "gợiýtrangchobạn",
  ];

  // ---- classification -------------------------------------------------------

  // Returns one of: 'sponsored' | 'reels' | 'stories' | 'suggestions' | null
  function classify(story) {
    // Stories tray: a row of /stories/ links (or the "Create story" tile).
    if (
      story.querySelector('a[href*="/stories/create"]') ||
      story.querySelectorAll('a[href*="/stories/"]').length >= 3
    ) {
      return "stories";
    }

    // Reels tray: several /reel/ links grouped together (not a normal post that
    // merely links one reel).
    if (story.querySelectorAll('a[href*="/reel/"]').length >= 3) {
      return "reels";
    }

    // Header zone = top ~130px of the story; only look there for labels so we
    // don't misread post body text.
    const storyTop = story.getBoundingClientRect().top;

    // Suggestions: the unit title sits at the very top.
    const headerText = paintedVisualText(story).slice(0, 80);
    if (SUGGEST_NEEDLES.some((n) => headerText.includes(n))) {
      return "suggestions";
    }

    // Sponsored / ads, primary signal.
    // Facebook no longer writes the word "Sponsored" as text: the visible label
    // is built from sprite `<i background-image>` slices (plus shuffled decoys),
    // so text matching is unreliable. Detect ads structurally instead.
    //
    // IMPORTANT: `data-ad-rendering-role` by itself is NOT ad specific. Normal
    // posts tag their own components (profile_name, story_message, like_button,
    // comment_button) with it too, so matching it alone hides real posts. The
    // ad ONLY markers are the comet ad preview wrapper attributes and the call
    // to action role `cta-` (organic posts have no CTA button).
    if (
      story.querySelector("[data-ad-comet-preview], [data-ad-preview]") ||
      story.querySelector('[data-ad-rendering-role="cta-"]')
    ) {
      return "sponsored";
    }

    // Fallback: a few surfaces still render a (scrambled) text label. Reconstruct
    // the visually-painted label in visual order and match localized needles.
    const labels = story.querySelectorAll('a[role="link"], a[aria-label], span');
    for (const el of labels) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.top - storyTop > 130) continue;
      const t = paintedVisualText(el);
      if (t.length >= 6 && t.length <= 40 && SPONSORED_NEEDLES.some((n) => t.includes(n))) {
        return "sponsored";
      }
    }
    return null;
  }

  const TYPE_TO_SETTING = {
    sponsored: "hideSponsored",
    reels: "hideReels",
    stories: "hideStories",
    suggestions: "hideSuggestions",
  };

  // cache: skip re-classifying a wrapper while its content is unchanged
  const cache = new WeakMap(); // story -> contentKey

  // `div[data-virtualized]` is reused by Facebook for OTHER virtualized lists
  // too (notably the Messenger chat list). Only treat wide elements that live in
  // the main column and aren't inside chat/dialog/right-rail as feed stories.
  function isFeedStory(story) {
    if (story.getBoundingClientRect().width < 400) return false;
    if (story.closest('[role="complementary"], [role="dialog"], [role="navigation"]')) return false;
    return true;
  }

  function processStory(story) {
    if (story.childElementCount === 0) return; // recycled/empty slot
    if (!isFeedStory(story)) return;
    const key = (story.textContent || "").slice(0, 64);
    if (cache.get(story) === key && story.dataset.fbspeedType !== undefined) {
      // unchanged; just make sure class reflects current settings
      applyHide(story);
      return;
    }
    cache.set(story, key);
    let type = null;
    try {
      type = classify(story);
    } catch (e) {
      /* defensive: never let classification break the page */
    }
    if (type) story.dataset.fbspeedType = type;
    else delete story.dataset.fbspeedType;
    applyHide(story);
  }

  function applyHide(story) {
    const type = story.dataset.fbspeedType;
    const shouldHide = type && settings[TYPE_TO_SETTING[type]];
    story.classList.toggle("fbspeed-hide", !!shouldHide);
  }

  // ---- autoplay -------------------------------------------------------------

  function tameVideos() {
    if (!settings.stopAutoplay) return;
    for (const v of document.querySelectorAll("video:not([data-fbspeed-seen])")) {
      v.dataset.fbspeedSeen = "1";
      try {
        v.autoplay = false;
        v.preload = "none";
        if (!v.paused) v.pause(); // pause the initial autoplay; manual play still works
      } catch (e) {
        /* ignore */
      }
    }
  }

  // ---- sweep + observe ------------------------------------------------------

  let scheduled = false;
  function scheduleSweep() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      const scope = document.querySelector('[role="main"]') || document.body;
      const stories = scope.querySelectorAll("div[data-virtualized]");
      for (const s of stories) processStory(s);
      tameVideos();
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 800 });
    else setTimeout(run, 200);
  }

  function applyRightRail() {
    document.documentElement.classList.toggle("fbspeed-no-rightrail", !!settings.hideRightRail);
  }

  function start() {
    applyRightRail();
    scheduleSweep();

    // Throttled observer: only react to subtree changes, coalesced into one sweep.
    const root = document.querySelector('[role="main"]') || document.body;
    const obs = new MutationObserver(() => scheduleSweep());
    obs.observe(document.body, { childList: true, subtree: true });

    // Safety net for virtualization reuse + late-loaded units.
    setInterval(scheduleSweep, 1500);
  }

  // ---- settings wiring ------------------------------------------------------

  function loadSettings(cb) {
    try {
      chrome.storage.sync.get(DEFAULTS, (loaded) => {
        settings = { ...DEFAULTS, ...loaded };
        cb();
      });
    } catch (e) {
      settings = { ...DEFAULTS };
      cb();
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
      applyRightRail();
      // re-evaluate everything against new settings
      const scope = document.querySelector('[role="main"]') || document.body;
      for (const s of scope.querySelectorAll("div[data-virtualized]")) applyHide(s);
      scheduleSweep();
    });
  } catch (e) {
    /* storage may be unavailable in odd contexts */
  }

  const boot = () => loadSettings(start);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
