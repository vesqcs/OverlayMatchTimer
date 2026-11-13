/* Resolve the active site adapter from host / path / data-omt-site. */
    function detectSite() {
        const host = (location.hostname || '').toLowerCase();
        const path = location.pathname || '';
        const forced = (document.documentElement.dataset.omtSite || '').toLowerCase();
        const proto = (location.protocol || '').toLowerCase();

        // Extension local player page (chrome-extension://…/player.html)
        if (
            forced === 'local' ||
            /\/player\.html$/i.test(path) ||
            (proto === 'chrome-extension:' && /player\.html/i.test(path))
        ) {
            return SITE_LOCAL;
        }

        if (forced === 'examino' || host.includes('examino') || /examino/i.test(path)) {
            return SITE_EXAMINO;
        }
        // TODO(xeatre): enable when Vasco provides material
        if (forced === 'xeatre' || host.includes('xeatre')) {
            return SITE_XEATRE;
        }
        if (forced === 'inplayip' || host.includes('inplayip') || /inplay/i.test(path)) {
            return SITE_INPLAYIP;
        }
        // Local Playwright fixtures served from 127.0.0.1 / localhost
        if (host === 'localhost' || host === '127.0.0.1') {
            if (/examino/i.test(path)) return SITE_EXAMINO;
            if (/inplay/i.test(path)) return SITE_INPLAYIP;
            if (/player\.html/i.test(path) || forced === 'local') return SITE_LOCAL;
        }
        return null;
    }

    const site = detectSite();
    if (!site) {
        console.log('[OMT] No matching site adapter — content script idle.');
        return;
    }
    if (site.stub) {
        console.log('[OMT] Xeatre adapter is a stub (out of scope) — content script idle.');
        return;
    }
    console.log('[OMT] Site adapter:', site.id);
