
const DEFAULTS = {
  enabled: true,
  blockedSites: []
};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(DEFAULTS);

  await chrome.storage.local.set({
    enabled: data.enabled,
    blockedSites: data.blockedSites
  });

  await updateRules();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    updateRules();
  }
});

async function updateRules() {
  const { enabled, blockedSites = [] } =
    await chrome.storage.local.get(DEFAULTS);

  const existing = await chrome.declarativeNetRequest
    .getDynamicRules();

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(rule => rule.id),
    addRules: enabled
      ? blockedSites.map((site, index) => ({
          id: index + 1,
          priority: 1,
          action: { type: "block" },
          condition: {
            urlFilter: `||${site}^`,
            resourceTypes: ["main_frame"]
          }
        }))
      : []
  });
}
