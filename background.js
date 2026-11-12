
let updateQueue = Promise.resolve();

async function loadBlockedSites() {
  const response = await fetch(
    chrome.runtime.getURL("blocked-sites.json")
  );

  if (!response.ok) {
    throw new Error("Could not load blocked-sites.json");
  }

  const data = await response.json();
  const categories = data.categories || {};

  const sites = Object.values(categories)
    .flat()
    .map(site => String(site).trim().toLowerCase())
    .filter(site =>
      /^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)
    );

  return [...new Set(sites)];
}

async function updateRules() {
  const sites = await loadBlockedSites();

  const oldRules =
    await chrome.declarativeNetRequest.getDynamicRules();

  const newRules = sites.map((site, index) => ({
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
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRules.map(rule => rule.id),
    addRules: newRules
  });

  console.log("MIXY GUARD loaded", sites.length, "blocked sites");
}

function refreshRules() {
  updateQueue = updateQueue
    .then(updateRules)
    .catch(error => console.error("MIXY GUARD:", error));

  return updateQueue;
}

chrome.runtime.onInstalled.addListener(refreshRules);
chrome.runtime.onStartup.addListener(refreshRules);

refreshRules();
