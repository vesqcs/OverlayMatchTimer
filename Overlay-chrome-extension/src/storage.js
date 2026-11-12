/* Settings / storage bridge client (MAIN world).
 * chrome.storage is only reachable from bridge.js (ISOLATED).
 * Auto-VOD preference is mirrored via localStorage + postMessage.
 */
    function storageGetAutoVod() {
        const v = localStorage.getItem('omtAutoSwitchVod');
        if (v === null || v === undefined || v === '') return true; // default ON
        return v === 'true';
    }

    function storageSetAutoVod(enabled) {
        localStorage.setItem('omtAutoSwitchVod', enabled ? 'true' : 'false');
        try {
            window.postMessage({
                source: 'omt-page',
                type: 'OMT_STORAGE_SET',
                key: 'omtAutoSwitchVod',
                value: !!enabled
            }, '*');
        } catch (_) {}
    }

