/* Settings / storage bridge client (MAIN world).
 * chrome.storage is only reachable from bridge.js (ISOLATED).
 * Prefs are mirrored via localStorage + omt-bridge-bus CustomEvent
 * (never window.postMessage — Examino Shuttle chunk treats those as keys).
 */
    const OMT_STORAGE_KEYS = {
        autoVod: 'omtAutoSwitchVod',
        shuttle: 'shuttleXpressEnabled',
        autoPauseOnBlur: 'omtAutoPauseOnBlur', // legacy; migrated away in v2.2.14
        keepPlayingOnAltTab: 'omtKeepPlayingOnAltTab',
        autoHideChrome: 'omtAutoHideChrome',
        clockPos: 'omtClockPosition',
        clockSize: 'omtClockSize',
        clockShape: 'omtClockShape',
        clockCustom: 'omtClockCustomOffset',
        panelSize: 'omtPanelSize',
        panelCompact: 'omtPanelCompact',
        skipSeconds: 'omtSkipSeconds',
        hotkeys: 'omtHotkeys',
        shuttlePrefs: 'omtShuttlePrefs'
    };

    function storageGetAutoHideChrome() {
        const v = localStorage.getItem(OMT_STORAGE_KEYS.autoHideChrome);
        if (v === null || v === undefined || v === '') return true; // default ON (original idle fade)
        return v === 'true';
    }

    function storageSetAutoHideChrome(enabled) {
        const next = enabled ? 'true' : 'false';
        let prev = null;
        try { prev = localStorage.getItem(OMT_STORAGE_KEYS.autoHideChrome); } catch (_) {}
        try { localStorage.setItem(OMT_STORAGE_KEYS.autoHideChrome, next); } catch (_) {}
        // No-op bus when unchanged — prevents sync→set→sync storms (Examino host
        // used to see each postMessage as play/pause; bus must stay quiet too).
        if (prev === next) return;
        omtBusPost({
            source: 'omt-page',
            type: 'OMT_STORAGE_SET',
            key: OMT_STORAGE_KEYS.autoHideChrome,
            value: !!enabled
        });
    }

    /**
     * v2.2.14: "Não pausar no alt tab" — default OFF = pause on hide, resume on
     * return. Old omtAutoPauseOnBlur is dropped (not inverted) so everyone lands
     * on the new default without a silent behaviour flip of the same checkbox.
     */
    function storageGetKeepPlayingOnAltTab() {
        const v = localStorage.getItem(OMT_STORAGE_KEYS.keepPlayingOnAltTab);
        if (v === 'true' || v === 'false') return v === 'true';
        try { localStorage.removeItem(OMT_STORAGE_KEYS.autoPauseOnBlur); } catch (_) {}
        return false; // new default OFF
    }

    function storageSetKeepPlayingOnAltTab(enabled) {
        const next = enabled ? 'true' : 'false';
        let prev = null;
        try { prev = localStorage.getItem(OMT_STORAGE_KEYS.keepPlayingOnAltTab); } catch (_) {}
        try { localStorage.setItem(OMT_STORAGE_KEYS.keepPlayingOnAltTab, next); } catch (_) {}
        try { localStorage.removeItem(OMT_STORAGE_KEYS.autoPauseOnBlur); } catch (_) {}
        if (prev === next) return;
        omtBusPost({
            source: 'omt-page',
            type: 'OMT_STORAGE_SET',
            key: OMT_STORAGE_KEYS.keepPlayingOnAltTab,
            value: !!enabled
        });
    }

    // Legacy name kept for any stray callers — maps to inverted keep-playing.
    function storageGetAutoPauseOnBlur() {
        return !storageGetKeepPlayingOnAltTab();
    }

    function storageSetAutoPauseOnBlur(enabled) {
        storageSetKeepPlayingOnAltTab(!enabled);
    }

    function storageGetAutoVod() {
        const v = localStorage.getItem(OMT_STORAGE_KEYS.autoVod);
        if (v === null || v === undefined || v === '') return true; // default ON
        return v === 'true';
    }

    function storageSetAutoVod(enabled) {
        const next = enabled ? 'true' : 'false';
        let prev = null;
        try { prev = localStorage.getItem(OMT_STORAGE_KEYS.autoVod); } catch (_) {}
        try { localStorage.setItem(OMT_STORAGE_KEYS.autoVod, next); } catch (_) {}
        if (prev === next) return;
        omtBusPost({
            source: 'omt-page',
            type: 'OMT_STORAGE_SET',
            key: OMT_STORAGE_KEYS.autoVod,
            value: !!enabled
        });
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
        const next = enabled ? 'true' : 'false';
        let prev = null;
        try { prev = localStorage.getItem(OMT_STORAGE_KEYS.shuttle); } catch (_) {}
        try { localStorage.setItem(OMT_STORAGE_KEYS.shuttle, next); } catch (_) {}
        if (prev === next) return;
        omtBusPost({
            source: 'omt-page',
            type: 'OMT_STORAGE_SET',
            key: OMT_STORAGE_KEYS.shuttle,
            value: !!enabled
        });
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

    // Popup / bridge → page sync (CustomEvent bus; postMessage accepted for e2e only)
    omtBusListen((data) => {
        if (!data || data.source !== 'omt-bridge' || data.type !== 'OMT_STORAGE_SYNC') return;
        const values = data.values || {};
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.shuttle)) {
            // Never let shared chrome.storage shuttle prefs override a local player window.
            if (site && site.id === 'local') {
                // ignore
            } else {
                const wantOn = !!values[OMT_STORAGE_KEYS.shuttle];
                const wasOn = typeof storageGetShuttleEnabled === 'function'
                    ? storageGetShuttleEnabled()
                    : false;
                try {
                    localStorage.setItem(OMT_STORAGE_KEYS.shuttle, wantOn ? 'true' : 'false');
                } catch (_) {}
                syncShuttleToggleFromStorage();
                // Only transition: avoid cleanupShuttle→storageSet(false)→sync loops
                // when every bridge sync repeats shuttle:false (2.0.x vs 1.2.0).
                if (wantOn && !wasOn && typeof initShuttleXpress === 'function') {
                    initShuttleXpress().catch(() => {});
                } else if (!wantOn && wasOn && typeof cleanupShuttle === 'function') {
                    cleanupShuttle({ skipStorage: true });
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
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.keepPlayingOnAltTab)) {
            try {
                localStorage.setItem(
                    OMT_STORAGE_KEYS.keepPlayingOnAltTab,
                    values[OMT_STORAGE_KEYS.keepPlayingOnAltTab] ? 'true' : 'false'
                );
                localStorage.removeItem(OMT_STORAGE_KEYS.autoPauseOnBlur);
            } catch (_) {}
        } else if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.autoPauseOnBlur)) {
            // One-shot migration from chrome.storage legacy key → new default OFF.
            try {
                localStorage.setItem(OMT_STORAGE_KEYS.keepPlayingOnAltTab, 'false');
                localStorage.removeItem(OMT_STORAGE_KEYS.autoPauseOnBlur);
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
        [OMT_STORAGE_KEYS.clockPos, OMT_STORAGE_KEYS.clockSize, OMT_STORAGE_KEYS.clockShape, OMT_STORAGE_KEYS.panelSize].forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(values, k)) {
                try {
                    if (values[k] == null) localStorage.removeItem(k);
                    else localStorage.setItem(k, String(values[k]));
                } catch (_) {}
                customizeTouched = true;
            }
        });
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.panelCompact)) {
            try {
                localStorage.setItem(
                    OMT_STORAGE_KEYS.panelCompact,
                    values[OMT_STORAGE_KEYS.panelCompact] ? 'true' : 'false'
                );
            } catch (_) {}
            customizeTouched = true;
        }
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.clockCustom)) {
            // Null/empty = already cleared; mirroring it must not re-enter
            // omtClearLegacyClockCustom's storage SET path.
            if (values[OMT_STORAGE_KEYS.clockCustom] != null && values[OMT_STORAGE_KEYS.clockCustom] !== '') {
                omtMirrorJsonKey(OMT_STORAGE_KEYS.clockCustom, values[OMT_STORAGE_KEYS.clockCustom]);
                customizeTouched = true;
            } else {
                try { localStorage.removeItem(OMT_STORAGE_KEYS.clockCustom); } catch (_) {}
            }
        }
        if (Object.prototype.hasOwnProperty.call(values, OMT_STORAGE_KEYS.skipSeconds)) {
            omtMirrorJsonKey(OMT_STORAGE_KEYS.skipSeconds, values[OMT_STORAGE_KEYS.skipSeconds]);
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
