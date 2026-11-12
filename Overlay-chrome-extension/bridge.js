/* ============================================================
   Overlay MatchTimer — isolated-world storage bridge
   MAIN-world content.js cannot touch chrome.storage; this script
   mirrors chrome.storage.local <-> localStorage + postMessage.
   ============================================================ */
(function () {
  'use strict';

  const KEY_AUTO_VOD = 'omtAutoSwitchVod';
  const DEFAULTS = { [KEY_AUTO_VOD]: true };

  function syncToPage(values) {
    try {
      if (Object.prototype.hasOwnProperty.call(values, KEY_AUTO_VOD)) {
        localStorage.setItem(KEY_AUTO_VOD, values[KEY_AUTO_VOD] ? 'true' : 'false');
      }
    } catch (_) {}
    try {
      window.postMessage({ source: 'omt-bridge', type: 'OMT_STORAGE_SYNC', values }, '*');
    } catch (_) {}
  }

  function loadAndSync() {
    try {
      chrome.storage.local.get(DEFAULTS, (result) => {
        syncToPage(result || DEFAULTS);
      });
    } catch (_) {
      syncToPage(DEFAULTS);
    }
  }

  loadAndSync();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const values = {};
      Object.keys(changes).forEach((k) => {
        values[k] = changes[k].newValue;
      });
      syncToPage(values);
    });
  } catch (_) {}

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'omt-page' || data.type !== 'OMT_STORAGE_SET') return;
    const payload = {};
    payload[data.key] = data.value;
    try {
      chrome.storage.local.set(payload, () => syncToPage(payload));
    } catch (_) {
      syncToPage(payload);
    }
  });
})();
