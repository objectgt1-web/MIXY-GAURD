
const enabled = document.getElementById("enabled");
const statusText = document.getElementById("status");
const siteList = document.getElementById("siteList");
const form = document.getElementById("addForm");
const domainInput = document.getElementById("domain");

async function render() {
  const data = await chrome.storage.local.get({
    enabled: true,
    blockedSites: []
  });

  enabled.checked = data.enabled;
  statusText.textContent = data.enabled
    ? "Protection is active"
    : "Protection is disabled";

  siteList.innerHTML = "";

  data.blockedSites.forEach(site => {
    const item = document.createElement("div");
    item.className = "site";

    const name = document.createElement("span");
    name.textContent = site;

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "REMOVE";

    remove.addEventListener("click", async () => {
      const current = await chrome.storage.local.get({
        blockedSites: []
      });

      await chrome.storage.local.set({
        blockedSites: current.blockedSites.filter(
          value => value !== site
        )
      });

      render();
    });

    item.append(name, remove);
    siteList.appendChild(item);
  });
}

enabled.addEventListener("change", async () => {
  await chrome.storage.local.set({
    enabled: enabled.checked
  });

  render();
});

form.addEventListener("submit", async event => {
  event.preventDefault();

  let domain = domainInput.value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];

  if (
    domain.length > 253 ||
    !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) {
    alert("Enter a valid domain like example.com");
    return;
  }

  const data = await chrome.storage.local.get({
    blockedSites: []
  });

  if (!data.blockedSites.includes(domain)) {
    await chrome.storage.local.set({
      blockedSites: [...data.blockedSites, domain]
    });
  }

  domainInput.value = "";
  render();
});

render();
