
async function updateRules() {
  const { enabled = true, blockedSites = ["youtube.com"] } =
    await chrome.storage.local.get(["enabled", "blockedSites"]);

  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();

  const rules = enabled
    ? blockedSites.map((site, index) => ({
        id: index + 1,
        priority: 1,
        action: {
  type: "redirect",
  redirect: {
    extensionPath: "/blocked.html"
  }
},
        condition: {
          urlFilter: `||${site}^`,
          resourceTypes: ["main_frame"]
        }
      }))
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRules.map(rule => rule.id),
    addRules: rules
  });

  console.log("MIXY GUARD rules updated:", rules);
}

chrome.runtime.onInstalled.addListener(updateRules);
chrome.runtime.onStartup.addListener(updateRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") updateRules();
});

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info => {
  console.log("MIXY GUARD BLOCKED:", info);
});

updateRules();
