/* Xeatre-only: hide host chrome (6-column panel + VJS control bar).
 * v2.2.5: transplant the pre-2.1.0 safe hide — never blank the picture.
 * - Hide only control-bar / chrome leaves (not poster / tech / player shell).
 * - Never call videojs(); never reparent <video>.
 * - Force-visible CSS on the tech so a sticky class cannot black the feed.
 */
    let xeatreChromeObserver = null;

    function omtDebugXeatre(step, detail) {
        try {
            if (detail === undefined) {
                console.log('[OMT-DEBUG][xeatre] ' + step);
                return;
            }
            let payload;
            try {
                payload = typeof detail === 'string' ? detail : JSON.stringify(detail);
            } catch (_) {
                payload = String(detail);
            }
            console.log('[OMT-DEBUG][xeatre] ' + step + ' ' + payload);
        } catch (_) {}
    }

    function injectXeatreHideCSS() {
        let style = document.getElementById('omt-xeatre-hide-css');
        if (!style) {
            style = document.createElement('style');
            style.id = 'omt-xeatre-hide-css';
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = [
            /* Chrome only — never .video-js shell, never video/.vjs-tech, never poster
             * (hiding poster while tech fails to paint = field black screen). */
            'html.omt-host-xeatre.omt-hud-on .vjs-control-bar,',
            'html.omt-host-xeatre.omt-hud-on .vjs-big-play-button,',
            'html.omt-host-xeatre.omt-hud-on .vjs-menu-button-popup .vjs-menu,',
            /* Pre-2.1.0 known-good ControlBar overlays (a69dacb). */
            'html.omt-host-xeatre.omt-hud-on #ControlBar.overlay-fullscreen,',
            'html.omt-host-xeatre.omt-hud-on #ControlBar.overlay-normal,',
            'html.omt-host-xeatre.omt-hud-on #ControlBar,',
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
            'html.omt-host-xeatre.omt-hud-on #hdmi-video.omt-xeatre-host-hidden,',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(video),',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(.vjs-tech) {',
            '  display: block !important;',
            '  visibility: visible !important;',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '}',
            /* Hard guarantee: the picture layer stays painted under our HUD. */
            'html.omt-host-xeatre.omt-hud-on #hdmi-video,',
            'html.omt-host-xeatre.omt-hud-on #hdmi-video video,',
            'html.omt-host-xeatre.omt-hud-on .video-js > video,',
            'html.omt-host-xeatre.omt-hud-on video.vjs-tech,',
            'html.omt-host-xeatre.omt-hud-on .vjs-tech {',
            '  visibility: visible !important;',
            '  opacity: 1 !important;',
            '}'
        ].join('\n');
    }

    function omtXeatreIsMediaHostNode(el) {
        if (!el || el.nodeType !== 1) return true;
        try {
            if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return true;
            if (el.id === 'hdmi-video') return true;
            if (el.classList && (
                el.classList.contains('video-js') ||
                el.classList.contains('vjs-tech') ||
                el.classList.contains('vjs-player')
            )) return true;
            if (el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return true;
            if (el.querySelector && el.querySelector('video, .vjs-tech, .video-js, #hdmi-video')) return true;
        } catch (_) {
            return true;
        }
        return false;
    }

    function markXeatreHostHidden(el) {
        if (!el || el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return;
        if (omtXeatreIsMediaHostNode(el)) return;
        // Never stamp sticky hide inside the VJS player tree except the control bar.
        try {
            if (el.closest && el.closest('.video-js, #hdmi-video') &&
                !(el.closest('.vjs-control-bar') || el.classList.contains('vjs-control-bar'))) {
                return;
            }
        } catch (_) {}
        el.classList.add('omt-xeatre-host-hidden');
    }

    function scrubXeatreHiddenOnMedia() {
        document.querySelectorAll('.omt-xeatre-host-hidden').forEach((el) => {
            if (omtXeatreIsMediaHostNode(el)) el.classList.remove('omt-xeatre-host-hidden');
        });
    }

    function omtXeatreCsSnap(el) {
        if (!el) return null;
        try {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                id: el.id || null,
                className: typeof el.className === 'string' ? el.className.slice(0, 120) : null,
                display: cs.display,
                visibility: cs.visibility,
                opacity: cs.opacity,
                w: Math.round(r.width),
                h: Math.round(r.height)
            };
        } catch (_) {
            return null;
        }
    }

    /** Field diagnostics: video + ancestors up to the player shell. */
    function describeXeatreVideoPaint() {
        const video = (typeof site !== 'undefined' && site && typeof site.findVideo === 'function' && site.findVideo()) ||
            document.querySelector('#hdmi-video video, #hdmi-video.vjs-tech, video.vjs-tech, .video-js video, video');
        const chain = [];
        let node = video;
        let guard = 0;
        while (node && node.nodeType === 1 && guard++ < 12) {
            chain.push(omtXeatreCsSnap(node));
            if (node.classList && (node.classList.contains('video-js') || node.id === 'hdmi-video' ||
                node.id === 'video-player')) break;
            node = node.parentElement;
        }
        let playerInitCount = null;
        let playerIds = [];
        try {
            if (window.videojs && typeof window.videojs.getPlayers === 'function') {
                const players = window.videojs.getPlayers() || {};
                playerIds = Object.keys(players);
                playerInitCount = playerIds.length;
            }
        } catch (_) {}
        return {
            videoFound: !!video,
            videoId: video && video.id || null,
            chain,
            playerInitCount,
            playerIds,
            hostXeatre: document.documentElement.classList.contains('omt-host-xeatre'),
            hudOn: document.documentElement.classList.contains('omt-hud-on')
        };
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
            'AutoHide', 'autohide', 'ControlBar'
        ];
        const panels = new Set();
        controlIds.forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            markXeatreHostHidden(btn);
            let node = btn.parentElement;
            for (let i = 0; i < 5 && node; i++) {
                if (omtXeatreIsMediaHostNode(node)) break;
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
            '.xeatre-control-panel, .xeatre-host-panel, [data-xeatre-panel], #xeatre-controls, #ControlBar'
        ).forEach(markXeatreHostHidden);

        // Leaf VJS chrome only (already CSS-hidden) — no broad innerText heuristic
        // (2.1.0 scan could stamp sticky classes near the media tree).
        document.querySelectorAll('.vjs-control-bar').forEach(markXeatreHostHidden);

        omtDebugXeatre('hide-chrome', describeXeatreVideoPaint());
    }

    const OMT_XEATRE_CHROME_MIN_GAP_MS = 1000;
    try { window.__omtHideXeatreNativeChrome = hideXeatreNativeChrome; } catch (_) {}
    try { window.__omtDescribeXeatreVideoPaint = describeXeatreVideoPaint; } catch (_) {}

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
            // childList only — attribute thrash on the tech must not re-run hide.
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
        omtDebugXeatre('init', describeXeatreVideoPaint());
        console.log('[OMT] Xeatre host chrome hide installed.');
    }
