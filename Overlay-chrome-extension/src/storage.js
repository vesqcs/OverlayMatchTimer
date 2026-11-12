/* Settings / storage bridge client (MAIN world).
 * chrome.storage is only reachable from bridge.js (ISOLATED).
 * Prefs are mirrored via localStorage + postMessage.
 */
    const OMT_STORAGE_KEYS = {
        autoVod: 'omtAutoSwitchVod',
        shuttle: 'shuttleXpressEnabled',
        // Personalizar keys reserved (popup writes; content ignores until implemented)
        clockPos: 'omtClockPosition',
        clockSize: 'omtClockSize',
        clockShape: 'omtClockShape'
    };

    function storageGetAutoVod() {
        const v = localStorage.getItem(OMT_STORAGE_KEYS.autoVod);
        if (v === null || v === undefined || v === '') return true; // default ON
        return v === 'true';
    }

    function storageSetAutoVod(enabled) {
        localStorage.setItem(OMT_STORAGE_KEYS.autoVod, enabled ? 'true' : 'false');
        try {
            window.postMessage({
                source: 'omt-page',
                type: 'OMT_STORAGE_SET',
                key: OMT_STORAGE_KEYS.autoVod,
                value: !!enabled
            }, '*');
        } catch (_) {}
    }

    function storageGetShuttleEnabled() {
        const v = localStorage.getItem(OMT_STORAGE_KEYS.shuttle);
        if (v === null || v === undefined || v === '') return false;
        return v === 'true';
    }

    function storageSetShuttleEnabled(enabled) {
        localStorage.setItem(OMT_STORAGE_KEYS.shuttle, enabled ? 'true' : 'false');
        try {
            window.postMessage({
                source: 'omt-page',
                type: 'OMT_STORAGE_SET',
                key: OMT_STORAGE_KEYS.shuttle,
                value: !!enabled
            }, '*');
        } catch (_) {}
    }

    function syncShuttleToggleFromStorage() {
        if (!shuttleToggle) return;
        const on = storageGetShuttleEnabled();
        shuttleToggle.checked = on;
        // Reuse existing Shuttle wiring without changing behaviour.
        try {
            if (typeof updateToggleUI === 'function') updateToggleUI();
        } catch (_) {}
    }

    // Popup / bridge → page sync
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'omt-bridge' || data.type !== 'OMT_STORAGE_SYNC') return;
        const values = data.values || {};
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.shuttle)) {
            try {
                localStorage.setItem(OMT_STORAGE_KEYS.shuttle, values[OMT_STORAGE_KEYS.shuttle] ? 'true' : 'false');
            } catch (_) {}
            syncShuttleToggleFromStorage();
            if (values[OMT_STORAGE_KEYS.shuttle] && typeof initShuttleXpress === 'function') {
                initShuttleXpress().catch(() => {});
            } else if (!values[OMT_STORAGE_KEYS.shuttle] && typeof cleanupShuttle === 'function') {
                cleanupShuttle();
            }
        }
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.autoVod)) {
            try {
                localStorage.setItem(OMT_STORAGE_KEYS.autoVod, values[OMT_STORAGE_KEYS.autoVod] ? 'true' : 'false');
            } catch (_) {}
            const autoBox = omtRoot && omtRoot.querySelector('#omt-examino-auto-vod');
            if (autoBox) autoBox.checked = !!values[OMT_STORAGE_KEYS.autoVod] && examinoManualSourceChoice !== 'DVR';
        }
    });
