/* Page ↔ isolated-world bridge bus.
 *
 * Examino's Shuttle/button-bar Svelte chunk listens for ALL same-origin
 * window "message" events and treats missing/unknown `key` as play/pause
 * toggle (BIyTHCyh.js function D). Our chrome.storage mirror used to
 * window.postMessage({ source: 'omt-bridge'|'omt-page', ... }), which the
 * host interpreted as Shuttle keys → thousands of pause/play pairs/sec.
 *
 * Production traffic uses a CustomEvent that the host does not hear.
 * Legacy window.postMessage is still accepted as input (e2e helpers) but
 * must never be our output channel on Examino.
 */
    const OMT_BUS_EVENT = 'omt-bridge-bus';

    function omtBusPost(data) {
        if (!data || typeof data !== 'object') return;
        try {
            window.dispatchEvent(new CustomEvent(OMT_BUS_EVENT, { detail: data }));
        } catch (_) {}
    }

    function omtBusListen(handler) {
        if (typeof handler !== 'function') return;
        window.addEventListener(OMT_BUS_EVENT, (event) => {
            const data = event && event.detail;
            if (!data || typeof data !== 'object') return;
            try { handler(data); } catch (_) {}
        });
        // E2E fixtures historically inject via window.postMessage. Accept those
        // as input only — we never emit postMessage ourselves (see omtBusPost).
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (data.source !== 'omt-bridge' && data.source !== 'omt-page') return;
            try { handler(data); } catch (_) {}
        });
    }
