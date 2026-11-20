/* ============================================================
   Overlay MatchTimer — isolated-world storage bridge
   MAIN-world content.js cannot touch chrome.storage; this script
   mirrors chrome.storage.local <-> localStorage + CustomEvent bus.
   Also used by the toolbar popup (writes) so in-page UI stays in sync.
   Kickoff-sync relay is active ONLY when OMT_SYNC_FEATURE_ENABLED.

   IMPORTANT: Do NOT window.postMessage for this traffic. Examino's
   Shuttle button-bar listens for all same-origin "message" events and
   toggles play/pause when `key` is missing (host chunk BIyTHCyh.js).
   ============================================================ */
(function () {
  'use strict';

  const SYNC_FEATURE = (typeof OMT_SYNC_FEATURE_ENABLED !== 'undefined') && !!OMT_SYNC_FEATURE_ENABLED;
  const OMT_BUS_EVENT = 'omt-bridge-bus';

  const KEY_AUTO_VOD = 'omtAutoSwitchVod';
  const KEY_SHUTTLE = 'shuttleXpressEnabled';
  const KEY_AUTO_PAUSE_LEGACY = 'omtAutoPauseOnBlur';
  const KEY_KEEP_PLAYING_ALT_TAB = 'omtKeepPlayingOnAltTab';
  const KEY_CLOCK_POS = 'omtClockPosition';
  const KEY_CLOCK_SIZE = 'omtClockSize';
  const KEY_CLOCK_SHAPE = 'omtClockShape';
  const KEY_CLOCK_CUSTOM = 'omtClockCustomOffset';
  const KEY_PANEL_SIZE = 'omtPanelSize';
  const KEY_PANEL_COMPACT = 'omtPanelCompact';
  const KEY_SKIP_SECONDS = 'omtSkipSeconds';
  const KEY_HOTKEYS = 'omtHotkeys';
  const KEY_SHUTTLE_PREFS = 'omtShuttlePrefs';
  const KEY_SYNC_ENABLED = 'omtKickoffSyncEnabled';
  const KEY_SYNC_URL = 'omtKickoffSyncUrl';
  const KEY_SYNC_ANON = 'omtKickoffSyncAnonKey';
  const KEY_SYNC_ROOM = 'omtKickoffSyncRoom';

  const DEFAULTS = {
    [KEY_AUTO_VOD]: true,
    [KEY_SHUTTLE]: false,
    [KEY_KEEP_PLAYING_ALT_TAB]: false,
    [KEY_CLOCK_POS]: 'top-left',
    [KEY_CLOCK_SIZE]: 'medium',
    [KEY_CLOCK_SHAPE]: 'rounded',
    [KEY_CLOCK_CUSTOM]: null,
    [KEY_PANEL_SIZE]: 'medium',
    [KEY_PANEL_COMPACT]: false,
    [KEY_SKIP_SECONDS]: null,
    [KEY_HOTKEYS]: null,
    [KEY_SHUTTLE_PREFS]: null,
    [KEY_SYNC_ENABLED]: false,
    [KEY_SYNC_URL]: '',
    [KEY_SYNC_ANON]: '',
    [KEY_SYNC_ROOM]: ''
  };

  function busPost(data) {
    try {
      window.dispatchEvent(new CustomEvent(OMT_BUS_EVENT, { detail: data }));
    } catch (_) {}
  }

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
      if (Object.prototype.hasOwnProperty.call(values, KEY_KEEP_PLAYING_ALT_TAB)) {
        writeLocal(KEY_KEEP_PLAYING_ALT_TAB, !!values[KEY_KEEP_PLAYING_ALT_TAB]);
        try { localStorage.removeItem(KEY_AUTO_PAUSE_LEGACY); } catch (_) {}
      } else if (Object.prototype.hasOwnProperty.call(values, KEY_AUTO_PAUSE_LEGACY)) {
        // Migrate: ignore old value, land on new default OFF.
        writeLocal(KEY_KEEP_PLAYING_ALT_TAB, false);
        try { localStorage.removeItem(KEY_AUTO_PAUSE_LEGACY); } catch (_) {}
      }
      [KEY_CLOCK_POS, KEY_CLOCK_SIZE, KEY_CLOCK_SHAPE, KEY_PANEL_SIZE].forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(values, k)) writeLocal(k, values[k]);
      });
      if (Object.prototype.hasOwnProperty.call(values, KEY_PANEL_COMPACT)) {
        writeLocal(KEY_PANEL_COMPACT, !!values[KEY_PANEL_COMPACT]);
      }
      [KEY_CLOCK_CUSTOM, KEY_SKIP_SECONDS, KEY_HOTKEYS, KEY_SHUTTLE_PREFS].forEach((k) => {
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
    busPost({ source: 'omt-bridge', type: 'OMT_STORAGE_SYNC', values });
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

  function onPageMessage(data) {
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
  }

  window.addEventListener(OMT_BUS_EVENT, (event) => {
    onPageMessage(event && event.detail);
  });

  // E2E / legacy page posts (production page uses CustomEvent only).
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    onPageMessage(event.data);
  });

  if (SYNC_FEATURE) {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.type !== 'OMT_SYNC_REMOTE') return;
        busPost({ source: 'omt-bridge', type: 'OMT_SYNC_REMOTE', row: msg.row });
      });
    } catch (_) {}
  }
})();
