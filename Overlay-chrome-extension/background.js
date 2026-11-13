/* Overlay MatchTimer — MV3 service worker.
 * Kickoff sync is gated by sync-feature-flag.js (OMT_SYNC_FEATURE_ENABLED).
 * When the flag is false this worker is effectively empty (no sync handlers).
 */
'use strict';

try {
  importScripts('sync-feature-flag.js');
} catch (_) {
  /* flag file missing → treat as disabled */
  self.OMT_SYNC_FEATURE_ENABLED = false;
}

chrome.runtime.onInstalled.addListener(() => {});

if (typeof OMT_SYNC_FEATURE_ENABLED !== 'undefined' && OMT_SYNC_FEATURE_ENABLED) {
  const SYNC_PREF_KEYS = [
    'omtKickoffSyncEnabled',
    'omtKickoffSyncUrl',
    'omtKickoffSyncAnonKey',
    'omtKickoffSyncRoom'
  ];

  let syncPollTimer = null;
  let syncPollMatchKey = null;

  function syncPrefsGet() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(
          {
            omtKickoffSyncEnabled: false,
            omtKickoffSyncUrl: '',
            omtKickoffSyncAnonKey: '',
            omtKickoffSyncRoom: ''
          },
          (r) => resolve(r || {})
        );
      } catch (_) {
        resolve({
          omtKickoffSyncEnabled: false,
          omtKickoffSyncUrl: '',
          omtKickoffSyncAnonKey: '',
          omtKickoffSyncRoom: ''
        });
      }
    });
  }

  function syncNormalizeBaseUrl(url) {
    const u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
      return parsed.origin;
    } catch (_) {
      return '';
    }
  }

  function syncStopPoll() {
    if (syncPollTimer) {
      clearInterval(syncPollTimer);
      syncPollTimer = null;
    }
    syncPollMatchKey = null;
  }

  async function syncRest(method, matchKey, body) {
    const prefs = await syncPrefsGet();
    if (!prefs.omtKickoffSyncEnabled) return { ok: false, skipped: true };
    const base = syncNormalizeBaseUrl(prefs.omtKickoffSyncUrl);
    const key = String(prefs.omtKickoffSyncAnonKey || '').trim();
    if (!base || !key || !matchKey) return { ok: false, skipped: true };

    const url =
      base +
      '/rest/v1/kickoff_sync?match_key=eq.' +
      encodeURIComponent(matchKey);

    const headers = {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/json'
    };

    let res;
    if (method === 'GET') {
      res = await fetch(url, { method: 'GET', headers: headers });
    } else if (method === 'UPSERT') {
      headers['Content-Type'] = 'application/json';
      headers.Prefer = 'resolution=merge-duplicates,return=representation';
      const row = Object.assign({}, body || {}, { match_key: matchKey });
      res = await fetch(base + '/rest/v1/kickoff_sync', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(row)
      });
    } else {
      return { ok: false, error: 'bad_method' };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text.slice(0, 200) };
    }
    const data = await res.json().catch(() => null);
    return { ok: true, data: data };
  }

  function broadcastRemote(row) {
    if (!row) return;
    try {
      chrome.tabs.query({}, (tabs) => {
        (tabs || []).forEach((tab) => {
          if (!tab || tab.id == null) return;
          try {
            chrome.tabs.sendMessage(tab.id, { type: 'OMT_SYNC_REMOTE', row: row }, () => {
              void chrome.runtime.lastError;
            });
          } catch (_) {}
        });
      });
    } catch (_) {}
  }

  async function syncFetchAndBroadcast(matchKey) {
    const result = await syncRest('GET', matchKey, null);
    if (!result.ok || result.skipped) return result;
    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows[0]) broadcastRemote(rows[0]);
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;

    if (msg.type === 'OMT_SYNC_UPSERT') {
      (async () => {
        const prefs = await syncPrefsGet();
        if (!prefs.omtKickoffSyncEnabled) {
          sendResponse({ ok: false, skipped: true });
          return;
        }
        const matchKey = (msg.row && msg.row.match_key) || msg.matchKey;
        const result = await syncRest('UPSERT', matchKey, msg.row);
        sendResponse(result);
      })();
      return true;
    }

    if (msg.type === 'OMT_SYNC_FETCH') {
      (async () => {
        const prefs = await syncPrefsGet();
        if (!prefs.omtKickoffSyncEnabled) {
          sendResponse({ ok: false, skipped: true });
          return;
        }
        const result = await syncFetchAndBroadcast(msg.matchKey);
        sendResponse(result);
      })();
      return true;
    }

    if (msg.type === 'OMT_SYNC_START_POLL') {
      (async () => {
        const prefs = await syncPrefsGet();
        if (!prefs.omtKickoffSyncEnabled) {
          syncStopPoll();
          sendResponse({ ok: false, skipped: true });
          return;
        }
        const matchKey = msg.matchKey;
        const intervalMs = Math.max(2000, Number(msg.intervalMs) || 4000);
        syncStopPoll();
        syncPollMatchKey = matchKey;
        await syncFetchAndBroadcast(matchKey);
        syncPollTimer = setInterval(() => {
          if (!syncPollMatchKey) return;
          syncFetchAndBroadcast(syncPollMatchKey).catch(() => {});
        }, intervalMs);
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === 'OMT_SYNC_STOP_POLL') {
      syncStopPoll();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!SYNC_PREF_KEYS.some((k) => Object.prototype.hasOwnProperty.call(changes, k))) return;
    const enabledChange = changes.omtKickoffSyncEnabled;
    if (enabledChange && enabledChange.newValue !== true) {
      syncStopPoll();
    }
  });
}
