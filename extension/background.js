const CORE_STREAMING_SIGNATURES = [
  'soap2day', 'cineby', 'vidbox', 'lookmovie', 'movie-web', 
  'braflix', 'binged', 'hydrahd', 'fmovies', '123movies', 
  'bflix', 'sflix', 'hurawatch', 'watchseries', 'gomovies', 
  'myflixer', 'putlocker', 'vidplay', 'mycloud', 'filemoon', 
  'vidsrc', 'vizcloud', 'mcloud', 'rabbitstream'
];

function isTargetStreamingSite(urlStr) {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    return CORE_STREAMING_SIGNATURES.some(signature => hostname.includes(signature));
  } catch (e) {
    return false;
  }
}

const tabTitleCache = {};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && isTargetStreamingSite(tab.url) && tab.title) {
    tabTitleCache[tabId] = tab.title.replace(/(-\s*Watch\s*Free|Watch\s*Online|Soap2day|Cineby|Movies|Free\s*Streaming)/gi, '').trim();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_STREAMING_TARGET") {
    const tabUrl = sender.tab ? sender.tab.url : '';
    const frameUrl = sender.url || '';
    
    const isTarget = isTargetStreamingSite(tabUrl) || isTargetStreamingSite(frameUrl);
    
    let resolvedTitle = "Streaming Video";
    if (sender.tab && sender.tab.id && tabTitleCache[sender.tab.id]) {
      resolvedTitle = tabTitleCache[sender.tab.id];
    } else if (sender.tab && sender.tab.title) {
      resolvedTitle = sender.tab.title.replace(/(-\s*Watch\s*Free|Watch\s*Online|Soap2day|Cineby|Movies|Free\s*Streaming)/gi, '').trim();
    }

    sendResponse({ 
      isTarget: isTarget, 
      fallbackTitle: resolvedTitle,
      parentUrl: tabUrl || frameUrl 
    });
    return true;
  }

  if (message.type === "SAVE_PROGRESS") {
    const { storageKey, payload } = message;
    
    // Core Fix: Dynamically hook the top-level tab context window URL to stop layout/iframe routing data loss
    if (sender.tab && sender.tab.url) {
      payload.url = sender.tab.url;
      
      try {
        const urlObj = new URL(sender.tab.url);
        let hostname = urlObj.hostname.replace(/^www\./, '');
        let siteParts = hostname.split('.');
        let rawSiteName = siteParts.length > 1 ? siteParts[siteParts.length - 2] : siteParts[0];
        payload.siteName = rawSiteName.charAt(0).toUpperCase() + rawSiteName.slice(1);

        const path = urlObj.pathname.toLowerCase();
        if (path.match(/\/(tv|series|show|episode|season)(-|\/|$)/) || path.includes('-season-') || path.includes('-episode-') || path.includes('series')) {
          payload.mediaType = "Show";
        } else if (path.match(/\/(movie)(-|\/|$)/)) {
          payload.mediaType = "Movie";
        }
      } catch(e) {
        // Retain properties payload if data modeling parsing fails
      }
    }

    chrome.storage.local.set({ [storageKey]: payload }, () => {
      if (chrome.runtime.lastError) {
        console.error("ReplayVault Engine Save Error:", chrome.runtime.lastError);
      }
    });
    sendResponse({ status: "success" });
    return true;
  }

  if (message.type === "REMOVE_PROGRESS") {
    const { storageKey } = message;
    chrome.storage.local.remove(storageKey, () => {
      if (chrome.runtime.lastError) {
        console.error("ReplayVault Engine Removal Error:", chrome.runtime.lastError);
      }
    });
    sendResponse({ status: "removed" });
    return true;
  }
});