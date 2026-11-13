/* Kickoff sync config — MAIN world.
 * Gated by OMT_SYNC_FEATURE_ENABLED (sync-feature-flag.js). When the flag is
 * false every helper returns inert values and callers must no-op.
 */
    function omtSyncFeatureOn() {
        return (typeof OMT_SYNC_FEATURE_ENABLED !== 'undefined') && !!OMT_SYNC_FEATURE_ENABLED;
    }

    const OMT_SYNC_KEYS = {
        enabled: 'omtKickoffSyncEnabled',
        url: 'omtKickoffSyncUrl',
        anonKey: 'omtKickoffSyncAnonKey',
        room: 'omtKickoffSyncRoom'
    };

    function omtSyncIsEnabled() {
        if (!omtSyncFeatureOn()) return false;
        try {
            const v = localStorage.getItem(OMT_SYNC_KEYS.enabled);
            return v === 'true';
        } catch (_) {
            return false;
        }
    }

    function omtSyncGetConfig() {
        if (!omtSyncFeatureOn()) {
            return { enabled: false, url: '', anonKey: '', room: '' };
        }
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
        if (!omtSyncFeatureOn()) return false;
        const c = omtSyncGetConfig();
        return !!(c.url && c.anonKey);
    }
