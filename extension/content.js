(async function ReplayVaultEngine() {
  // Obtain routing environment state validations
  const environmentContext = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CHECK_STREAMING_TARGET" }, (response) => {
      resolve(response || { isTarget: false, fallbackTitle: "Streaming Video", parentUrl: window.location.href });
    });
  });

  if (!environmentContext.isTarget) return;

  let activeVideoElement = null;
  let saveIntervalTimer = null;
  let hasPromptedForResume = false;
  
  // Track bound videos to support multi-video architectures and avoid duplicate listeners
  const initializedVideos = new WeakSet();

  function generateMediaStorageKey() {
    const title = extractMediaTitle();
    const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return `rv_progress_${sanitizedTitle}`;
  }

  function extractMediaTitle() {
    const selectiveSelectors = [
      'h1.title', 'h1.heading', '.video-title', '.movie-title', 
      '.episode-name', 'title', 'h2.entry-title', '.player-heading'
    ];
    
    for (const selector of selectiveSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim().length > 0) {
        let text = el.textContent.trim();
        if (selector === 'title') {
          text = text.replace(/(-\s*Watch\s*Free|Watch\s*Online|Soap2day|Cineby|Movies|Free\s*Streaming)/gi, '').trim();
        }
        return text;
      }
    }
    return environmentContext.fallbackTitle || window.location.pathname;
  }

  function dispatchProgressSync() {
    if (!activeVideoElement || !activeVideoElement.currentTime) return;

    const storageKey = generateMediaStorageKey();
    const duration = activeVideoElement.duration || 0;
    const progressRatio = activeVideoElement.currentTime / (duration || 1);

    // Clean up history automatically if the video is practically finished (credits rolling)
    if (progressRatio > 0.96) {
      chrome.runtime.sendMessage({
        type: "REMOVE_PROGRESS",
        storageKey: storageKey
      });
      return;
    }

    // Extract site name and determine if it's a Movie or Show based on the URL
    let siteName = "Unknown";
    let mediaType = "Movie"; // Default fallback
    try {
      const urlObj = new URL(environmentContext.parentUrl);
      let hostname = urlObj.hostname.replace(/^www\./, '');
      let siteParts = hostname.split('.');
      let rawSiteName = siteParts.length > 1 ? siteParts[siteParts.length - 2] : siteParts[0];
      siteName = rawSiteName.charAt(0).toUpperCase() + rawSiteName.slice(1); // Capitalize first letter

      const path = urlObj.pathname.toLowerCase();
      if (path.match(/\/(tv|series|show|episode|season)(-|\/|$)/) || path.includes('-season-') || path.includes('-episode-') || path.includes('series')) {
        mediaType = "Show";
      } else if (path.match(/\/(movie)(-|\/|$)/)) {
        mediaType = "Movie";
      }
    } catch(e) {
      // Keep defaults if parsing fails
    }

    const payload = {
      title: extractMediaTitle(),
      siteName: siteName,
      mediaType: mediaType,
      timestamp: activeVideoElement.currentTime,
      duration: duration,
      percentage: progressRatio * 100,
      savedAt: Date.now(),
      url: environmentContext.parentUrl
    };

    chrome.runtime.sendMessage({
      type: "SAVE_PROGRESS",
      storageKey: storageKey,
      payload: payload
    });
  }

  function showResumePrompt(savedTime) {
    if (hasPromptedForResume) return;
    hasPromptedForResume = true;

    const formatTime = (secs) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const container = document.createElement('div');
    container.id = "replayvault-resume-overlay";
    container.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #1a1a1e;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 16px 24px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #e4e4e7;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      text-align: center;
      min-width: 300px;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    `;

    container.innerHTML = `
      <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px; letter-spacing: -0.3px; color: #ffffff;">ReplayVault</div>
      <div style="font-size: 12px; margin-bottom: 14px; color: #a1a1aa; font-weight: 400;">Resume watching from <span style="color: #3b82f6; font-weight: 600;">${formatTime(savedTime)}</span>?</div>
      <div style="display: flex; gap: 8px; justify-content: center;">
        <button id="rv-btn-resume" style="background: #3b82f6; border: 1px solid #3b82f6; color: white; padding: 6px 16px; border-radius: 6px; font-weight: 500; cursor: pointer; font-size: 11px; transition: background 0.15s ease;">Resume</button>
        <button id="rv-btn-startover" style="background: #27272a; border: 1px solid #3f3f46; color: #f4f4f5; padding: 6px 16px; border-radius: 6px; font-weight: 500; cursor: pointer; font-size: 11px; transition: background 0.15s ease, border-color 0.15s ease;">Restart</button>
      </div>
    `;

    const hoverStyles = document.createElement('style');
    hoverStyles.innerHTML = `
      #rv-btn-resume:hover { background: #2563eb; border-color: #2563eb; }
      #rv-btn-startover:hover { background: #3f3f46; border-color: #52525b; }
    `;
    container.appendChild(hoverStyles);

    // Append to fullscreen container if user opened a tab straight into full screen
    const mountTarget = document.fullscreenElement || document.body;
    mountTarget.appendChild(container);

    const executeResume = () => {
      activeVideoElement.currentTime = Math.max(0, savedTime - 4);
      activeVideoElement.play().catch(() => {});
      cleanupPrompt();
    };

    const executeRestart = () => {
      activeVideoElement.currentTime = 0;
      activeVideoElement.play().catch(() => {});
      cleanupPrompt();
    };

    const cleanupPrompt = () => {
      window.removeEventListener('keydown', handleKeydown);
      container.remove();
    };

    // Keyboard handling for hands-free and fullscreen control
    const handleKeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        executeResume();
      } else if (e.key === "Escape") {
        e.preventDefault();
        executeRestart();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    document.getElementById('rv-btn-resume').addEventListener('click', executeResume);
    document.getElementById('rv-btn-startover').addEventListener('click', executeRestart);

    setTimeout(() => { cleanupPrompt(); }, 14000);
  }

  function initializeVideoTracking(videoNode) {
    if (!videoNode) return;
    activeVideoElement = videoNode;

    // Feature: Automatically restore and remember media preferences (Volume and Playback Rate) per streaming portal
    try {
      const hostKey = window.location.hostname.replace(/^www\./, '');
      chrome.storage.local.get([`rv_vol_${hostKey}`, `rv_spd_${hostKey}`], (prefs) => {
        if (prefs && prefs[`rv_vol_${hostKey}`] !== undefined) {
          videoNode.volume = prefs[`rv_vol_${hostKey}`];
        }
        if (prefs && prefs[`rv_spd_${hostKey}`] !== undefined) {
          videoNode.playbackRate = prefs[`rv_spd_${hostKey}`];
        }
      });

      videoNode.addEventListener('volumechange', () => {
        chrome.storage.local.set({ [`rv_vol_${hostKey}`]: videoNode.volume });
      });
      videoNode.addEventListener('ratechange', () => {
        if (videoNode.playbackRate > 0) {
          chrome.storage.local.set({ [`rv_spd_${hostKey}`]: videoNode.playbackRate });
        }
      });
    } catch (err) {
      // Gracefully catch background extension state connection drop exceptions
    }

    // Direct timestamp jump detection via custom URL parameter parameter mapping
    const urlParams = new URLSearchParams(window.location.search);
    const directTimeParam = parseFloat(urlParams.get('rv_t'));

    if (!isNaN(directTimeParam) && directTimeParam > 0) {
      hasPromptedForResume = true; 
      videoNode.currentTime = Math.max(0, directTimeParam - 2);
      videoNode.play().catch(() => {});
    } else {
      const storageKey = generateMediaStorageKey();
      chrome.storage.local.get([storageKey], (result) => {
        if (result && result[storageKey]) {
          const record = result[storageKey];
          if (record.timestamp > 5 && (record.timestamp / record.duration) < 0.96) {
            showResumePrompt(record.timestamp);
          }
        }
      });
    }

    if (saveIntervalTimer) clearInterval(saveIntervalTimer);
    saveIntervalTimer = setInterval(dispatchProgressSync, 5000);

    videoNode.addEventListener('pause', dispatchProgressSync);
    videoNode.addEventListener('ended', () => {
      chrome.storage.local.remove(generateMediaStorageKey());
    });
  }

  function locateAndBindVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      if (!initializedVideos.has(video)) {
        initializedVideos.add(video);
        initializeVideoTracking(video);
      }
    });
  }

  const mutationObserver = new MutationObserver(() => {
    locateAndBindVideos();
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

  const backupPoller = setInterval(locateAndBindVideos, 1500);
  locateAndBindVideos();

  window.addEventListener('beforeunload', () => {
    clearInterval(backupPoller);
    dispatchProgressSync();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') dispatchProgressSync();
  });
})();