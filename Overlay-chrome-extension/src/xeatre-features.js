/* Xeatre-only: hide ALL host chrome (6-column panel + native VJS bar).
 * Safe rules only — never remove nodes, never hide a media host / <video>
 * ancestor (Examino 2.0.4 lesson). No window.postMessage (Examino 2.0.5).
 */
    let xeatreChromeObserver = null;

    function injectXeatreHideCSS() {
        let style = document.getElementById('omt-xeatre-hide-css');
        if (!style) {
            style = document.createElement('style');
            style.id = 'omt-xeatre-hide-css';
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = [
            /* Native Video.js chrome — leaf controls only, never .video-js shell. */
            'html.omt-host-xeatre.omt-hud-on .vjs-control-bar,',
            'html.omt-host-xeatre.omt-hud-on .vjs-big-play-button,',
            'html.omt-host-xeatre.omt-hud-on .vjs-loading-spinner,',
            'html.omt-host-xeatre.omt-hud-on .vjs-poster,',
            'html.omt-host-xeatre.omt-hud-on .vjs-text-track-display,',
            'html.omt-host-xeatre.omt-hud-on .vjs-menu-button-popup .vjs-menu,',
            'html.omt-host-xeatre.omt-hud-on .vjs-error-display,',
            'html.omt-host-xeatre.omt-hud-on .vjs-modal-dialog,',
            /* Known host panel controls from js/dvrplayer.js + screenshot layout. */
            'html.omt-host-xeatre.omt-hud-on #jwplay,',
            'html.omt-host-xeatre.omt-hud-on #GoLive,',
            'html.omt-host-xeatre.omt-hud-on #GoStart,',
            'html.omt-host-xeatre.omt-hud-on #FullScreen,',
            'html.omt-host-xeatre.omt-hud-on #Speed025,',
            'html.omt-host-xeatre.omt-hud-on #Speed05,',
            'html.omt-host-xeatre.omt-hud-on #Speed1,',
            'html.omt-host-xeatre.omt-hud-on #Speed15,',
            'html.omt-host-xeatre.omt-hud-on #Speed2,',
            'html.omt-host-xeatre.omt-hud-on #AutoHide,',
            'html.omt-host-xeatre.omt-hud-on #autohide,',
            'html.omt-host-xeatre.omt-hud-on .xeatre-control-panel,',
            'html.omt-host-xeatre.omt-hud-on .xeatre-host-panel,',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden {',
            '  display: none !important;',
            '  visibility: hidden !important;',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '}',
            /* Undo if a sticky class ever lands on a media host. */
            'html.omt-host-xeatre.omt-hud-on .video-js.omt-xeatre-host-hidden,',
            'html.omt-host-xeatre.omt-hud-on .vjs-tech.omt-xeatre-host-hidden,',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(video),',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(.vjs-tech) {',
            '  display: block !important;',
            '  visibility: visible !important;',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '}'
        ].join('\n');
    }

    function omtXeatreIsMediaHostNode(el) {
        if (!el || el.nodeType !== 1) return true;
        try {
            if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return true;
            if (el.classList && (
                el.classList.contains('video-js') ||
                el.classList.contains('vjs-tech') ||
                el.classList.contains('vjs-player')
            )) return true;
            if (el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return true;
            if (el.querySelector && el.querySelector('video, .vjs-tech, .video-js')) return true;
        } catch (_) {
            return true;
        }
        return false;
    }

    function markXeatreHostHidden(el) {
        if (!el || el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return;
        if (omtXeatreIsMediaHostNode(el)) return;
        el.classList.add('omt-xeatre-host-hidden');
    }

    function scrubXeatreHiddenOnMedia() {
        document.querySelectorAll('.omt-xeatre-host-hidden').forEach((el) => {
            if (omtXeatreIsMediaHostNode(el)) el.classList.remove('omt-xeatre-host-hidden');
        });
    }

    /** Hide the 6-column host panel (below-video and floating) + Auto hide. */
    function hideXeatreNativeChrome() {
        injectXeatreHideCSS();
        scrubXeatreHiddenOnMedia();

        // Stamp the nearest non-media ancestor of known control IDs so both the
        // docked and floating panel copies disappear without touching <video>.
        const controlIds = [
            'jwplay', 'GoLive', 'GoStart', 'FullScreen',
            'Speed025', 'Speed05', 'Speed1', 'Speed15', 'Speed2',
            'AutoHide', 'autohide'
        ];
        const panels = new Set();
        controlIds.forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            markXeatreHostHidden(btn);
            let node = btn.parentElement;
            for (let i = 0; i < 5 && node; i++) {
                if (omtXeatreIsMediaHostNode(node)) break;
                // Prefer a panel-sized container (multiple columns / many buttons).
                const kids = node.querySelectorAll
                    ? node.querySelectorAll('button, [id], .selected').length
                    : 0;
                if (kids >= 6) {
                    panels.add(node);
                    break;
                }
                node = node.parentElement;
            }
        });
        panels.forEach((p) => markXeatreHostHidden(p));

        document.querySelectorAll(
            '.xeatre-control-panel, .xeatre-host-panel, [data-xeatre-panel], #xeatre-controls'
        ).forEach(markXeatreHostHidden);

        // Heuristic: docked/floating grids that look like the screenshot panel
        // (PLAY/PAUSE + LIVE + Speed labels) but never inside .video-js media tree
        // beyond the control bar (control bar already CSS-hidden).
        document.querySelectorAll('div, section, aside, nav').forEach((el) => {
            if (!el || el.closest('#omt-root')) return;
            if (omtXeatreIsMediaHostNode(el)) return;
            if (el.closest && el.closest('.vjs-control-bar')) {
                markXeatreHostHidden(el);
                return;
            }
            const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length > 400) return;
            const hasPlay = /\bPLAY\b/i.test(text) && /\bPAUSE\b/i.test(text);
            const hasLive = /\bLIVE\b/i.test(text);
            const hasSpeed = /\b0\.25\s*Speed\b/i.test(text) || /\bSpeed\b/i.test(text);
            const hasSkip = /(-|−|\+)\s*30\s*s/i.test(text) && /(-|−|\+)\s*2\s*s/i.test(text);
            const hasAutoHide = /\bAuto\s*hide\b/i.test(text);
            if ((hasPlay && hasLive && (hasSpeed || hasSkip)) || (hasAutoHide && hasLive && hasPlay)) {
                markXeatreHostHidden(el);
            }
        });
    }

    const OMT_XEATRE_CHROME_MIN_GAP_MS = 1000;
    try { window.__omtHideXeatreNativeChrome = hideXeatreNativeChrome; } catch (_) {}

    function startXeatreNativeChromeObserver() {
        if (xeatreChromeObserver) return;
        let scheduled = null;
        let lastRun = 0;
        xeatreChromeObserver = new MutationObserver((records) => {
            if (scheduled) return;
            const hostChange = records.some((r) => {
                const t = r.target;
                return !(t && t.nodeType === 1 && (t.id === 'omt-root' || (t.closest && t.closest('#omt-root'))));
            });
            if (!hostChange) return;
            const wait = Math.max(50, OMT_XEATRE_CHROME_MIN_GAP_MS - (Date.now() - lastRun));
            scheduled = setTimeout(() => {
                scheduled = null;
                lastRun = Date.now();
                hideXeatreNativeChrome();
            }, wait);
        });
        const root = document.documentElement || document.body;
        if (root) {
            xeatreChromeObserver.observe(root, { childList: true, subtree: true });
        }
    }

    function stopXeatreNativeChromeObserver() {
        if (xeatreChromeObserver) {
            try { xeatreChromeObserver.disconnect(); } catch (_) {}
            xeatreChromeObserver = null;
        }
    }

    function initXeatrePlayerFeatures() {
        injectXeatreHideCSS();
        hideXeatreNativeChrome();
        startXeatreNativeChromeObserver();
        console.log('[OMT] Xeatre host chrome hide installed.');
    }
