/* Document Picture-in-Picture pop-out (v2.4.0) — additive only.
 *
 * Opens an always-on-top Chromium Document PiP window with the video,
 * match timer, and a compact OMT control strip. Unsupported browsers
 * simply hide the button; failures are silent (host behaves like 2.3.9).
 *
 * Does not change player hooks, seek/PDT math, adapters, or host media
 * logic. Multi-view: pops the tile whose panel button was clicked.
 */
    const OMT_PIP_TINY_W = 420;
    const OMT_PIP_TINY_H = 280;

    let omtPipState = null;

    function omtPopoutSupported() {
        try {
            return !!(window.documentPictureInPicture &&
                typeof documentPictureInPicture.requestWindow === 'function');
        } catch (_) {
            return false;
        }
    }

    function omtPopoutSiteId() {
        try {
            if (typeof site !== 'undefined' && site && site.id) return String(site.id);
        } catch (_) {}
        try {
            if (omtRoot) {
                if (omtRoot.classList.contains('omt-local')) return 'local';
                if (omtRoot.classList.contains('omt-examino')) return 'examino';
                if (omtRoot.classList.contains('omt-xeatre')) return 'xeatre';
                if (omtRoot.classList.contains('omt-inplayip')) return 'inplayip';
            }
        } catch (_) {}
        return '';
    }

    /**
     * Prefer reparenting the real <video> when safe (local / InPlay).
     * Examino / Xeatre host players often break if the element leaves their
     * tree — try captureStream first there, fall back to move.
     */
    function omtPopoutPreferMove() {
        const id = omtPopoutSiteId();
        return id === 'local' || id === 'inplayip' || id === '';
    }

    function omtPopoutShowButtons() {
        const ok = omtPopoutSupported();
        const show = (btn) => {
            if (!btn) return;
            btn.hidden = !ok;
            btn.style.display = ok ? '' : 'none';
        };
        try { show(typeof q === 'function' ? q('omt-popout-btn') : null); } catch (_) {}
        try {
            document.querySelectorAll('.omt-tile-popout, [id$="omt-popout-btn"]').forEach(show);
        } catch (_) {}
    }

    function omtPopoutPipCss() {
        return [
            ':root{color-scheme:dark;}',
            'html,body{margin:0;height:100%;background:#0b1218;font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden;}',
            '.omt-pip-root{position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:#0b1218;}',
            '.omt-pip-stage{position:relative;flex:1;min-height:0;background:#000;}',
            '.omt-pip-stage video{width:100%;height:100%;object-fit:contain;background:#000;display:block;}',
            '.omt-pip-timer-host{position:absolute;top:10px;left:10px;z-index:5;pointer-events:auto;}',
            /* Timer chip — mirror OMT content.css (PiP has no page stylesheet). */
            '.omt-pip-timer-host .omt-match-timer-wrap,.omt-pip-timer-host [id$="match-timer-wrap"]{',
            'position:static!important;display:block!important;transform:none!important;top:auto!important;left:auto!important;}',
            '.omt-pip-timer-host .omt-match-timer,.omt-pip-timer-host [id$="match-timer"]{',
            'display:block!important;background:rgba(0,0,0,0.72);color:#fff;font:700 22px/1.1 "Segoe UI",system-ui,sans-serif;',
            'font-variant-numeric:tabular-nums;padding:6px 10px;border-radius:8px;letter-spacing:0.04em;}',
            '.omt-pip-panel{flex:0 0 auto;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px;',
            'padding:8px 10px;background:rgba(18,22,28,0.96);border-top:1px solid rgba(255,255,255,0.12);}',
            '.omt-pip-panel button{appearance:none;-webkit-appearance:none;border:none;background:transparent;color:#e8e8e8;',
            'font:700 11px/1.2 "Segoe UI",system-ui,sans-serif;padding:6px 8px;border-radius:4px;cursor:pointer;}',
            '.omt-pip-panel button:hover{background:rgba(255,255,255,0.1);}',
            '.omt-pip-panel .omt-pip-play{color:#F5831F;min-width:40px;font-size:14px;}',
            '.omt-pip-panel .omt-pip-speed{border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:4px 6px;color:#ddd;background:rgba(0,0,0,0.35);}',
            '.omt-pip-panel .omt-pip-live{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;',
            'border:1px solid rgba(224,32,27,0.7);background:rgba(224,32,27,0.18);color:#fff;font-weight:700;}',
            '.omt-pip-panel .omt-pip-live .dot{width:6px;height:6px;border-radius:50%;background:#e0201b;}',
            '.omt-pip-panel .omt-pip-return{border:1px solid rgba(245,131,31,0.55)!important;background:rgba(245,131,31,0.15)!important;',
            'color:#F5831F!important;font-weight:700;margin-left:4px;}',
            '.omt-pip-root.omt-pip-tiny .omt-pip-panel{display:none;}',
            '.omt-pip-root.omt-pip-tiny.omt-pip-hover .omt-pip-panel{display:flex;}',
            '.omt-pip-hint{display:none;position:absolute;left:50%;bottom:10px;transform:translateX(-50%);',
            'font:600 10px/1.2 "Segoe UI",system-ui,sans-serif;color:rgba(255,255,255,0.65);',
            'background:rgba(0,0,0,0.55);padding:3px 8px;border-radius:4px;pointer-events:none;z-index:4;}',
            '.omt-pip-root.omt-pip-tiny:not(.omt-pip-hover) .omt-pip-hint{display:block;}'
        ].join('');
    }

    function omtPopoutBuildPanel(doc) {
        const panel = doc.createElement('div');
        panel.className = 'omt-pip-panel';
        panel.innerHTML =
            '<button type="button" class="omt-pip-skip" data-skip="-120" title="−2 min">« 2m</button>' +
            '<button type="button" class="omt-pip-skip" data-skip="-10" title="−10 s">« 10s</button>' +
            '<button type="button" class="omt-pip-play" title="Play / Pause">⏸</button>' +
            '<button type="button" class="omt-pip-skip" data-skip="10" title="+10 s">10s »</button>' +
            '<button type="button" class="omt-pip-skip" data-skip="120" title="+2 min">2m »</button>' +
            '<select class="omt-pip-speed" title="Speed">' +
            '<option value="0.25">0.25x</option><option value="0.5">0.50x</option>' +
            '<option value="0.75">0.75x</option><option value="1" selected>1.00x</option>' +
            '<option value="1.25">1.25x</option><option value="1.5">1.50x</option>' +
            '<option value="2">2.00x</option></select>' +
            '<button type="button" class="omt-pip-live" title="Go to live"><span class="dot"></span>LIVE</button>' +
            '<button type="button" class="omt-pip-return" title="Return to tab">↩ Return to tab</button>';
        return panel;
    }

    function omtPopoutWithTargetVideo(videoEl, fn) {
        if (!videoEl || typeof fn !== 'function') return;
        if (typeof omtInplayMvWithVideo === 'function' &&
            videoEl !== vid &&
            typeof inplayMvTiles !== 'undefined' &&
            inplayMvTiles && inplayMvTiles.has && inplayMvTiles.has(videoEl)) {
            return omtInplayMvWithVideo(videoEl, fn);
        }
        const prev = vid;
        try {
            vid = videoEl;
            return fn();
        } finally {
            vid = prev;
        }
    }

    function omtPopoutSyncPlayIcon(panel, videoEl) {
        if (!panel || !videoEl) return;
        const playBtn = panel.querySelector('.omt-pip-play');
        if (!playBtn) return;
        const on = !videoEl.paused && !videoEl.ended;
        playBtn.textContent = on ? '⏸' : '▶';
    }

    function omtPopoutWirePanel(panel, videoEl) {
        if (!panel || !videoEl) return;
        const run = (fn) => omtPopoutWithTargetVideo(videoEl, fn);
        panel.querySelectorAll('.omt-pip-skip').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const sec = parseFloat(btn.getAttribute('data-skip'));
                if (!isFinite(sec)) return;
                run(() => {
                    if (typeof saltarVideo === 'function') saltarVideo(sec);
                    else if (videoEl && isFinite(videoEl.currentTime)) {
                        videoEl.currentTime = Math.max(0, (videoEl.currentTime || 0) + sec);
                    }
                });
            });
        });
        const playBtn = panel.querySelector('.omt-pip-play');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                run(() => {
                    if (typeof togglePlay === 'function') togglePlay();
                    else if (videoEl.paused) videoEl.play().catch(() => {});
                    else videoEl.pause();
                });
                omtPopoutSyncPlayIcon(panel, videoEl);
            });
        }
        const speed = panel.querySelector('.omt-pip-speed');
        if (speed) {
            try {
                const r = videoEl.playbackRate || 1;
                const opts = Array.from(speed.options).map((o) => parseFloat(o.value));
                let best = opts[0];
                let bestD = Infinity;
                opts.forEach((v) => {
                    const d = Math.abs(v - r);
                    if (d < bestD) { bestD = d; best = v; }
                });
                speed.value = String(best);
            } catch (_) {}
            speed.addEventListener('change', () => {
                const v = parseFloat(speed.value);
                run(() => {
                    if (typeof applyPlaybackSpeed === 'function') applyPlaybackSpeed(v);
                    else videoEl.playbackRate = v;
                });
            });
        }
        const live = panel.querySelector('.omt-pip-live');
        if (live) {
            const isLocal = omtPopoutSiteId() === 'local';
            if (isLocal) live.style.display = 'none';
            live.addEventListener('click', (e) => {
                e.preventDefault();
                run(() => {
                    if (typeof irParaLive === 'function') irParaLive();
                });
            });
        }
        const ret = panel.querySelector('.omt-pip-return');
        if (ret) {
            ret.addEventListener('click', (e) => {
                e.preventDefault();
                omtPopoutClose();
            });
        }
        const onPlayState = () => omtPopoutSyncPlayIcon(panel, videoEl);
        videoEl.addEventListener('play', onPlayState);
        videoEl.addEventListener('pause', onPlayState);
        omtPopoutSyncPlayIcon(panel, videoEl);
        if (omtPipState) omtPipState._playStateHandler = onPlayState;
    }

    function omtPopoutMakePlaceholder(host, onReturn) {
        const el = document.createElement('div');
        el.className = 'omt-pip-page-placeholder';
        el.innerHTML =
            '<div class="omt-pip-page-placeholder-inner">' +
            '<div class="omt-pip-page-placeholder-icon" aria-hidden="true"></div>' +
            '<div class="omt-pip-page-placeholder-title">Playing in pop-out window</div>' +
            '<div class="omt-pip-page-placeholder-copy">Video and match timer are in the always-on-top pop-out.</div>' +
            '<button type="button" class="omt-pip-page-return">Return to this tab</button>' +
            '</div>';
        const btn = el.querySelector('.omt-pip-page-return');
        if (btn) btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof onReturn === 'function') onReturn();
        });
        if (host) {
            try {
                const cs = getComputedStyle(host);
                if (cs.position === 'static') host.style.position = 'relative';
            } catch (_) {}
            host.appendChild(el);
        }
        return el;
    }

    function omtPopoutUpdateTiny(root, win) {
        if (!root || !win) return;
        const w = win.innerWidth || 0;
        const h = win.innerHeight || 0;
        const tiny = w > 0 && h > 0 && (w < OMT_PIP_TINY_W || h < OMT_PIP_TINY_H);
        root.classList.toggle('omt-pip-tiny', tiny);
    }

    async function omtPopoutTryMove(videoEl, stage) {
        if (!videoEl || !stage || !videoEl.parentNode) return false;
        try {
            const parent = videoEl.parentNode;
            const next = videoEl.nextSibling;
            stage.appendChild(videoEl);
            return { parent, next };
        } catch (_) {
            return false;
        }
    }

    async function omtPopoutTryStream(videoEl, stage, doc) {
        if (!videoEl || !stage || typeof videoEl.captureStream !== 'function') return false;
        try {
            const stream = videoEl.captureStream();
            if (!stream || !stream.getVideoTracks || !stream.getVideoTracks().length) return false;
            const clone = doc.createElement('video');
            clone.playsInline = true;
            clone.autoplay = true;
            clone.muted = false;
            clone.srcObject = stream;
            clone.style.width = '100%';
            clone.style.height = '100%';
            stage.appendChild(clone);
            try { await clone.play(); } catch (_) {}
            // Keep page video playing for audio+timeline; mute page video to avoid double audio.
            const wasMuted = !!videoEl.muted;
            videoEl.muted = true;
            return { stream, clone, wasMuted };
        } catch (_) {
            return false;
        }
    }

    function omtPopoutResolveVideo(fromBtn) {
        try {
            if (fromBtn && fromBtn.closest) {
                const tile = fromBtn.closest('[data-omt-tile-root]');
                if (tile) {
                    const shell = tile.parentElement;
                    const v = shell && shell.querySelector && shell.querySelector('video');
                    if (v) return { video: v, tileRoot: tile };
                }
            }
        } catch (_) {}
        return { video: (typeof vid !== 'undefined' ? vid : null), tileRoot: null };
    }

    function omtPopoutResolveTimer(tileRoot) {
        try {
            if (tileRoot) {
                const tw = tileRoot.querySelector('.omt-match-timer-wrap, [id$="match-timer-wrap"]');
                if (tw) return tw;
            }
        } catch (_) {}
        try {
            if (typeof q === 'function') {
                const tw = q('match-timer-wrap');
                if (tw) return tw;
            }
        } catch (_) {}
        return document.getElementById('match-timer-wrap');
    }

    async function omtPopoutOpen(fromBtn) {
        if (!omtPopoutSupported()) return;
        if (omtPipState && omtPipState.win) {
            omtPopoutClose();
            return;
        }
        const resolved = omtPopoutResolveVideo(fromBtn);
        const videoEl = resolved.video;
        if (!videoEl || !videoEl.isConnected) return;

        let pipWin = null;
        try {
            pipWin = await documentPictureInPicture.requestWindow({
                width: 640,
                height: 400,
                disallowReturnToOpener: false
            });
        } catch (_) {
            return;
        }
        if (!pipWin || !pipWin.document) return;

        const doc = pipWin.document;
        try {
            const style = doc.createElement('style');
            style.textContent = omtPopoutPipCss();
            doc.head.appendChild(style);
        } catch (_) {}

        const root = doc.createElement('div');
        root.className = 'omt-pip-root';
        const stage = doc.createElement('div');
        stage.className = 'omt-pip-stage';
        const timerHost = doc.createElement('div');
        timerHost.className = 'omt-pip-timer-host';
        const hint = doc.createElement('div');
        hint.className = 'omt-pip-hint';
        hint.textContent = 'Hover for controls';
        const panel = omtPopoutBuildPanel(doc);
        stage.appendChild(timerHost);
        stage.appendChild(hint);
        root.appendChild(stage);
        root.appendChild(panel);
        doc.body.appendChild(root);

        const state = {
            win: pipWin,
            video: videoEl,
            mode: null,
            parent: null,
            nextSibling: null,
            stream: null,
            streamClone: null,
            wasMuted: null,
            timerWrap: null,
            timerParent: null,
            timerNext: null,
            placeholder: null,
            placeholderHost: null,
            panel,
            root,
            tileRoot: resolved.tileRoot,
            _playStateHandler: null
        };
        omtPipState = state;

        // Page placeholder early (even if video attach is flaky) — Return always works.
        const hostForPlaceholder =
            videoEl.parentElement ||
            (resolved.tileRoot && resolved.tileRoot.parentElement) ||
            (omtRoot && omtRoot.parentElement) ||
            null;
        state.placeholderHost = hostForPlaceholder;
        state.placeholder = omtPopoutMakePlaceholder(hostForPlaceholder, () => omtPopoutClose());

        // Video: host-aware order (move vs captureStream), with fallbacks.
        let attached = false;
        const tryMove = async () => {
            const moveInfo = await omtPopoutTryMove(videoEl, stage);
            if (!moveInfo) return false;
            state.mode = 'move';
            state.parent = moveInfo.parent;
            state.nextSibling = moveInfo.next;
            return true;
        };
        const tryStream = async () => {
            const streamInfo = await omtPopoutTryStream(videoEl, stage, doc);
            if (!streamInfo) return false;
            state.mode = 'stream';
            state.stream = streamInfo.stream;
            state.streamClone = streamInfo.clone;
            state.wasMuted = streamInfo.wasMuted;
            return true;
        };
        if (omtPopoutPreferMove()) {
            attached = await tryMove();
            if (!attached) attached = await tryStream();
        } else {
            attached = await tryStream();
            if (!attached) attached = await tryMove();
        }
        if (!attached) {
            const note = doc.createElement('div');
            note.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
                'color:#9aa3ad;font:600 13px/1.4 Segoe UI,system-ui,sans-serif;padding:16px;text-align:center;';
            note.textContent = 'Pop-out opened. Video could not be moved into this window on this host — use Return to tab.';
            stage.appendChild(note);
            state.mode = 'empty';
        }

        // Match timer chip into PiP only when already visible / active
        // (keeps existing paint path; avoids empty chip when no kickoff).
        const timerWrap = omtPopoutResolveTimer(resolved.tileRoot);
        let timerActive = false;
        try {
            if (resolved.tileRoot) timerActive = resolved.tileRoot.classList.contains('omt-timer-on');
            else if (omtRoot) timerActive = omtRoot.classList.contains('omt-timer-on');
        } catch (_) {}
        if (timerWrap && timerWrap.parentNode && timerActive) {
            state.timerWrap = timerWrap;
            state.timerParent = timerWrap.parentNode;
            state.timerNext = timerWrap.nextSibling;
            try { timerHost.appendChild(timerWrap); } catch (_) {}
        }

        omtPopoutWirePanel(panel, videoEl);
        omtPopoutUpdateTiny(root, pipWin);

        const onResize = () => omtPopoutUpdateTiny(root, pipWin);
        try { pipWin.addEventListener('resize', onResize); } catch (_) {}
        state._onResize = onResize;

        root.addEventListener('mouseenter', () => root.classList.add('omt-pip-hover'));
        root.addEventListener('mouseleave', () => root.classList.remove('omt-pip-hover'));

        const onPageHide = () => { omtPopoutClose({ fromPip: true }); };
        try { pipWin.addEventListener('pagehide', onPageHide); } catch (_) {}
        state._onPageHide = onPageHide;

        try {
            if (omtRoot) omtRoot.classList.add('omt-pip-active');
            if (resolved.tileRoot) resolved.tileRoot.classList.add('omt-pip-active');
        } catch (_) {}
    }

    function omtPopoutClose(opts) {
        const state = omtPipState;
        if (!state) return;
        omtPipState = null;
        const fromPip = !!(opts && opts.fromPip);

        try {
            if (state.video && state._playStateHandler) {
                state.video.removeEventListener('play', state._playStateHandler);
                state.video.removeEventListener('pause', state._playStateHandler);
            }
        } catch (_) {}

        // Restore timer
        try {
            if (state.timerWrap && state.timerParent) {
                if (state.timerNext && state.timerNext.parentNode === state.timerParent) {
                    state.timerParent.insertBefore(state.timerWrap, state.timerNext);
                } else {
                    state.timerParent.appendChild(state.timerWrap);
                }
            }
        } catch (_) {}

        // Restore video
        try {
            if (state.mode === 'move' && state.video && state.parent) {
                if (state.nextSibling && state.nextSibling.parentNode === state.parent) {
                    state.parent.insertBefore(state.video, state.nextSibling);
                } else {
                    state.parent.appendChild(state.video);
                }
            } else if (state.mode === 'stream') {
                if (state.streamClone) {
                    try { state.streamClone.pause(); } catch (_) {}
                    try { state.streamClone.srcObject = null; } catch (_) {}
                    try {
                        if (state.streamClone.parentNode) state.streamClone.parentNode.removeChild(state.streamClone);
                    } catch (_) {}
                }
                if (state.stream) {
                    try {
                        state.stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
                    } catch (_) {}
                }
                if (state.video && state.wasMuted != null) {
                    try { state.video.muted = !!state.wasMuted; } catch (_) {}
                }
            }
        } catch (_) {}

        try {
            if (state.placeholder && state.placeholder.parentNode) {
                state.placeholder.parentNode.removeChild(state.placeholder);
            }
        } catch (_) {}

        try {
            if (omtRoot) omtRoot.classList.remove('omt-pip-active');
            if (state.tileRoot) state.tileRoot.classList.remove('omt-pip-active');
        } catch (_) {}

        if (!fromPip && state.win) {
            try { state.win.close(); } catch (_) {}
        }
    }

    function omtPopoutWirePrimary() {
        omtPopoutShowButtons();
        const btn = typeof q === 'function' ? q('omt-popout-btn') : null;
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            omtPopoutOpen(btn);
        });
    }

    function omtPopoutWireTileButton(btn, videoEl) {
        if (!btn) return;
        omtPopoutShowButtons();
        if (!omtPopoutSupported()) return;
        btn.hidden = false;
        btn.style.display = '';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            omtPopoutOpen(btn);
        });
    }

    try {
        window.__omtPopoutSupported = omtPopoutSupported;
        window.__omtPopoutClose = () => omtPopoutClose();
    } catch (_) {}
