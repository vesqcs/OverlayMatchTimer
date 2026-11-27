/* ============================================================
   Overlay MatchTimer — chrome.storage.sync prefs with local fallback
   (v2.4.14). Shared by bridge.js (ISOLATED) and popup.js.

   User preferences sync across Edge/Chrome signed-in profiles when
   browser sync is on. Always mirrored to chrome.storage.local so the
   extension keeps working offline / with sync disabled / on quota errors.

   Quotas (Chromium): ~8 KB/item, ~100 KB total, write rate limits.
   Writes to sync are debounced; high-frequency runtime state stays out.
   ============================================================ */
(function (global) {
  'use strict';

  const MIGRATE_FLAG = 'omtPrefsSyncMigrated_v1';
  const DEBOUNCE_MS = 450;
  const MAX_ITEM_BYTES = 7800; // leave headroom under 8192

  /** Keys that follow the browser account (preferences only). */
  const SYNCABLE_KEYS = [
    'omtAutoSwitchVod',
    'shuttleXpressEnabled',
    'omtKeepPlayingOnAltTab',
    'omtAutoHideChrome',
    'omtClockPosition',
    'omtClockSize',
    'omtClockShape',
    'omtClockCustomOffset',
    'omtPanelSize',
    'omtPanelCompact',
    'omtSkipSeconds',
    'omtHotkeys',
    'omtShuttlePrefs',
    'omtCustSectionsOpen',
    'omtKickoffSyncEnabled',
    'omtKickoffSyncUrl',
    'omtKickoffSyncAnonKey',
    'omtKickoffSyncRoom'
  ];

  const SYNCABLE = Object.create(null);
  SYNCABLE_KEYS.forEach((k) => { SYNCABLE[k] = true; });

  let syncUsable = true;
  let pendingSync = Object.create(null);
  let debounceTimer = null;
  let migrateStarted = false;

  function lastErrorMessage() {
    try {
      return (chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message) || '';
    } catch (_) {
      return '';
    }
  }

  function byteLength(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch (_) {
      try {
        return JSON.stringify(value).length;
      } catch (__) {
        return MAX_ITEM_BYTES + 1;
      }
    }
  }

  function splitPayload(obj) {
    const localPart = Object.create(null);
    const syncPart = Object.create(null);
    if (!obj || typeof obj !== 'object') return { localPart, syncPart };
    Object.keys(obj).forEach((k) => {
      localPart[k] = obj[k];
      if (SYNCABLE[k]) syncPart[k] = obj[k];
    });
    return { localPart, syncPart };
  }

  function flushSyncWrites() {
    debounceTimer = null;
    if (!syncUsable) {
      pendingSync = Object.create(null);
      return;
    }
    const batch = pendingSync;
    pendingSync = Object.create(null);
    const safe = Object.create(null);
    Object.keys(batch).forEach((k) => {
      if (byteLength(batch[k]) <= MAX_ITEM_BYTES) safe[k] = batch[k];
      // Oversized items stay in chrome.storage.local only.
    });
    if (!Object.keys(safe).length) return;
    try {
      chrome.storage.sync.set(safe, () => {
        const err = lastErrorMessage();
        if (err) {
          // Quota / sync-disabled / signed-out — keep using local.
          syncUsable = false;
        }
      });
    } catch (_) {
      syncUsable = false;
    }
  }

  function scheduleSyncWrite(syncPart) {
    if (!syncUsable || !syncPart || !Object.keys(syncPart).length) return;
    Object.keys(syncPart).forEach((k) => {
      pendingSync[k] = syncPart[k];
    });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushSyncWrites, DEBOUNCE_MS);
  }

  function setLocal(obj, cb) {
    try {
      chrome.storage.local.set(obj, () => {
        void lastErrorMessage();
        if (typeof cb === 'function') cb();
      });
    } catch (_) {
      if (typeof cb === 'function') cb();
    }
  }

  /**
   * Write prefs: always to local (immediate), debounced to sync when syncable.
   */
  function set(obj, cb) {
    const { localPart, syncPart } = splitPayload(obj);
    setLocal(localPart, () => {
      scheduleSyncWrite(syncPart);
      if (typeof cb === 'function') cb();
    });
  }

  function remove(keys, cb) {
    const list = Array.isArray(keys) ? keys : [keys];
    const syncKeys = list.filter((k) => SYNCABLE[k]);
    try {
      chrome.storage.local.remove(list, () => {
        void lastErrorMessage();
        if (syncUsable && syncKeys.length) {
          try {
            chrome.storage.sync.remove(syncKeys, () => {
              void lastErrorMessage();
              if (typeof cb === 'function') cb();
            });
          } catch (_) {
            if (typeof cb === 'function') cb();
          }
        } else if (typeof cb === 'function') {
          cb();
        }
      });
    } catch (_) {
      if (typeof cb === 'function') cb();
    }
  }

  function syncEmptyOfPrefs(syncAll) {
    if (!syncAll) return true;
    return !SYNCABLE_KEYS.some((k) =>
      Object.prototype.hasOwnProperty.call(syncAll, k) && syncAll[k] !== undefined
    );
  }

  function localHasPrefs(localAll) {
    if (!localAll) return false;
    return SYNCABLE_KEYS.some((k) =>
      Object.prototype.hasOwnProperty.call(localAll, k) && localAll[k] !== undefined
    );
  }

  function pickSyncable(src) {
    const out = Object.create(null);
    if (!src) return out;
    SYNCABLE_KEYS.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) {
        out[k] = src[k];
      }
    });
    return out;
  }

  /**
   * One-time: if sync has no prefs and local does, copy local → sync.
   * Never deletes local. Flag lives in chrome.storage.local only.
   */
  function migrateLocalToSyncIfNeeded(localAll, syncAll, done) {
    if (migrateStarted) {
      if (typeof done === 'function') done();
      return;
    }
    migrateStarted = true;
    const finish = () => {
      setLocal({ [MIGRATE_FLAG]: true }, () => {
        if (typeof done === 'function') done();
      });
    };
    try {
      chrome.storage.local.get([MIGRATE_FLAG], (flagBag) => {
        if (flagBag && flagBag[MIGRATE_FLAG]) {
          if (typeof done === 'function') done();
          return;
        }
        if (syncEmptyOfPrefs(syncAll) && localHasPrefs(localAll)) {
          const copy = pickSyncable(localAll);
          if (!Object.keys(copy).length) {
            finish();
            return;
          }
          try {
            chrome.storage.sync.set(copy, () => {
              const err = lastErrorMessage();
              if (err) syncUsable = false;
              finish();
            });
          } catch (_) {
            syncUsable = false;
            finish();
          }
        } else {
          finish();
        }
      });
    } catch (_) {
      if (typeof done === 'function') done();
    }
  }

  /**
   * Read prefs: defaults ← local ← sync (sync wins for syncable keys).
   * Mirrors winning sync values back into local so page/localStorage stay aligned.
   */
  function get(defaults, cb) {
    const def = defaults && typeof defaults === 'object' ? defaults : {};
    try {
      chrome.storage.local.get(null, (localAll) => {
        void lastErrorMessage();
        const local = localAll || {};
        const apply = (syncAll) => {
          const result = Object.assign({}, def, local);
          const sync = syncAll || {};
          SYNCABLE_KEYS.forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(sync, k) && sync[k] !== undefined) {
              result[k] = sync[k];
            }
          });
          // Only fill defaults for keys requested via defaults object.
          Object.keys(def).forEach((k) => {
            if (result[k] === undefined) result[k] = def[k];
          });
          migrateLocalToSyncIfNeeded(local, sync, () => {
            const mirror = pickSyncable(result);
            // Keep local mirror current (does not remove other local keys).
            if (Object.keys(mirror).length) {
              setLocal(mirror, () => {
                if (typeof cb === 'function') cb(result);
              });
            } else if (typeof cb === 'function') {
              cb(result);
            }
          });
        };
        try {
          chrome.storage.sync.get(null, (syncAll) => {
            const err = lastErrorMessage();
            if (err) {
              syncUsable = false;
              apply({});
              return;
            }
            apply(syncAll || {});
          });
        } catch (_) {
          syncUsable = false;
          apply({});
        }
      });
    } catch (_) {
      if (typeof cb === 'function') cb(Object.assign({}, def));
    }
  }

  /** Raw peek at both areas (used for one-shot legacy migrations). */
  function getRaw(keys, cb) {
    const list = Array.isArray(keys) ? keys : [keys];
    try {
      chrome.storage.local.get(list, (localBag) => {
        void lastErrorMessage();
        try {
          chrome.storage.sync.get(list, (syncBag) => {
            const err = lastErrorMessage();
            if (err) syncUsable = false;
            if (typeof cb === 'function') {
              cb({ local: localBag || {}, sync: err ? {} : (syncBag || {}) });
            }
          });
        } catch (_) {
          syncUsable = false;
          if (typeof cb === 'function') cb({ local: localBag || {}, sync: {} });
        }
      });
    } catch (_) {
      if (typeof cb === 'function') cb({ local: {}, sync: {} });
    }
  }

  /**
   * Subscribe to preference changes from local or sync.
   * Callback receives a flat { key: newValue } map (same shape as bridge syncToPage).
   */
  function onChanged(handler) {
    if (typeof handler !== 'function') return function noop() {};
    const listener = (changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      const values = Object.create(null);
      let any = false;
      Object.keys(changes || {}).forEach((k) => {
        if (k === MIGRATE_FLAG) return;
        if (area === 'sync' && !SYNCABLE[k]) return;
        values[k] = changes[k].newValue;
        any = true;
        // Remote sync → keep local mirror so other readers stay consistent.
        if (area === 'sync' && SYNCABLE[k]) {
          const one = Object.create(null);
          one[k] = changes[k].newValue;
          setLocal(one);
        }
      });
      if (any) handler(values, area);
    };
    try {
      chrome.storage.onChanged.addListener(listener);
    } catch (_) {}
    return function unsubscribe() {
      try { chrome.storage.onChanged.removeListener(listener); } catch (_) {}
    };
  }

  global.OMT_PREFS = {
    SYNCABLE_KEYS: SYNCABLE_KEYS.slice(),
    MIGRATE_FLAG,
    set,
    get,
    remove,
    getRaw,
    onChanged,
    /** Test/debug: force sync soft-disable (local-only fallback). */
    _setSyncUsableForTests(v) { syncUsable = !!v; },
    _flushSyncForTests() { flushSyncWrites(); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
