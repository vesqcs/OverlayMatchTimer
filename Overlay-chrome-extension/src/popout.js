/* Document Picture-in-Picture pop-out (v2.4.1) — additive only.
 *
 * Always-on-top Chromium Document PiP with full-bleed video, OMT match
 * timer, and a hover-only thin timeline bar. No Return button or header
 * chrome of ours — Chrome's PiP title bar is enough.
 *
 * Unsupported browsers hide the button; failures are silent (2.3.9 behaviour).
 * Does not change player hooks, seek/PDT math, adapters, or host media logic.
 * Multi-view: pops the tile whose panel button was clicked.
 */
    /** Below this width, hover bar shows timeline only (no side buttons). */
    const OMT_PIP_CONTROLS_MIN_W = 480;
    const OMT_PIP_IDLE_MS = 1600;

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
     * Examino / Xeatre often break if the element leaves their tree —
     * try captureStream first there, fall back to move.
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
        /* Match local player page: #0a0a0a / #000 + Stats Perform orange #F5831F. */
        return [
            ':root{color-scheme:dark;--omt-orange:#F5831F;--omt-orange-dim:rgba(245,131,31,0.18);',
            '--omt-font:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;',
            '--omt-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
            '--omt-scrub:#F5831F;--omt-progress:0%;--omt-pip-scale:1;}',
            'html,body{margin:0;height:100%;background:#0a0a0a;font-family:var(--omt-font);overflow:hidden;color:#f1f1f1;}',
            /* Full-bleed stage — video NEVER shrinks when chrome appears. */
            '.omt-pip-root{position:relative;width:100%;height:100%;background:#0a0a0a;',
            'background-image:radial-gradient(ellipse at 50% 18%,rgba(245,131,31,0.08),transparent 55%);} ',
            '.omt-pip-stage{position:absolute;inset:0;background:#000;}',
            '.omt-pip-stage>video{position:absolute;inset:0;width:100%;height:100%;',
            'object-fit:contain;background:#000;display:block;cursor:pointer;}',
            '.omt-pip-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
            'color:#9aa3ad;font:600 13px/1.4 var(--omt-font);padding:16px;text-align:center;pointer-events:none;}',
            /* Timer scales with window; min stays readable. */
            '.omt-pip-timer-host{position:absolute;top:max(8px,1.4%);left:max(8px,1.4%);z-index:6;',
            'pointer-events:auto;transform-origin:top left;transform:scale(var(--omt-pip-scale));}',
            '.omt-pip-timer-host .omt-match-timer-wrap,.omt-pip-timer-host [id$="match-timer-wrap"]{',
            'position:static!important;display:block!important;transform:none!important;top:auto!important;left:auto!important;}',
            '.omt-pip-timer-host .omt-match-timer,.omt-pip-timer-host [id$="match-timer"]{',
            'display:block!important;background:rgba(0,0,0,0.72);color:#fff;',
            'font:700 clamp(14px,calc(11px + 1.6vw),26px)/1.1 var(--omt-font);',
            'font-variant-numeric:tabular-nums;padding:6px 10px;border-radius:8px;letter-spacing:0.04em;',
            'border:1px solid rgba(245,131,31,0.22);}',
            /* Hover chrome: overlay only — does not reflow video. */
            '.omt-pip-chrome{position:absolute;left:0;right:0;bottom:0;z-index:7;pointer-events:none;',
            'opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;',
            'padding:28px 10px 8px;box-sizing:border-box;',
            'background:linear-gradient(to top,rgba(0,0,0,0.72) 0%,rgba(0,0,0,0.28) 55%,rgba(0,0,0,0) 100%);',
            'display:flex;flex-direction:column;gap:4px;align-items:stretch;}',
            '.omt-pip-root.omt-pip-chrome-on .omt-pip-chrome{opacity:1;transform:none;pointer-events:auto;}',
            '.omt-pip-track{position:relative;width:100%;height:14px;display:flex;align-items:center;pointer-events:auto;}',
            '.omt-pip-slider{-webkit-appearance:none;appearance:none;width:100%;height:4px;margin:0;padding:0;',
            'border:none;border-radius:2px;outline:none;cursor:pointer;background:transparent;',
            'background-image:linear-gradient(to right,var(--omt-scrub) var(--omt-progress),rgba(255,255,255,0.22) var(--omt-progress));}',
            '.omt-pip-slider::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:transparent;}',
            '.omt-pip-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;',
            'border-radius:50%;background:#fff;border:none;margin-top:-4px;box-shadow:0 0 0 1px rgba(0,0,0,0.35);}',
            '.omt-pip-slider::-moz-range-track{height:4px;border-radius:2px;background:rgba(255,255,255,0.22);}',
            '.omt-pip-slider::-moz-range-progress{height:4px;border-radius:2px;background:var(--omt-scrub);}',
            '.omt-pip-slider::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;border:none;}',
            '.omt-pip-row{display:flex;align-items:center;gap:4px;min-height:28px;pointer-events:auto;}',
            '.omt-pip-row .omt-pip-time{font:600 11px/1 var(--omt-mono);font-variant-numeric:tabular-nums;',
            'color:#c8c8c8;margin-left:auto;white-space:nowrap;}',
            '.omt-pip-btns{display:inline-flex;align-items:center;gap:2px;}',
            '.omt-pip-root.omt-pip-narrow .omt-pip-btns{display:none!important;}',
            '.omt-pip-btns button,.omt-pip-btns select{appearance:none;-webkit-appearance:none;border:none;',
            'background:transparent;color:#f1f1f1;font:700 11px/1 var(--omt-font);',
            'padding:4px 6px;border-radius:4px;cursor:pointer;min-width:28px;min-height:28px;}',
            '.omt-pip-btns button:hover{background:rgba(255,255,255,0.12);}',
            '.omt-pip-btns .omt-pip-play{color:var(--omt-orange);}',
            '.omt-pip-btns .omt-pip-play .omt-icon{width:16px;height:16px;display:block;}',
            '.omt-pip-btns select{border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.35);',
            'color:#ddd;padding:4px 5px;min-width:0;}'
        ].join('');
    }

    function omtPopoutBuildChrome(doc) {
        const chrome = doc.createElement('div');
        chrome.className = 'omt-pip-chrome';
        chrome.innerHTML =
            '<div class="omt-pip-track">' +
            '<input type="range" class="omt-pip-slider" min="0" max="100" value="0" step="0.01" aria-label="Timeline">' +
            '</div>' +
            '<div class="omt-pip-row">' +
            '<div class="omt-pip-btns">' +
            '<button type="button" class="omt-pip-skip" data-skip="-10" title="−10 s" aria-label="Back 10 seconds">' +
            (typeof omtIcon === 'function' ? omtIcon('skip-back', 14) : '«') + '</button>' +
            '<button type="button" class="omt-pip-play" title="Play / Pause" aria-label="Play">' +
            (typeof omtIcon === 'function' ? omtIcon('play', 16) : '▶') + '</button>' +
            '<button type="button" class="omt-pip-skip" data-skip="10" title="+10 s" aria-label="Forward 10 seconds">' +
            (typeof omtIcon === 'function' ? omtIcon('skip-forward', 14) : '»') + '</button>' +
            '<select class="omt-pip-speed" title="Speed" aria-label="Speed">' +
            '<option value="0.25">0.25x</option><option value="0.5">0.50x</option>' +
            '<option value="0.75">0.75x</option><option value="1" selected>1.00x</option>' +
            '<option value="1.25">1.25x</option><option value="1.5">1.50x</option>' +
            '<option value="2">2.00x</option></select>' +
            '</div>' +
            '<span class="omt-pip-time">0:00 / 0:00</span>' +
            '</div>';
        return chrome;
    }

    function omtPopoutFmtTime(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        const s = Math.floor(sec % 60);
        const m = Math.floor(sec / 60) % 60;
        const h = Math.floor(sec / 3600);
        const pad = (n) => (n < 10 ? '0' + n : String(n));
        if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
        return m + ':' + pad(s);
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

    function omtPopoutSyncPlayIcon(chrome, videoEl) {
        if (!chrome || !videoEl) return;
        const playBtn = chrome.querySelector('.omt-pip-play');
        if (!playBtn) return;
        const on = !videoEl.paused && !videoEl.ended;
        if (typeof omtIcon === 'function') {
            playBtn.innerHTML = omtIcon(on ? 'pause' : 'play', 16);
        } else {
            playBtn.textContent = on ? '⏸' : '▶';
        }
        playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
        playBtn.classList.toggle('playing', on);
    }

    function omtPopoutPaintTimeline(chrome, videoEl) {
        if (!chrome || !videoEl) return;
        const slider = chrome.querySelector('.omt-pip-slider');
        const timeEl = chrome.querySelector('.omt-pip-time');
        let dur = 0;
        try {
            if (videoEl.seekable && videoEl.seekable.length > 0) {
                dur = videoEl.seekable.end(videoEl.seekable.length - 1);
            } else if (isFinite(videoEl.duration) && videoEl.duration > 0) {
                dur = videoEl.duration;
            }
        } catch (_) {}
        const cur = videoEl.currentTime || 0;
        if (slider && !slider._omtDragging) {
            slider.max = String(dur > 0 ? dur : 100);
            slider.value = String(Math.max(0, Math.min(dur > 0 ? dur : 100, cur)));
            const pct = dur > 0 ? (cur / dur) * 100 : 0;
            slider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, pct)) + '%');
        }
        if (timeEl) timeEl.textContent = omtPopoutFmtTime(cur) + ' / ' + omtPopoutFmtTime(dur);
    }

    function omtPopoutWireChrome(chrome, videoEl, root) {
        if (!chrome || !videoEl) return;
        const run = (fn) => omtPopoutWithTargetVideo(videoEl, fn);
        const slider = chrome.querySelector('.omt-pip-slider');
        if (slider) {
            const seekFromSlider = () => {
                const t = parseFloat(slider.value);
                if (!isFinite(t)) return;
                run(() => {
                    try { videoEl.currentTime = Math.max(0, t); } catch (_) {}
                });
                const max = parseFloat(slider.max) || 0;
                const pct = max > 0 ? (t / max) * 100 : 0;
                slider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, pct)) + '%');
            };
            slider.addEventListener('pointerdown', () => { slider._omtDragging = true; });
            slider.addEventListener('pointerup', () => { slider._omtDragging = false; seekFromSlider(); });
            slider.addEventListener('change', seekFromSlider);
            slider.addEventListener('input', () => {
                const t = parseFloat(slider.value);
                const max = parseFloat(slider.max) || 0;
                const pct = max > 0 ? (t / max) * 100 : 0;
                slider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, pct)) + '%');
            });
            slider.addEventListener('click', (e) => e.stopPropagation());
        }
        chrome.querySelectorAll('.omt-pip-skip').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const sec = parseFloat(btn.getAttribute('data-skip'));
                if (!isFinite(sec)) return;
                run(() => {
                    if (typeof saltarVideo === 'function') saltarVideo(sec);
                    else if (isFinite(videoEl.currentTime)) {
                        videoEl.currentTime = Math.max(0, (videoEl.currentTime || 0) + sec);
                    }
                });
                omtPopoutPaintTimeline(chrome, videoEl);
            });
        });
        const playBtn = chrome.querySelector('.omt-pip-play');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                run(() => {
                    if (typeof togglePlay === 'function') togglePlay();
                    else if (videoEl.paused) videoEl.play().catch(() => {});
                    else videoEl.pause();
                });
                omtPopoutSyncPlayIcon(chrome, videoEl);
            });
        }
        const speed = chrome.querySelector('.omt-pip-speed');
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
            speed.addEventListener('change', (e) => {
                e.stopPropagation();
                const v = parseFloat(speed.value);
                run(() => {
                    if (typeof applyPlaybackSpeed === 'function') applyPlaybackSpeed(v);
                    else videoEl.playbackRate = v;
                });
            });
            speed.addEventListener('click', (e) => e.stopPropagation());
        }
        chrome.addEventListener('click', (e) => e.stopPropagation());

        const onPlayState = () => omtPopoutSyncPlayIcon(chrome, videoEl);
        const onTime = () => omtPopoutPaintTimeline(chrome, videoEl);
        videoEl.addEventListener('play', onPlayState);
        videoEl.addEventListener('pause', onPlayState);
        videoEl.addEventListener('timeupdate', onTime);
        videoEl.addEventListener('seeked', onTime);
        videoEl.addEventListener('durationchange', onTime);
        omtPopoutSyncPlayIcon(chrome, videoEl);
        omtPopoutPaintTimeline(chrome, videoEl);
        if (omtPipState) {
            omtPipState._playStateHandler = onPlayState;
            omtPipState._timeHandler = onTime;
        }
    }

    function omtPopoutMakePlaceholder(host, onReturn) {
        const el = document.createElement('div');
        el.className = 'omt-pip-page-placeholder';
        el.innerHTML =
            '<div class="omt-pip-page-placeholder-inner">' +
            '<div class="omt-pip-page-placeholder-icon" aria-hidden="true"></div>' +
            '<div class="omt-pip-page-placeholder-title">Playing in pop-out window</div>' +
            '<div class="omt-pip-page-placeholder-copy">Use Chrome’s back-to-tab control on the pop-out, or return here.</div>' +
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

    function omtPopoutUpdateLayout(root, win) {
        if (!root || !win) return;
        const w = win.innerWidth || 0;
        root.classList.toggle('omt-pip-narrow', w > 0 && w < OMT_PIP_CONTROLS_MIN_W);
        /* Extra scale for very small windows so the chip stays readable. */
        const scale = w <= 0 ? 1 : Math.max(0.85, Math.min(1.15, w / 640));
        try { root.style.setProperty('--omt-pip-scale', String(scale)); } catch (_) {}
    }

    function omtPopoutArmChromeReveal(root, state) {
        if (!root || !state) return;
        const show = () => {
            root.classList.add('omt-pip-chrome-on');
            if (state._idleTimer) {
                try { clearTimeout(state._idleTimer); } catch (_) {}
            }
            state._idleTimer = setTimeout(() => {
                root.classList.remove('omt-pip-chrome-on');
            }, OMT_PIP_IDLE_MS);
        };
        const hide = () => {
            if (state._idleTimer) {
                try { clearTimeout(state._idleTimer); } catch (_) {}
                state._idleTimer = null;
            }
            root.classList.remove('omt-pip-chrome-on');
        };
        root.addEventListener('mousemove', show);
        root.addEventListener('mouseenter', show);
        root.addEventListener('mouseleave', hide);
        state._chromeShow = show;
        state._chromeHide = hide;
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
            stage.appendChild(clone);
            try { await clone.play(); } catch (_) {}
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

    function omtPopoutInstallFocusInput(pipWin, videoEl, tileRoot) {
        if (!pipWin || !pipWin.document) return null;
        const onKey = (e) => {
            try {
                if (tileRoot && typeof omtInplayMvSetHotkeyTarget === 'function') {
                    omtInplayMvSetHotkeyTarget(videoEl);
                }
            } catch (_) {}
            if (typeof handleKeydown === 'function') {
                try { handleKeydown(e); } catch (_) {}
            }
        };
        try {
            pipWin.document.addEventListener('keydown', onKey, true);
            pipWin.addEventListener('keydown', onKey, true);
        } catch (_) {}
        return onKey;
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
                width: 800,
                height: 450,
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
        const chrome = omtPopoutBuildChrome(doc);
        stage.appendChild(timerHost);
        root.appendChild(stage);
        root.appendChild(chrome);
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
            chrome,
            root,
            tileRoot: resolved.tileRoot,
            _playStateHandler: null,
            _timeHandler: null,
            _keyHandler: null,
            _idleTimer: null
        };
        omtPipState = state;

        const hostForPlaceholder =
            videoEl.parentElement ||
            (resolved.tileRoot && resolved.tileRoot.parentElement) ||
            (omtRoot && omtRoot.parentElement) ||
            null;
        state.placeholderHost = hostForPlaceholder;
        state.placeholder = omtPopoutMakePlaceholder(hostForPlaceholder, () => omtPopoutClose());

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
            note.className = 'omt-pip-empty';
            note.textContent = 'Pop-out opened. Video could not be shown in this window on this host — use Chrome’s back-to-tab control.';
            stage.appendChild(note);
            state.mode = 'empty';
        }

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

        /* Click video (not chrome) toggles play/pause. */
        stage.addEventListener('click', (e) => {
            if (e.target && e.target.closest && e.target.closest('.omt-pip-chrome, .omt-pip-timer-host')) return;
            if (e.target !== stage && e.target !== videoEl &&
                !(state.streamClone && e.target === state.streamClone)) {
                /* Still allow clicks on empty stage / video. */
                if (!(e.target && e.target.tagName === 'VIDEO')) return;
            }
            omtPopoutWithTargetVideo(videoEl, () => {
                if (typeof togglePlay === 'function') togglePlay();
                else if (videoEl.paused) videoEl.play().catch(() => {});
                else videoEl.pause();
            });
            omtPopoutSyncPlayIcon(chrome, videoEl);
            if (state._chromeShow) state._chromeShow();
        });

        omtPopoutWireChrome(chrome, videoEl, root);
        omtPopoutUpdateLayout(root, pipWin);
        omtPopoutArmChromeReveal(root, state);

        const onResize = () => omtPopoutUpdateLayout(root, pipWin);
        try { pipWin.addEventListener('resize', onResize); } catch (_) {}
        state._onResize = onResize;

        state._keyHandler = omtPopoutInstallFocusInput(pipWin, videoEl, resolved.tileRoot);

        const onPageHide = () => { omtPopoutClose({ fromPip: true }); };
        try { pipWin.addEventListener('pagehide', onPageHide); } catch (_) {}
        state._onPageHide = onPageHide;

        try {
            if (omtRoot) omtRoot.classList.add('omt-pip-active');
            if (resolved.tileRoot) resolved.tileRoot.classList.add('omt-pip-active');
        } catch (_) {}

        try { pipWin.focus(); } catch (_) {}
    }

    function omtPopoutClose(opts) {
        const state = omtPipState;
        if (!state) return;
        omtPipState = null;
        const fromPip = !!(opts && opts.fromPip);

        try {
            if (state._idleTimer) clearTimeout(state._idleTimer);
        } catch (_) {}

        try {
            if (state.video && state._playStateHandler) {
                state.video.removeEventListener('play', state._playStateHandler);
                state.video.removeEventListener('pause', state._playStateHandler);
            }
            if (state.video && state._timeHandler) {
                state.video.removeEventListener('timeupdate', state._timeHandler);
                state.video.removeEventListener('seeked', state._timeHandler);
                state.video.removeEventListener('durationchange', state._timeHandler);
            }
        } catch (_) {}

        try {
            if (state.win && state._keyHandler) {
                state.win.document.removeEventListener('keydown', state._keyHandler, true);
                state.win.removeEventListener('keydown', state._keyHandler, true);
            }
        } catch (_) {}

        try {
            if (state.timerWrap && state.timerParent) {
                if (state.timerNext && state.timerNext.parentNode === state.timerParent) {
                    state.timerParent.insertBefore(state.timerWrap, state.timerNext);
                } else {
                    state.timerParent.appendChild(state.timerWrap);
                }
            }
        } catch (_) {}

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
        window.__omtPipControlsMinW = OMT_PIP_CONTROLS_MIN_W;
    } catch (_) {}
