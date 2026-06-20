const DEFAULTS = {
  hideSponsored: true,
  hideReels: true,
  hideStories: true,
  hideSuggestions: true,
  hideRightRail: false,
  stopAutoplay: true,
};

const ids = Object.keys(DEFAULTS);

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = !!s[id];
    el.addEventListener("change", () => {
      chrome.storage.sync.set({ [id]: el.checked });
    });
  }
});
