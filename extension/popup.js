document.addEventListener("DOMContentLoaded", () => {
  const historyList = document.getElementById("history-list");
  const searchBar = document.getElementById("search-bar");
  const btnClearAll = document.getElementById("btn-clear-all");
  const historyCount = document.getElementById("history-count");

  // New UI Element Selectors
  const btnSettings = document.getElementById("btn-settings");
  const btnBack = document.getElementById("btn-back");
  const mainViewControls = document.getElementById("main-view-controls");
  const settingsView = document.getElementById("settings-view");
  const usernameInput = document.getElementById("username-input");
  const welcomeTagline = document.getElementById("welcome-tagline");

  let allRecords = [];

  // Feature: Render structured human-readable time strings
  function formatTimeAgo(timestamp) {
    if (!timestamp) return "";
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    return `${days}d ago`;
  }

  function renderHistory(filterText = "") {
    chrome.storage.local.get(null, (items) => {
      // Load saved username configuration preference layout updates
      if (items.rv_user_profile_name) {
        usernameInput.value = items.rv_user_profile_name;
        welcomeTagline.textContent = `Welcome back, ${items.rv_user_profile_name}!`;
      } else {
        welcomeTagline.textContent = "Never lose your place again.";
      }

      historyList.innerHTML = "";
      
      allRecords = Object.keys(items)
        .filter(key => key.startsWith("rv_progress_"))
        .map(key => ({ key, ...items[key] }))
        .sort((a, b) => b.savedAt - a.savedAt);

      const filteredRecords = allRecords.filter(record => 
        (record.title || "").toLowerCase().includes(filterText.toLowerCase())
      );

      historyCount.textContent = `${filteredRecords.length} item${filteredRecords.length !== 1 ? 's' : ''}`;

      if (filteredRecords.length === 0) {
        historyList.innerHTML = `<div class="empty-state">${filterText ? 'No matching videos found.' : 'No media files currently cached.'}</div>`;
        return;
      }

      filteredRecords.forEach(record => {
        const item = document.createElement("div");
        item.className = "history-item";

        const minutes = Math.floor(record.timestamp / 60);
        const totalMinutes = Math.floor(record.duration / 60) || 0;
        const remainingMinutes = Math.max(0, totalMinutes - minutes);

        item.innerHTML = `
          <button class="btn-delete" data-key="${record.key}" title="Delete entry">✕</button>
          <div class="item-context" title="${record.siteName || "Unknown Site"}">
            ${record.siteName || "Unknown"} / ${record.mediaType || "Media"}
            <span class="item-time-ago">${formatTimeAgo(record.savedAt)}</span>
          </div>
          <div class="item-title" title="${record.title}">${record.title || "Unknown Title"}</div>
          <div class="item-meta">
            Position: ${minutes}m ${totalMinutes > 0 ? `/ ${totalMinutes}m` : ''} 
            ${remainingMinutes > 0 ? `• ${remainingMinutes}m left` : ''}
          </div>
          <div class="progress-container">
            <div class="progress-bar" style="width: ${record.percentage || 0}%"></div>
          </div>
        `;

        item.querySelector(".btn-delete").addEventListener("click", (e) => {
          e.stopPropagation(); 
          const targetKey = e.currentTarget.getAttribute("data-key");
          chrome.storage.local.remove(targetKey, () => {
            renderHistory(searchBar.value);
          });
        });

        // Appends timestamp target as a query parameter directly into URL execution routing
        item.addEventListener("click", () => {
          if (record.url) {
            try {
              const trackingUrl = new URL(record.url);
              trackingUrl.searchParams.set('rv_t', Math.floor(record.timestamp).toString());
              chrome.tabs.create({ url: trackingUrl.toString() });
            } catch (err) {
              chrome.tabs.create({ url: record.url });
            }
          }
        });

        historyList.appendChild(item);
      });
    });
  }

  searchBar.addEventListener("input", (e) => {
    renderHistory(e.target.value);
  });

  btnClearAll.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear your entire watch history?")) {
      const keysToRemove = allRecords.map(r => r.key);
      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove, () => {
          searchBar.value = "";
          renderHistory();
        });
      }
    }
  });

  // Settings Panel Routing Toggles
  btnSettings.addEventListener("click", () => {
    mainViewControls.classList.add("hidden");
    settingsView.classList.remove("hidden");
  });

  btnBack.addEventListener("click", () => {
    settingsView.classList.add("hidden");
    mainViewControls.classList.remove("hidden");
    renderHistory(searchBar.value); // Sync title configuration changes if needed
  });

  // Automatically save configuration options on user profiles input
  usernameInput.addEventListener("input", (e) => {
    const newName = e.target.value.trim();
    chrome.storage.local.set({ rv_user_profile_name: newName }, () => {
      welcomeTagline.textContent = newName ? `Welcome back, ${newName}!` : "Never lose your place again.";
    });
  });

  // Launch links via custom action buttons mapped straight to chrome tab creations
  document.querySelectorAll(".btn-stream").forEach(button => {
    button.addEventListener("click", (e) => {
      const externalTargetUrl = e.currentTarget.getAttribute("data-url");
      if (externalTargetUrl) {
        chrome.tabs.create({ url: externalTargetUrl });
      }
    });
  });

  renderHistory();
});