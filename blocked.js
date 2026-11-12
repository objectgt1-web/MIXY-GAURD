
const form = document.getElementById("bypassForm");
const passwordInput = document.getElementById("password");
const error = document.getElementById("error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const tab = await chrome.tabs.getCurrent();

  if (!tab || tab.id === undefined) {
    error.textContent = "Could not identify this tab";
    return;
  }

  chrome.runtime.sendMessage({
    action: "UNLOCK_TAB",
    password: passwordInput.value,
    tabId: tab.id
  }, (response) => {
    if (chrome.runtime.lastError) {
      error.textContent = "Extension communication failed";
      return;
    }

    if (response?.success) {
      error.textContent = "Access granted";
    } else {
      error.textContent = "Incorrect password";
    }
  });
});
