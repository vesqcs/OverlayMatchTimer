/* Xeatre-only: hide host chrome (6-column panel + VJS control bar + H5Live nano).
 * v2.2.5: transplant the pre-2.1.0 safe hide — never blank the picture.
 * v2.2.9: never display:none #hdmi-video / .video-js / any ancestor of <video>
 *   (field: #ControlBar wrapped the player → bare #ControlBar hide = black).
 * v2.2.17: live ULL nanoplayer.html uses nanoStream H5Live (VIDEO#h5live-playerDiv
 *   in #playerDiv). Host chrome is DIV#controls-panel.glass-panel — same id our
 *   HUD used to use. OMT panel is now #omt-controls-panel; hide host #controls-panel.
 * - Hide only control-bar / chrome leaves (not poster / tech / player shell).
 * - Never call videojs(); never reparent <video>; never attribute-mutate the shell.
 * - Force-visible CSS on the tech + player root so a sticky class cannot black the feed.
 */
    let xeatreChromeObserver = null;

    /** Debug-only. Enable with localStorage.omtDebugXeatre='true' or window.__OMT_DEBUG_XEATRE=true.
     * hide-chrome used to log on every MutationObserver pass (VJS user-active thrash) — never do that. */
    function omtXeatreDebugEnabled() {
        try {
            if (window.__OMT_DEBUG_XEATRE === true) return true;
            return localStorage.getItem('omtDebugXeatre') === 'true';
        } catch (_) {
            return false;
        }
    }

    function omtDebugXeatre(step, detail) {
        if (!omtXeatreDebugEnabled()) return;
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

    /** CSS :not(:has(...)) so we never hide a node that contains the picture. */
    const OMT_XEATRE_NOT_MEDIA =
        ':not(:has(#hdmi-video)):not(:has(video)):not(:has(.vjs-tech)):not(:has(.video-js))';

    function injectXeatreHideCSS() {
        let style = document.getElementById('omt-xeatre-hide-css');
        if (!style) {
            style = document.createElement('style');
            style.id = 'omt-xeatre-hide-css';
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = [
            /* Chrome leaves only — never player root, never video ancestors. */
            'html.omt-host-xeatre.omt-hud-on .vjs-control-bar,',
            'html.omt-host-xeatre.omt-hud-on .vjs-big-play-button,',
            'html.omt-host-xeatre.omt-hud-on .vjs-menu-button-popup .vjs-menu,',
            /* ControlBar only when it does NOT wrap the player (field black). */
            'html.omt-host-xeatre.omt-hud-on #ControlBar.overlay-fullscreen' + OMT_XEATRE_NOT_MEDIA + ',',
            'html.omt-host-xeatre.omt-hud-on #ControlBar.overlay-normal' + OMT_XEATRE_NOT_MEDIA + ',',
            'html.omt-host-xeatre.omt-hud-on #ControlBar' + OMT_XEATRE_NOT_MEDIA + ',',
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
            'html.omt-host-xeatre.omt-hud-on .xeatre-control-panel' + OMT_XEATRE_NOT_MEDIA + ',',
            'html.omt-host-xeatre.omt-hud-on .xeatre-host-panel' + OMT_XEATRE_NOT_MEDIA + ',',
            /* H5Live nanoplayer (live ULL): host bar id clashes with pre-2.2.17 OMT.
               Our HUD is #omt-controls-panel — safe to hide every host #controls-panel. */
            'html.omt-host-xeatre.omt-hud-on #controls-panel' + OMT_XEATRE_NOT_MEDIA + ',',
            'html.omt-host-xeatre.omt-hud-on #controls-panel .controls-content,',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden' + OMT_XEATRE_NOT_MEDIA + ' {',
            '  display: none !important;',
            '  visibility: hidden !important;',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '}',
            /* Undo sticky hide on media hosts / any node that contains the picture. */
            'html.omt-host-xeatre.omt-hud-on .video-js.omt-xeatre-host-hidden,',
            'html.omt-host-xeatre.omt-hud-on .vjs-tech.omt-xeatre-host-hidden,',
            'html.omt-host-xeatre.omt-hud-on #hdmi-video.omt-xeatre-host-hidden,',
            'html.omt-host-xeatre.omt-hud-on #h5live-playerDiv.omt-xeatre-host-hidden,',
            'html.omt-host-xeatre.omt-hud-on #playerDiv.omt-xeatre-host-hidden,',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(video),',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(.vjs-tech),',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(#hdmi-video),',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(#h5live-playerDiv),',
            'html.omt-host-xeatre.omt-hud-on .omt-xeatre-host-hidden:has(.video-js) {',
            '  display: block !important;',
            '  visibility: visible !important;',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '}',
            /* Hard guarantee: player root + tech stay painted (incl. display).
             * pointer-events:auto — field VJS often leaves .video-js/tech as
             * pointer-events:none so clicks land on #videowrapper; we still
             * hit-test by rect, but restoring PE does not hurt chrome hide
             * (control bar stays display:none). Our hide rules never set PE
             * none on .video-js itself — only on chrome leaves. */
            'html.omt-host-xeatre.omt-hud-on #hdmi-video,',
            'html.omt-host-xeatre.omt-hud-on #hdmi-video.video-js,',
            'html.omt-host-xeatre.omt-hud-on .video-js,',
            'html.omt-host-xeatre.omt-hud-on #hdmi-video video,',
            'html.omt-host-xeatre.omt-hud-on .video-js > video,',
            'html.omt-host-xeatre.omt-hud-on video.vjs-tech,',
            'html.omt-host-xeatre.omt-hud-on .vjs-tech,',
            'html.omt-host-xeatre.omt-hud-on #playerDiv > video,',
            'html.omt-host-xeatre.omt-hud-on video#h5live-playerDiv,',
            'html.omt-host-xeatre.omt-hud-on #h5live-playerDiv {',
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
            if (el.id === 'hdmi-video' || el.id === 'h5live-playerDiv' || el.id === 'playerDiv') return true;
            if (el.classList && (
                el.classList.contains('video-js') ||
                el.classList.contains('vjs-tech') ||
                el.classList.contains('vjs-player')
            )) return true;
            if (el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return true;
            // Any ancestor/container of the picture — never stamp hide on these.
            if (el.querySelector && el.querySelector(
                'video, .vjs-tech, .video-js, #hdmi-video, #h5live-playerDiv'
            )) return true;
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

    /** Drop sticky hide from the video → shell ancestor chain (belt + suspenders). */
    function omtXeatreEnsurePlayerVisible() {
        const video = (typeof site !== 'undefined' && site && typeof site.findVideo === 'function' && site.findVideo()) ||
            document.querySelector('#hdmi-video video, #hdmi-video.vjs-tech, video.vjs-tech, .video-js video, video');
        let node = video;
        let guard = 0;
        while (node && node.nodeType === 1 && guard++ < 16) {
            try {
                if (node.classList && node.classList.contains('omt-xeatre-host-hidden')) {
                    node.classList.remove('omt-xeatre-host-hidden');
                }
            } catch (_) {}
            if (node.id === 'hdmi-video' || (node.classList && node.classList.contains('video-js'))) {
                // Continue one more level so a wrapping #ControlBar is scrubbed too.
            }
            if (node === document.body || node === document.documentElement) break;
            node = node.parentElement;
        }
        scrubXeatreHiddenOnMedia();
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
                h: Math.round(r.height),
                hasHiddenClass: !!(el.classList && el.classList.contains('omt-xeatre-host-hidden'))
            };
        } catch (_) {
            return null;
        }
    }

    /** Field diagnostics: video + ancestors up past the player shell. */
    function describeXeatreVideoPaint() {
        const video = (typeof site !== 'undefined' && site && typeof site.findVideo === 'function' && site.findVideo()) ||
            document.querySelector('#hdmi-video video, #hdmi-video.vjs-tech, video.vjs-tech, .video-js video, video');
        const chain = [];
        let node = video;
        let guard = 0;
        while (node && node.nodeType === 1 && guard++ < 12) {
            chain.push(omtXeatreCsSnap(node));
            if (node === document.body || node === document.documentElement) break;
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

        // ControlBar: only when it does not wrap the player.
        document.querySelectorAll('#ControlBar').forEach((el) => {
            if (!omtXeatreIsMediaHostNode(el)) markXeatreHostHidden(el);
        });

        // Leaf VJS chrome only — no broad heuristic near the media tree.
        document.querySelectorAll('.vjs-control-bar').forEach(markXeatreHostHidden);

        // H5Live nanoplayer bar (live ULL). Never our #omt-controls-panel.
        document.querySelectorAll('#controls-panel').forEach((el) => {
            if (omtRoot && omtRoot.contains(el)) return;
            if (omtXeatreIsMediaHostNode(el)) return;
            markXeatreHostHidden(el);
        });

        omtXeatreEnsurePlayerVisible();
        // Debug-only (gated). Never stringify paint chains on every chrome pass.
        if (omtXeatreDebugEnabled()) omtDebugXeatre('hide-chrome', describeXeatreVideoPaint());
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

    /* ---- v2.2.10 viewport fit (Xeatre only, our layer) ----
     * Host .vjs-fluid sizes height from width (padding-top 56.25%) and ignores
     * window height → overflow/scroll; absolute #omt-root then scrolls away.
     * Fit the player to the viewport (contain/letterbox) and pin the HUD.
     * v2.2.11: HUD micro/compact via CSS classes only (scale multiplies user
     * panel size prefs). Clear leftover panel inline fit on grow so restore
     * needs no click. Pointer over player/video reveals chrome. */
    let xeatreViewportFitInstalled = false;
    let xeatreFitRaf = 0;
    let xeatreHoverRevealInstalled = false;
    let xeatreResizeObserver = null;
    const xeatreFitStyled = new Set();

    function omtXeatreFitStyle(el, props) {
        if (!el || !el.style) return;
        try {
            Object.keys(props).forEach((k) => {
                const v = props[k];
                if (v == null || v === '') el.style.removeProperty(k);
                else el.style.setProperty(k, v, 'important');
            });
            xeatreFitStyled.add(el);
        } catch (_) {}
    }

    function omtXeatreClearFitStyles() {
        xeatreFitStyled.forEach((el) => {
            try {
                if (!el || !el.style) return;
                [
                    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
                    'padding-top', 'padding-bottom', 'margin', 'margin-top', 'margin-left',
                    'margin-right', 'margin-bottom', 'position', 'left', 'top', 'right', 'bottom',
                    'transform', 'transform-origin', 'box-sizing', 'overflow', 'display',
                    'background', 'scale'
                ].forEach((k) => {
                    try { el.style.removeProperty(k); } catch (_) {}
                });
            } catch (_) {}
        });
        xeatreFitStyled.clear();
    }

    /** Drop panel inline fit leftovers so CSS classes + user prefs win on grow. */
    function omtXeatreClearPanelInlineFit() {
        const panel = document.getElementById('omt-controls-panel');
        if (!panel || !panel.style) return;
        [
            'top', 'bottom', 'left', 'right', 'transform', 'transform-origin',
            'width', 'max-width', 'max-height', 'overflow', 'scale'
        ].forEach((k) => {
            try { panel.style.removeProperty(k); } catch (_) {}
        });
        try { xeatreFitStyled.delete(panel); } catch (_) {}
        try {
            if (typeof omtApplyPanelAppearance === 'function') omtApplyPanelAppearance();
        } catch (_) {}
    }

    function onXeatreHoverRevealActivity() {
        try {
            if (typeof noteOmtUiActivity === 'function') noteOmtUiActivity(true);
            else if (typeof resetControlsTimeout === 'function') resetControlsTimeout(true);
        } catch (_) {}
    }

    function startXeatreHoverReveal() {
        if (xeatreHoverRevealInstalled) return;
        xeatreHoverRevealInstalled = true;
        // Fixed HUD + letterboxed player: mousemove on <video> alone often misses
        // (poster / tech overlays / black bars). Listen on the player shell and
        // document so pointer over the video area reveals panel + bar.
        const opts = { capture: true, passive: true };
        document.addEventListener('pointermove', onXeatreHoverRevealActivity, opts);
        document.addEventListener('mousemove', onXeatreHoverRevealActivity, opts);
    }

    function stopXeatreHoverReveal() {
        if (!xeatreHoverRevealInstalled) return;
        document.removeEventListener('pointermove', onXeatreHoverRevealActivity, true);
        document.removeEventListener('mousemove', onXeatreHoverRevealActivity, true);
        xeatreHoverRevealInstalled = false;
    }

    /**
     * Contain 16:9 player in the viewport; kill fluid padding overflow; no scroll.
     * Letterbox with black margins. HUD stays viewport-fixed via CSS.
     */
    function omtXeatreFitViewport() {
        if (!(site && site.id === 'xeatre')) return;
        if (!document.documentElement.classList.contains('omt-hud-on')) return;

        const fs = document.fullscreenElement;
        const vw = Math.max(1, (fs && fs.clientWidth) || window.innerWidth || 1);
        const vh = Math.max(1, (fs && fs.clientHeight) || window.innerHeight || 1);

        // Contain 16:9 in the viewport.
        let w = vw;
        let h = w * 9 / 16;
        if (h > vh) {
            h = vh;
            w = h * 16 / 9;
        }
        w = Math.max(1, Math.floor(w));
        h = Math.max(1, Math.floor(h));
        const left = Math.max(0, Math.floor((vw - w) / 2));
        const top = Math.max(0, Math.floor((vh - h) / 2));

        const shell = document.getElementById('hdmi-video') ||
            document.querySelector('.video-js');
        if (!shell) return;

        // Outer box: prefer #videowrapper (field click target), else #ControlBar.
        // Intermediates between shell and box get height:100% so the tech is not 0×N.
        let box = shell;
        try {
            const videoWrapper = shell.closest('#videowrapper');
            const controlBar = shell.closest('#ControlBar');
            const wrap = videoWrapper || controlBar || shell.parentElement;
            if (wrap && wrap !== document.body && wrap !== document.documentElement &&
                wrap.contains(shell)) {
                box = wrap;
            }
        } catch (_) {}

        // Page chrome that used to sit below the player must not extend document height.
        document.querySelectorAll(
            '.xeatre-control-panel:not(.floating), #xeatre-panel-dock, #status'
        ).forEach((el) => {
            omtXeatreFitStyle(el, {
                display: 'none',
                height: '0px',
                margin: '0px',
                padding: '0px',
                overflow: 'hidden'
            });
        });

        // html/body: no scroll, fill viewport (CSS also sets this; reinforce).
        omtXeatreFitStyle(document.documentElement, {
            overflow: 'hidden',
            height: '100%',
            'max-height': '100vh',
            width: '100%',
            margin: '0px'
        });
        omtXeatreFitStyle(document.body, {
            overflow: 'hidden',
            height: '100%',
            'max-height': '100vh',
            width: '100%',
            margin: '0px',
            position: 'relative',
            background: '#000'
        });

        // Outer page wrapper: fill viewport, no overflow.
        const page = document.getElementById('player-wrap') ||
            (box.parentElement && box.parentElement.id === 'player-wrap' ? box.parentElement : null) ||
            box.parentElement;
        if (page && page !== document.body && page !== document.documentElement) {
            omtXeatreFitStyle(page, {
                position: 'fixed',
                left: '0px',
                top: '0px',
                width: vw + 'px',
                height: vh + 'px',
                margin: '0px',
                padding: '0px',
                overflow: 'hidden',
                'max-width': '100vw',
                'max-height': '100vh',
                'box-sizing': 'border-box'
            });
        }

        // Player box: explicit size, centered, no fluid padding-top.
        omtXeatreFitStyle(box, {
            position: 'absolute',
            left: left + 'px',
            top: top + 'px',
            width: w + 'px',
            height: h + 'px',
            'max-width': '100vw',
            'max-height': '100vh',
            'padding-top': '0px',
            'padding-bottom': '0px',
            margin: '0px',
            overflow: 'hidden',
            'box-sizing': 'border-box'
        });

        // Fill every node from shell up to (but not including) box — e.g.
        // #hdmi-video and #ControlBar inside #videowrapper.
        if (shell !== box) {
            let fill = shell;
            let guard = 0;
            while (fill && fill !== box && guard++ < 8) {
                omtXeatreFitStyle(fill, {
                    position: 'relative',
                    left: '0px',
                    top: '0px',
                    width: '100%',
                    height: '100%',
                    'max-width': '100%',
                    'max-height': '100%',
                    'padding-top': '0px',
                    'padding-bottom': '0px',
                    margin: '0px',
                    overflow: 'hidden',
                    'box-sizing': 'border-box'
                });
                fill = fill.parentElement;
            }
        }

        // Tech fills the shell.
        const tech = shell.querySelector('video.vjs-tech, video');
        if (tech) {
            omtXeatreFitStyle(tech, {
                position: 'absolute',
                left: '0px',
                top: '0px',
                width: '100%',
                height: '100%',
                'max-width': '100%',
                'max-height': '100%',
                'object-fit': 'contain'
            });
        }

        // HUD compact / micro when the popup is small — CSS only.
        // Scale is a multiplier on top of user panel size/compact prefs.
        if (omtRoot) {
            try {
                const micro = vw < 480 || vh < 280;
                const compact = vw < 720 || vh < 420;
                const wasMicro = omtRoot.classList.contains('omt-xeatre-micro');
                omtRoot.classList.toggle('omt-compact', compact);
                omtRoot.classList.toggle('omt-xeatre-micro', micro);
                // Enter/leave micro: strip sticky inline transform/width so CSS
                // scale + user size prefs apply (grow must not need a click).
                if (wasMicro !== micro) {
                    omtXeatreClearPanelInlineFit();
                } else if (!micro) {
                    const panel = document.getElementById('omt-controls-panel');
                    const t = panel && panel.style
                        ? (panel.style.getPropertyValue('transform') || '')
                        : '';
                    if (panel && (/scale\s*\(/.test(t) || panel.style.getPropertyValue('scale'))) {
                        omtXeatreClearPanelInlineFit();
                    }
                }
            } catch (_) {}
        }

        try {
            if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
        } catch (_) {}

        if (typeof omtUpdateClockPictureInset === 'function') omtUpdateClockPictureInset();

        omtDebugXeatre('viewport-fit', {
            vw, vh, w, h, left, top,
            scrollW: document.documentElement.scrollWidth,
            scrollH: document.documentElement.scrollHeight,
            scrollY: window.scrollY || 0,
            micro: !!(omtRoot && omtRoot.classList.contains('omt-xeatre-micro')),
            compact: !!(omtRoot && omtRoot.classList.contains('omt-compact'))
        });
    }

    function omtXeatreScheduleViewportFit() {
        if (xeatreFitRaf) return;
        xeatreFitRaf = requestAnimationFrame(() => {
            xeatreFitRaf = 0;
            omtXeatreFitViewport();
        });
    }

    function onXeatreViewportResize() {
        omtXeatreScheduleViewportFit();
    }

    function onXeatreFullscreenChange() {
        omtXeatreScheduleViewportFit();
    }

    function startXeatreViewportFit() {
        if (xeatreViewportFitInstalled) {
            omtXeatreScheduleViewportFit();
            return;
        }
        xeatreViewportFitInstalled = true;
        window.addEventListener('resize', onXeatreViewportResize);
        document.addEventListener('fullscreenchange', onXeatreFullscreenChange);
        try {
            if (typeof ResizeObserver === 'function') {
                xeatreResizeObserver = new ResizeObserver(() => omtXeatreScheduleViewportFit());
                xeatreResizeObserver.observe(document.documentElement);
                if (document.body) xeatreResizeObserver.observe(document.body);
            }
        } catch (_) {
            xeatreResizeObserver = null;
        }
        startXeatreHoverReveal();
        omtXeatreFitViewport();
        // Second pass after layout/HUD settle.
        setTimeout(() => omtXeatreFitViewport(), 50);
        setTimeout(() => omtXeatreFitViewport(), 250);
    }

    function stopXeatreViewportFit() {
        if (xeatreFitRaf) {
            try { cancelAnimationFrame(xeatreFitRaf); } catch (_) {}
            xeatreFitRaf = 0;
        }
        if (xeatreResizeObserver) {
            try { xeatreResizeObserver.disconnect(); } catch (_) {}
            xeatreResizeObserver = null;
        }
        stopXeatreHoverReveal();
        if (xeatreViewportFitInstalled) {
            window.removeEventListener('resize', onXeatreViewportResize);
            document.removeEventListener('fullscreenchange', onXeatreFullscreenChange);
            xeatreViewportFitInstalled = false;
        }
        omtXeatreClearFitStyles();
        omtXeatreClearPanelInlineFit();
        if (omtRoot) {
            try {
                omtRoot.classList.remove('omt-xeatre-micro', 'omt-compact');
            } catch (_) {}
        }
    }

    try { window.__omtXeatreFitViewport = omtXeatreFitViewport; } catch (_) {}

    /* ---- v2.2.15 click-to-play/pause on the video picture ----
     * Field probe (Vasco): click target is DIV#videowrapper; composedPath /
     * elementsFromPoint = videowrapper|BODY|HTML — VIDEO#hdmi-video_html5_api
     * and DIV#hdmi-video.video-js are absent (pointer-events:none on them from
     * VJS/host, not from our chrome-hide rules). Fix: primary-button pointerup
     * with small movement whose point lies in video.getBoundingClientRect(),
     * regardless of event.target; exclude OMT panel/bar/timer + visible Xeatre
     * controls; toggle once (stopImmediatePropagation). */
    let xeatreToggleConsumedGesture = false;
    let xeatrePointerDownX = 0;
    let xeatrePointerDownY = 0;

    function isXeatreHostChromeTarget(el) {
        if (!el || !el.closest) return false;
        // Visible host controls only — never the whole #videowrapper / #ControlBar
        // wrapper that contains the picture.
        if (el.closest('.vjs-control-bar, .xeatre-control-panel, .xeatre-host-panel')) return true;
        // H5Live nanoplayer native bar (id clash fixed — ours is #omt-controls-panel).
        try {
            const hostPanel = el.closest('#controls-panel');
            if (hostPanel && !(omtRoot && omtRoot.contains(hostPanel))) return true;
        } catch (_) {}
        if (el.closest('#jwplay, #GoLive, #GoStart, #FullScreen, #AutoHide, #autohide')) return true;
        if (el.closest('#Speed025, #Speed05, #Speed1, #Speed15, #Speed2')) return true;
        if (el.closest('#SkipM30, #SkipM7, #SkipM2, #SkipP2, #SkipP7, #SkipP30')) return true;
        if (el.closest('#GoDoc, #GoEnd, #RtmpBtn')) return true;
        if (el.closest('button, a, input, select, textarea, [role="button"]')) {
            if (el.closest('#ControlBar, .xeatre-control-panel, .vjs-control-bar, #videowrapper')) {
                // Buttons inside the player chrome — not the empty wrapper itself.
                return true;
            }
        }
        return false;
    }

    function isXeatreOmtUiTarget(el) {
        if (!el) return false;
        if (el.closest && el.closest('#omt-controls-panel, #omt-timeline-bar, #match-timer-wrap, #omt-more-panel')) {
            return true;
        }
        if (typeof isOmtInteractiveTarget === 'function' && isOmtInteractiveTarget(el)) return true;
        if (omtRoot && omtRoot.contains(el)) {
            const pe = (el.nodeType === 1) ? getComputedStyle(el).pointerEvents : 'none';
            if (pe && pe !== 'none') return true;
            if (el.closest && el.closest('button, select, input, a')) return true;
        }
        return false;
    }

    function resolveLiveXeatreMedia() {
        const found = (site && typeof site.findVideo === 'function')
            ? site.findVideo()
            : null;
        if (found && found.isConnected) return found;
        if (vid && vid.isConnected) return vid;
        return document.querySelector(
            '#hdmi-video video, video#hdmi-video_html5_api, video.vjs-tech, #hdmi-video.vjs-tech, ' +
            'video#h5live-playerDiv, #playerDiv > video, video'
        );
    }

    function pointInRect(x, y, rect) {
        return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    /** True if stack/target is OMT HUD or a visible Xeatre control at (x,y). */
    function xeatrePointHitsExcludedUi(x, y, eventTarget) {
        const check = (el) => {
            if (!el || el === document.documentElement || el === document.body) return false;
            if (isXeatreOmtUiTarget(el)) return true;
            if (isXeatreHostChromeTarget(el)) return true;
            return false;
        };
        if (check(eventTarget)) return true;
        let stack = [];
        try {
            stack = document.elementsFromPoint(x, y) || [];
        } catch (_) {
            stack = [];
        }
        for (let i = 0; i < stack.length; i++) {
            if (check(stack[i])) return true;
        }
        return false;
    }

    /**
     * Field rule: point inside the live video's box → media click, regardless
     * of event.target / hit stack (videowrapper absorbs clicks when tech has
     * pointer-events:none).
     */
    function hitTestXeatreMediaAt(x, y, eventTarget) {
        if (!isFinite(x) || !isFinite(y)) return null;
        if (xeatrePointHitsExcludedUi(x, y, eventTarget)) return null;
        const media = resolveLiveXeatreMedia();
        if (!media) return null;
        try {
            if (pointInRect(x, y, media.getBoundingClientRect())) return media;
            const shell = media.closest && (
                media.closest('#hdmi-video') ||
                media.closest('.video-js') ||
                media.closest('#videowrapper') ||
                media.closest('#playerDiv')
            );
            if (shell && pointInRect(x, y, shell.getBoundingClientRect())) return media;
        } catch (_) {}
        return null;
    }

    function xeatreMediaCanToggle(media) {
        if (!media || !media.isConnected) return false;
        if (media.src || media.currentSrc || media.srcObject) return true;
        try {
            if (media.readyState > 0) return true;
            if (media.seekable && media.seekable.length > 0) return true;
        } catch (_) {}
        // Field MSE often has empty src until chunks land — still allow toggle.
        return true;
    }

    function stopXeatreGesture(e) {
        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
        try { e.stopImmediatePropagation(); } catch (_) {}
    }

    function performXeatreClickToggle(e, media) {
        stopXeatreGesture(e);
        try { omtUserGestureSeen = true; } catch (_) {}
        if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
        if (typeof clearExaminoHostResumeIntent === 'function') clearExaminoHostResumeIntent();
        if (media.paused || media.ended) {
            try {
                const p = media.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch (_) {
                if (typeof safePlay === 'function') safePlay(media);
            }
            if (typeof mostrarOSD === 'function') mostrarOSD('Play');
        } else {
            try { media.pause(); } catch (_) {}
            if (typeof mostrarOSD === 'function') mostrarOSD('Pause');
        }
        if (typeof noteOmtUiActivity === 'function') noteOmtUiActivity(false);
        else if (typeof resetControlsTimeout === 'function') resetControlsTimeout(false);
    }

    function handleXeatrePointerDownArm(e) {
        if (!(site && site.id === 'xeatre')) return;
        if (e.button != null && e.button !== 0) return;
        xeatreToggleConsumedGesture = false;
        xeatreClickArmed = false;
        const x = e.clientX;
        const y = e.clientY;
        const media = hitTestXeatreMediaAt(x, y, e.target);
        if (!media || !xeatreMediaCanToggle(media)) return;
        xeatreClickArmed = true;
        xeatrePointerDownX = x;
        xeatrePointerDownY = y;
        // Block VJS / host from also toggling on this gesture.
        stopXeatreGesture(e);
    }

    function handleXeatrePointerUpToggle(e) {
        if (!(site && site.id === 'xeatre')) return;
        if (!xeatreClickArmed) return;
        xeatreClickArmed = false;
        if (e.button != null && e.button !== 0) return;
        const x = e.clientX;
        const y = e.clientY;
        // Ignore drag-away (treat as scrub / pan, not click).
        if (Math.abs(x - xeatrePointerDownX) > 12 || Math.abs(y - xeatrePointerDownY) > 12) {
            return;
        }
        const media = hitTestXeatreMediaAt(x, y, e.target);
        if (!media || !xeatreMediaCanToggle(media)) return;
        xeatreToggleConsumedGesture = true;
        performXeatreClickToggle(e, media);
    }

    function handleXeatreClickToggle(e) {
        if (!(site && site.id === 'xeatre')) return;
        // pointerup already toggled — swallow click so VJS cannot double-toggle.
        if (xeatreToggleConsumedGesture) {
            xeatreToggleConsumedGesture = false;
            stopXeatreGesture(e);
            return;
        }
        // Mouse-only paths that skipped pointer events.
        if (e.button != null && e.button !== 0) return;
        const media = hitTestXeatreMediaAt(e.clientX, e.clientY, e.target);
        if (!media || !xeatreMediaCanToggle(media)) return;
        xeatreToggleConsumedGesture = true;
        performXeatreClickToggle(e, media);
    }

    function installXeatreClickToToggle() {
        if (xeatreClickToggleInstalled) return;
        xeatreClickToggleInstalled = true;
        window.addEventListener('pointerdown', handleXeatrePointerDownArm, true);
        window.addEventListener('mousedown', handleXeatrePointerDownArm, true);
        window.addEventListener('pointerup', handleXeatrePointerUpToggle, true);
        window.addEventListener('mouseup', handleXeatrePointerUpToggle, true);
        window.addEventListener('click', handleXeatreClickToggle, true);
        console.log('[OMT] Xeatre click-to-toggle installed (capture hit-test + pointerup).');
    }

    function initXeatrePlayerFeatures() {
        injectXeatreHideCSS();
        hideXeatreNativeChrome();
        startXeatreNativeChromeObserver();
        startXeatreViewportFit();
        installXeatreClickToToggle();
        if (typeof omtUpdateClockPictureInset === 'function') omtUpdateClockPictureInset();
        omtDebugXeatre('init', describeXeatreVideoPaint());
        console.log('[OMT] Xeatre host chrome hide + viewport fit installed.');
    }
