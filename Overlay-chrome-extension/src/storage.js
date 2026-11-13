/* Settings / storage bridge client (MAIN world).
 * chrome.storage is only reachable from bridge.js (ISOLATED).
 * Prefs are mirrored via localStorage + postMessage.
 */
    const OMT_STORAGE_KEYS = {
        autoVod: 'omtAutoSwitchVod',
        shuttle: 'shuttleXpressEnabled',
        autoPauseOnBlur: 'omtAutoPauseOnBlur',
        autoHideChrome: 'omtAutoHideChrome',
        clockPos: 'omtClockPosition',
        clockSize: 'omtClockSize',
        clockShape: 'omtClockShape',
        clockCustom: 'omtClockCustomOffset',
        hotkeys: 'omtHotkeys',
        shuttlePrefs: 'omtShuttlePrefs'
    };

    function storageGetAutoHideChrome() {
        const v = localStorage.getItem(OMT_STORAGE_KEYS.autoHideChrome);
        if (v === null || v === undefined || v === '') return true; // default ON (original idle fade)
        return v === 'true';
    }

    function storageSetAutoHideChrome(enabled) {
        localStorage.setItem(OMT_STORAGE_KEYS.autoHideChrome, enabled ? 'true' : 'false');
        try {
            window.postMessage({
                source: 'omt-page',
                type: 'OMT_STORAGE_SET',
                key: OMT_STORAGE_KEYS.autoHideChrome,
                value: !!enabled
            }, '*');
        } catch (_) {}
    }

    function storageGetAutoPauseOnBlur() {
        const v = localStorage.getItem(OMT_STORAGE_KEYS.autoPauseOnBlur);
        if (v === null || v === undefined || v === '') return false; // default OFF
        return v === 'true';
    }

    function storageSetAutoPauseOnBlur(enabled) {
        localStorage.setItem(OMT_STORAGE_KEYS.autoPauseOnBlur, enabled ? 'true' : 'false');
        try {
            window.postMessage({
                source: 'omt-page',
                type: 'OMT_STORAGE_SET',
                key: OMT_STORAGE_KEYS.autoPauseOnBlur,
                value: !!enabled
            }, '*');
        } catch (_) {}
    }

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
        // Local player windows must not share Shuttle enablement (upper shared
        // monitor vs personal file window). sessionStorage is per-window.
        if (site && site.id === 'local') {
            try {
                return sessionStorage.getItem('omtLocalShuttleEnabled') === 'true';
            } catch (_) {
                return false;
            }
        }
        const v = localStorage.getItem(OMT_STORAGE_KEYS.shuttle);
        if (v === null || v === undefined || v === '') return false;
        return v === 'true';
    }

    function storageSetShuttleEnabled(enabled) {
        if (site && site.id === 'local') {
            try {
                sessionStorage.setItem('omtLocalShuttleEnabled', enabled ? 'true' : 'false');
            } catch (_) {}
            return;
        }
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
            if (typeof updateToggleUI === 'function') updateToggleUI(on);
        } catch (_) {}
    }

    function omtMirrorJsonKey(key, value) {
        try {
            if (value == null) localStorage.removeItem(key);
            else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        } catch (_) {}
    }

    // Popup / bridge → page sync
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'omt-bridge' || data.type !== 'OMT_STORAGE_SYNC') return;
        const values = data.values || {};
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.shuttle)) {
            // Never let shared chrome.storage shuttle prefs override a local player window.
            if (site && site.id === 'local') {
                // ignore
            } else {
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
        }
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.autoVod)) {
            try {
                localStorage.setItem(OMT_STORAGE_KEYS.autoVod, values[OMT_STORAGE_KEYS.autoVod] ? 'true' : 'false');
            } catch (_) {}
            const autoBox = omtRoot && omtRoot.querySelector('#omt-examino-auto-vod');
            if (autoBox) autoBox.checked = !!values[OMT_STORAGE_KEYS.autoVod] && examinoManualSourceChoice !== 'DVR';
        }
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.autoPauseOnBlur)) {
            try {
                localStorage.setItem(
                    OMT_STORAGE_KEYS.autoPauseOnBlur,
                    values[OMT_STORAGE_KEYS.autoPauseOnBlur] ? 'true' : 'false'
                );
            } catch (_) {}
        }
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.autoHideChrome)) {
            try {
                localStorage.setItem(
                    OMT_STORAGE_KEYS.autoHideChrome,
                    values[OMT_STORAGE_KEYS.autoHideChrome] ? 'true' : 'false'
                );
            } catch (_) {}
            if (typeof syncAutoHideChromeButton === 'function') syncAutoHideChromeButton();
            if (typeof resetControlsTimeout === 'function') resetControlsTimeout(true);
        }

        let customizeTouched = false;
        [OMT_STORAGE_KEYS.clockPos, OMT_STORAGE_KEYS.clockSize, OMT_STORAGE_KEYS.clockShape].forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(values, k)) {
                try {
                    if (values[k] == null) localStorage.removeItem(k);
                    else localStorage.setItem(k, String(values[k]));
                } catch (_) {}
                customizeTouched = true;
            }
        });
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.clockCustom)) {
            omtMirrorJsonKey(OMT_STORAGE_KEYS.clockCustom, values[OMT_STORAGE_KEYS.clockCustom]);
            customizeTouched = true;
        }
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.hotkeys)) {
            omtMirrorJsonKey(OMT_STORAGE_KEYS.hotkeys, values[OMT_STORAGE_KEYS.hotkeys]);
            customizeTouched = true;
        }
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.shuttlePrefs)) {
            omtMirrorJsonKey(OMT_STORAGE_KEYS.shuttlePrefs, values[OMT_STORAGE_KEYS.shuttlePrefs]);
            customizeTouched = true;
        }
        if (customizeTouched && typeof omtApplyCustomizeFromStorage === 'function') {
            omtApplyCustomizeFromStorage();
        }
    });
