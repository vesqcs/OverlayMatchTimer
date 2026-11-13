/* ============================================================
   Overlay MatchTimer — isolated-world storage bridge
   MAIN-world content.js cannot touch chrome.storage; this script
   mirrors chrome.storage.local <-> localStorage + postMessage.
   Also used by the toolbar popup (writes) so in-page UI stays in sync.
   Kickoff-sync relay is active ONLY when OMT_SYNC_FEATURE_ENABLED.
   ============================================================ */
(function () {
  'use strict';

  const SYNC_FEATURE = (typeof OMT_SYNC_FEATURE_ENABLED !== 'undefined') && !!OMT_SYNC_FEATURE_ENABLED;

  const KEY_AUTO_VOD = 'omtAutoSwitchVod';
  const KEY_SHUTTLE = 'shuttleXpressEnabled';
  const KEY_AUTO_PAUSE = 'omtAutoPauseOnBlur';
  const KEY_CLOCK_POS = 'omtClockPosition';
  const KEY_CLOCK_SIZE = 'omtClockSize';
  const KEY_CLOCK_SHAPE = 'omtClockShape';
  const KEY_CLOCK_CUSTOM = 'omtClockCustomOffset';
  const KEY_HOTKEYS = 'omtHotkeys';
  const KEY_SHUTTLE_PREFS = 'omtShuttlePrefs';
  const KEY_SYNC_ENABLED = 'omtKickoffSyncEnabled';
  const KEY_SYNC_URL = 'omtKickoffSyncUrl';
  const KEY_SYNC_ANON = 'omtKickoffSyncAnonKey';
  const KEY_SYNC_ROOM = 'omtKickoffSyncRoom';

  const DEFAULTS = {
    [KEY_AUTO_VOD]: true,
    [KEY_SHUTTLE]: false,
    [KEY_AUTO_PAUSE]: false,
    [KEY_CLOCK_POS]: 'top-left',
    [KEY_CLOCK_SIZE]: 'medium',
    [KEY_CLOCK_SHAPE]: 'rounded',
    [KEY_CLOCK_CUSTOM]: null,
    [KEY_HOTKEYS]: null,
    [KEY_SHUTTLE_PREFS]: null,
    [KEY_SYNC_ENABLED]: false,
    [KEY_SYNC_URL]: '',
    [KEY_SYNC_ANON]: '',
    [KEY_SYNC_ROOM]: ''
  };

  function writeLocal(key, value) {
    try {
      if (value == null || value === '') localStorage.removeItem(key);
      else if (typeof value === 'boolean') localStorage.setItem(key, value ? 'true' : 'false');
      else if (typeof value === 'object') localStorage.setItem(key, JSON.stringify(value));
      else localStorage.setItem(key, String(value));
    } catch (_) {}
  }

  function syncToPage(values) {
    try {
      if (Object.prototype.hasOwnProperty.call(values, KEY_AUTO_VOD)) {
        writeLocal(KEY_AUTO_VOD, !!values[KEY_AUTO_VOD]);
      }
      if (Object.prototype.hasOwnProperty.call(values, KEY_SHUTTLE)) {
        writeLocal(KEY_SHUTTLE, !!values[KEY_SHUTTLE]);
      }
      if (Object.prototype.hasOwnProperty.call(values, KEY_AUTO_PAUSE)) {
        writeLocal(KEY_AUTO_PAUSE, !!values[KEY_AUTO_PAUSE]);
      }
      [KEY_CLOCK_POS, KEY_CLOCK_SIZE, KEY_CLOCK_SHAPE].forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(values, k)) writeLocal(k, values[k]);
      });
      [KEY_CLOCK_CUSTOM, KEY_HOTKEYS, KEY_SHUTTLE_PREFS].forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(values, k)) writeLocal(k, values[k]);
      });
      if (SYNC_FEATURE) {
        if (Object.prototype.hasOwnProperty.call(values, KEY_SYNC_ENABLED)) {
          writeLocal(KEY_SYNC_ENABLED, !!values[KEY_SYNC_ENABLED]);
        }
        [KEY_SYNC_URL, KEY_SYNC_ANON, KEY_SYNC_ROOM].forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(values, k)) writeLocal(k, values[k]);
        });
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

  function sendToSw(message) {
    if (!SYNC_FEATURE) return;
    try {
      chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'omt-page') return;

    if (data.type === 'OMT_STORAGE_SET') {
      const payload = {};
      payload[data.key] = data.value;
      try {
        chrome.storage.local.set(payload, () => syncToPage(payload));
      } catch (_) {
        syncToPage(payload);
      }
      return;
    }

    if (!SYNC_FEATURE) return;

    if (data.type === 'OMT_SYNC_PUSH') {
      const row = (data.payload && data.payload.row) || null;
      if (!row) return;
      sendToSw({ type: 'OMT_SYNC_UPSERT', row: row, matchKey: row.match_key });
      return;
    }
    if (data.type === 'OMT_SYNC_PULL') {
      const matchKey = data.payload && data.payload.matchKey;
      if (!matchKey) return;
      sendToSw({ type: 'OMT_SYNC_FETCH', matchKey: matchKey });
      return;
    }
    if (data.type === 'OMT_SYNC_START_POLL') {
      const p = data.payload || {};
      if (!p.matchKey) return;
      sendToSw({
        type: 'OMT_SYNC_START_POLL',
        matchKey: p.matchKey,
        intervalMs: p.intervalMs || 4000
      });
      return;
    }
    if (data.type === 'OMT_SYNC_STOP') {
      sendToSw({ type: 'OMT_SYNC_STOP_POLL' });
      return;
    }
  });

  if (SYNC_FEATURE) {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.type !== 'OMT_SYNC_REMOTE') return;
        try {
          window.postMessage({ source: 'omt-bridge', type: 'OMT_SYNC_REMOTE', row: msg.row }, '*');
        } catch (_) {}
      });
    } catch (_) {}
  }
})();
