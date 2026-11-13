/* Kickoff sync config — MAIN world reads mirrored prefs only.
 * Network lives in the service worker. When disabled this module is a pure no-op.
 */
    const OMT_SYNC_KEYS = {
        enabled: 'omtKickoffSyncEnabled',
        url: 'omtKickoffSyncUrl',
        anonKey: 'omtKickoffSyncAnonKey',
        room: 'omtKickoffSyncRoom'
    };

    function omtSyncIsEnabled() {
        try {
            const v = localStorage.getItem(OMT_SYNC_KEYS.enabled);
            return v === 'true';
        } catch (_) {
            return false;
        }
    }

    function omtSyncGetConfig() {
        try {
            return {
                enabled: omtSyncIsEnabled(),
                url: (localStorage.getItem(OMT_SYNC_KEYS.url) || '').trim(),
                anonKey: (localStorage.getItem(OMT_SYNC_KEYS.anonKey) || '').trim(),
                room: (localStorage.getItem(OMT_SYNC_KEYS.room) || '').trim()
            };
        } catch (_) {
            return { enabled: false, url: '', anonKey: '', room: '' };
        }
    }

    function omtSyncHasCredentials() {
        const c = omtSyncGetConfig();
        return !!(c.url && c.anonKey);
    }
