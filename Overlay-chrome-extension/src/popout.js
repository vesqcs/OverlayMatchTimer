/* Document Picture-in-Picture pop-out (v2.4.2) — additive only.
 *
 * Full-bleed video + OMT match timer + hover-only chrome that reuses the
 * real main-overlay timeline (neutral scrub, period ticks, hover tip) and
 * a small transport row matching the panel (2m / 10s / frame / play / …).
 * No Return button — Chrome's PiP title bar is enough.
 *
 * Unsupported → hide button; failures silent. Does not change player hooks,
 * seek/PDT math, adapters, or host media logic.
 */
    /** Below this width, hover chrome shows timeline only (no transport row). */
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

    /** Copy opener stylesheets into the PiP document so OMT timeline CSS applies. */
    function omtPopoutCopyStyles(pipDoc) {
        if (!pipDoc || !pipDoc.head) return;
        try {
            Array.from(document.styleSheets || []).forEach((sheet) => {
                try {
                    if (sheet.href) {
                        const link = pipDoc.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = sheet.href;
                        pipDoc.head.appendChild(link);
                        return;
                    }
                    const rules = sheet.cssRules || sheet.rules;
                    if (!rules) return;
                    const style = pipDoc.createElement('style');
                    style.textContent = Array.from(rules).map((r) => r.cssText).join('\n');
                    pipDoc.head.appendChild(style);
                } catch (_) {
                    /* cross-origin sheet — ignore */
                }
            });
        } catch (_) {}
        Array.from(document.querySelectorAll('style')).forEach((el) => {
            try {
                const style = pipDoc.createElement('style');
                style.textContent = el.textContent || '';
                pipDoc.head.appendChild(style);
            } catch (_) {}
        });
    }

    function omtPopoutPipShellCss() {
        return [
            'html,body{margin:0;height:100%;background:#0a0a0a;overflow:hidden;color:#f1f1f1;',
            'font-family:var(--omt-font,"Segoe UI",system-ui,sans-serif);}',
            ':root{--omt-pip-scale:1;--omt-scrub:#b0b0b0;--omt-orange:#F5831F;--omt-text:#e8e8e8;}',
            '.omt-pip-root{position:relative;width:100%;height:100%;background:#0a0a0a;',
            'background-image:radial-gradient(ellipse at 50% 18%,rgba(245,131,31,0.08),transparent 55%);}',
            '.omt-pip-stage{position:absolute;inset:0;background:#000;}',
            '.omt-pip-stage>video{position:absolute;inset:0;width:100%;height:100%;',
            'object-fit:contain;background:#000;display:block;cursor:pointer;}',
            '.omt-pip-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
            'color:#9aa3ad;font:600 13px/1.4 sans-serif;padding:16px;text-align:center;pointer-events:none;}',
            '.omt-pip-timer-host{position:absolute;top:max(8px,1.4%);left:max(8px,1.4%);z-index:6;',
            'pointer-events:auto;transform-origin:top left;transform:scale(var(--omt-pip-scale));}',
            '.omt-pip-timer-host .omt-match-timer-wrap,.omt-pip-timer-host [id$="match-timer-wrap"]{',
            'position:static!important;display:block!important;transform:none!important;top:auto!important;left:auto!important;}',
            '.omt-pip-timer-host .omt-match-timer,.omt-pip-timer-host [id$="match-timer"]{',
            'display:block!important;background:rgba(0,0,0,0.72);color:#fff;',
            'font:700 clamp(14px,calc(11px + 1.6vw),26px)/1.1 var(--omt-font,"Segoe UI",system-ui,sans-serif);',
            'font-variant-numeric:tabular-nums;padding:6px 10px;border-radius:8px;letter-spacing:0.04em;',
            'border:1px solid rgba(245,131,31,0.22);}',
            /* Overlay chrome — never reflows video */
            '.omt-pip-chrome{position:absolute;left:0;right:0;bottom:0;z-index:7;pointer-events:none;',
            'opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;',
            'padding:32px 10px 8px;box-sizing:border-box;',
            'background:linear-gradient(to top,rgba(0,0,0,0.72) 0%,rgba(0,0,0,0.28) 55%,rgba(0,0,0,0) 100%);',
            'display:flex;flex-direction:column;gap:6px;align-items:stretch;}',
            '.omt-pip-root.omt-pip-chrome-on .omt-pip-chrome{opacity:1;transform:none;pointer-events:auto;}',
            /* Real timeline bar sits here — strip its page positioning / chrome row */
            '.omt-pip-chrome .omt-timeline-bar,.omt-pip-chrome #omt-timeline-bar{',
            'position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;',
            'inset:auto!important;width:100%!important;padding:0!important;margin:0!important;',
            'background:transparent!important;pointer-events:auto!important;z-index:1!important;}',
            '.omt-pip-chrome .omt-timeline-chrome-row{display:none!important;}',
            '.omt-pip-chrome .omt-timeline-track{pointer-events:auto!important;}',
            '.omt-pip-chrome .omt-timeline-hover-tip{position:fixed!important;}',
            /* Small transport row — same icons/style as panel, compact */
            '.omt-pip-transport.omt-transport-seg{',
            'width:100%;max-width:100%;min-height:0;border-radius:6px;pointer-events:auto;}',
            '.omt-pip-transport .ctrl-btn{',
            'min-height:32px;padding:6px 4px;gap:3px;font-size:11px;}',
            '.omt-pip-transport .ctrl-btn .omt-btn-label{font-size:10px;}',
            '.omt-pip-transport .ctrl-btn .omt-icon{width:14px;height:14px;}',
            '.omt-pip-transport .ctrl-btn.btn-play{min-width:40px;padding:6px 8px;}',
            '.omt-pip-transport .ctrl-btn.btn-play .omt-icon{width:16px;height:16px;}',
            '.omt-pip-root.omt-pip-narrow .omt-pip-transport{display:none!important;}'
        ].join('');
    }

    function omtPopoutBuildTransport(doc) {
        const row = doc.createElement('div');
        row.className = 'omt-transport-seg omt-pip-transport';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', 'Playback transport');
        const ic = (name, size) => (typeof omtIcon === 'function' ? omtIcon(name, size) : '');
        /* Same order as panel minus 2s skips and speed; no omt-tip tooltips. */
        row.innerHTML =
            '<button class="ctrl-btn" data-omt-pip-act="skip" data-skip-dir="back" data-skip-slot="2" type="button">' +
            ic('rewind', 14) + '<span class="omt-btn-label">2m</span></button>' +
            '<button class="ctrl-btn" data-omt-pip-act="skip" data-skip-dir="back" data-skip-slot="1" type="button">' +
            ic('skip-back', 14) + '<span class="omt-btn-label">10s</span></button>' +
            '<span class="omt-seg-divider" aria-hidden="true"></span>' +
            '<button class="ctrl-btn btn-frame" data-omt-pip-act="frame" data-frame="-1" type="button">' +
            ic('step-back', 14) + '</button>' +
            '<button class="ctrl-btn btn-play" data-omt-pip-act="play" type="button" aria-label="Play">' +
            ic('play', 16) + '</button>' +
            '<button class="ctrl-btn btn-frame" data-omt-pip-act="frame" data-frame="1" type="button">' +
            ic('step-forward', 14) + '</button>' +
            '<span class="omt-seg-divider" aria-hidden="true"></span>' +
            '<button class="ctrl-btn" data-omt-pip-act="skip" data-skip-dir="fwd" data-skip-slot="1" type="button">' +
            '<span class="omt-btn-label">10s</span>' + ic('skip-forward', 14) + '</button>' +
            '<button class="ctrl-btn" data-omt-pip-act="skip" data-skip-dir="fwd" data-skip-slot="2" type="button">' +
            '<span class="omt-btn-label">2m</span>' + ic('fast-forward', 14) + '</button>';
        return row;
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

    function omtPopoutSyncPlayIcon(transport, videoEl) {
        if (!transport || !videoEl) return;
        const playBtn = transport.querySelector('[data-omt-pip-act="play"]');
        if (!playBtn) return;
        const on = !videoEl.paused && !videoEl.ended;
        if (typeof omtIcon === 'function') {
            playBtn.innerHTML = omtIcon(on ? 'pause' : 'play', 16);
        }
        playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
        playBtn.classList.toggle('playing', on);
    }

    function omtPopoutWireTransport(transport, videoEl) {
        if (!transport || !videoEl) return;
        const run = (fn) => omtPopoutWithTargetVideo(videoEl, fn);
        transport.querySelectorAll('[data-omt-pip-act="skip"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dir = btn.getAttribute('data-skip-dir');
                const slot = parseInt(btn.getAttribute('data-skip-slot'), 10);
                let sec = (dir === 'back') ? -10 : 10;
                if (typeof omtPanelSkipSeconds === 'function' && isFinite(slot)) {
                    sec = omtPanelSkipSeconds(dir === 'back' ? 'back' : 'fwd', slot);
                    if (dir === 'back') sec = -Math.abs(sec);
                    else sec = Math.abs(sec);
                } else if (slot === 2) {
                    sec = dir === 'back' ? -120 : 120;
                }
                run(() => {
                    if (typeof saltarVideo === 'function') saltarVideo(sec);
                    else if (isFinite(videoEl.currentTime)) {
                        videoEl.currentTime = Math.max(0, (videoEl.currentTime || 0) + sec);
                    }
                });
            });
        });
        transport.querySelectorAll('[data-omt-pip-act="frame"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const d = parseInt(btn.getAttribute('data-frame'), 10);
                run(() => {
                    if (d < 0 && typeof retrocederFrame === 'function') retrocederFrame();
                    else if (d > 0 && typeof avancarFrame === 'function') avancarFrame();
                });
            });
        });
        const playBtn = transport.querySelector('[data-omt-pip-act="play"]');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                run(() => {
                    if (typeof togglePlay === 'function') togglePlay();
                    else if (videoEl.paused) videoEl.play().catch(() => {});
                    else videoEl.pause();
                });
                omtPopoutSyncPlayIcon(transport, videoEl);
            });
        }
        transport.addEventListener('click', (e) => e.stopPropagation());
        const onPlayState = () => omtPopoutSyncPlayIcon(transport, videoEl);
        videoEl.addEventListener('play', onPlayState);
        videoEl.addEventListener('pause', onPlayState);
        omtPopoutSyncPlayIcon(transport, videoEl);
        if (omtPipState) omtPipState._playStateHandler = onPlayState;
    }

    /** Period ticks into the moved timeline (q() cannot see PiP document). */
    function omtPopoutRefreshPeriodTicks(bar) {
        if (!bar || typeof collectPeriodAnchors !== 'function') return;
        const tickContainer = bar.querySelector('.omt-timeline-period-ticks, #omt-timeline-period-ticks');
        if (!tickContainer) return;
        tickContainer.innerHTML = '';
        const slider = bar.querySelector('.timeline-slider, #omt-timeline-slider');
        if (!slider || !vid) return;
        const minVal = parseFloat(slider.min) || 0;
        const maxVal = parseFloat(slider.max) || 0;
        const range = maxVal - minVal;
        if (range <= 0) return;
        const anchors = collectPeriodAnchors().filter((a) => a.val >= minVal && a.val <= maxVal);
        anchors.forEach((a) => {
            const pct = ((a.val - minVal) / range) * 100;
            const short = (typeof periodShortLabelForKey === 'function') ? periodShortLabelForKey(a.key) : a.key;
            const full = (typeof periodLabelForKey === 'function') ? periodLabelForKey(a.key) : a.key;
            const el = bar.ownerDocument.createElement('div');
            el.className = 'omt-period-tick';
            el.style.left = pct + '%';
            el.setAttribute('data-half', a.key);
            el.setAttribute('data-period', full);
            el.setAttribute('data-t', String(a.val));
            el.innerHTML =
                '<span class="omt-period-tick-mark" aria-hidden="true"></span>' +
                '<span class="omt-period-tick-label">' + short + '</span>';
            tickContainer.appendChild(el);
        });
        tickContainer.setAttribute('aria-hidden', anchors.length ? 'false' : 'true');
    }

    /** Hover tip for the moved timeline (same content as main overlay tip). */
    function omtPopoutWireTimelineTips(bar) {
        if (!bar) return;
        const track = bar.querySelector('.omt-timeline-track');
        const tip = bar.querySelector('.omt-timeline-hover-tip, #omt-timeline-hover-tip');
        const slider = bar.querySelector('.timeline-slider, #omt-timeline-slider');
        if (!track || !tip || !slider) return;

        let snapAnchor = null;
        const clearSnap = () => {
            bar.querySelectorAll('.omt-period-tick.is-snap').forEach((el) => el.classList.remove('is-snap'));
            snapAnchor = null;
        };
        const hide = () => {
            tip.hidden = true;
            tip.style.opacity = '';
            tip.style.left = '';
            tip.style.top = '';
            bar.classList.remove('is-timeline-hover');
            clearSnap();
        };
        const update = (clientX) => {
            const trackRect = track.getBoundingClientRect();
            const barRect = bar.getBoundingClientRect();
            if (trackRect.width <= 0) return;
            const min = parseFloat(slider.min) || 0;
            const max = parseFloat(slider.max) || 0;
            const range = max - min;
            if (range <= 0) return;
            const px = clientX - trackRect.left;
            clearSnap();
            let tipT;
            let leftPx;
            const anchors = (typeof collectPeriodAnchors === 'function')
                ? collectPeriodAnchors().filter((a) => a.val >= min && a.val <= max)
                : [];
            let nearest = null;
            let nearestDist = Infinity;
            let nearestPct = 0;
            anchors.forEach((a) => {
                const ax = ((a.val - min) / range) * trackRect.width;
                const d = Math.abs(px - ax);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearest = a;
                    nearestPct = ax;
                }
            });
            if (nearest && nearestDist <= 8) {
                snapAnchor = nearest;
                tipT = nearest.val;
                leftPx = (trackRect.left - barRect.left) + nearestPct;
                const tickEl = bar.querySelector('.omt-period-tick[data-half="' + nearest.key + '"]');
                if (tickEl) tickEl.classList.add('is-snap');
            } else {
                const ratio = Math.max(0, Math.min(1, px / trackRect.width));
                tipT = min + ratio * range;
                leftPx = (trackRect.left - barRect.left) + ratio * trackRect.width;
            }
            let text = '';
            if (typeof matchClockAtVideoTime === 'function') {
                const info = matchClockAtVideoTime(tipT);
                if (info.period && info.clock) text = info.period + ' · ' + info.clock;
                else if (info.clock) text = info.clock;
            }
            if (!text && typeof formatarTempoVideo === 'function') text = formatarTempoVideo(tipT);
            tip.textContent = text;
            tip.hidden = false;
            tip.style.opacity = '1';
            bar.classList.add('is-timeline-hover');
            const tipW = Math.max(48, tip.offsetWidth || 80);
            const tipH = Math.max(22, tip.offsetHeight || 22);
            let left = barRect.left + leftPx - tipW / 2;
            const pad = 6;
            const vw = bar.ownerDocument.defaultView;
            const maxR = (vw && vw.innerWidth) ? vw.innerWidth - pad : barRect.right;
            if (left < pad) left = pad;
            if (left + tipW > maxR) left = maxR - tipW;
            tip.style.position = 'fixed';
            tip.style.left = Math.round(left) + 'px';
            tip.style.top = Math.round(trackRect.top - tipH - 8) + 'px';
            tip.style.bottom = 'auto';
            tip.style.transform = 'none';
            tip.style.zIndex = '2147483645';
        };

        const onMove = (e) => update(e.clientX);
        const onLeave = () => hide();
        const onDown = (e) => {
            update(e.clientX);
            if (!snapAnchor || typeof jumpToKickoff !== 'function') return;
            e.preventDefault();
            e.stopPropagation();
            omtPopoutWithTargetVideo(omtPipState && omtPipState.video, () => jumpToKickoff(snapAnchor.key));
        };
        track.addEventListener('pointermove', onMove);
        track.addEventListener('pointerleave', onLeave);
        track.addEventListener('pointerdown', onDown, true);
        if (omtPipState) {
            omtPipState._tipHide = hide;
            omtPipState._tipHandlers = { track, onMove, onLeave, onDown };
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
        const scale = w <= 0 ? 1 : Math.max(0.85, Math.min(1.15, w / 640));
        try { root.style.setProperty('--omt-pip-scale', String(scale)); } catch (_) {}
    }

    function omtPopoutArmChromeReveal(root, state) {
        if (!root || !state) return;
        const show = () => {
            root.classList.add('omt-pip-chrome-on');
            if (state.timelineBar) omtPopoutRefreshPeriodTicks(state.timelineBar);
            if (state._idleTimer) {
                try { clearTimeout(state._idleTimer); } catch (_) {}
            }
            state._idleTimer = setTimeout(() => {
                root.classList.remove('omt-pip-chrome-on');
                if (state._tipHide) state._tipHide();
            }, OMT_PIP_IDLE_MS);
        };
        const hide = () => {
            if (state._idleTimer) {
                try { clearTimeout(state._idleTimer); } catch (_) {}
                state._idleTimer = null;
            }
            root.classList.remove('omt-pip-chrome-on');
            if (state._tipHide) state._tipHide();
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

    function omtPopoutResolveTimelineBar(tileRoot) {
        try {
            if (tileRoot) {
                const b = tileRoot.querySelector('.omt-timeline-bar, [id$="omt-timeline-bar"]');
                if (b) return b;
            }
        } catch (_) {}
        try {
            if (typeof q === 'function') {
                const b = q('omt-timeline-bar');
                if (b) return b;
            }
        } catch (_) {}
        return document.getElementById('omt-timeline-bar');
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
        omtPopoutCopyStyles(doc);
        try {
            const style = doc.createElement('style');
            style.textContent = omtPopoutPipShellCss();
            doc.head.appendChild(style);
        } catch (_) {}

        const root = doc.createElement('div');
        root.className = 'omt-pip-root';
        const stage = doc.createElement('div');
        stage.className = 'omt-pip-stage';
        const timerHost = doc.createElement('div');
        timerHost.className = 'omt-pip-timer-host';
        const chrome = doc.createElement('div');
        chrome.className = 'omt-pip-chrome';
        const transport = omtPopoutBuildTransport(doc);
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
            timelineBar: null,
            timelineParent: null,
            timelineNext: null,
            placeholder: null,
            placeholderHost: null,
            chrome,
            transport,
            root,
            tileRoot: resolved.tileRoot,
            _playStateHandler: null,
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

        /* Move the real main timeline into PiP chrome (same component). */
        const timelineBar = omtPopoutResolveTimelineBar(resolved.tileRoot);
        if (timelineBar && timelineBar.parentNode) {
            state.timelineBar = timelineBar;
            state.timelineParent = timelineBar.parentNode;
            state.timelineNext = timelineBar.nextSibling;
            try {
                chrome.appendChild(timelineBar);
                chrome.appendChild(transport);
                omtPopoutRefreshPeriodTicks(timelineBar);
                omtPopoutWireTimelineTips(timelineBar);
                if (typeof paintTimelineScrubberProgress === 'function') {
                    try { paintTimelineScrubberProgress(true); } catch (_) {}
                }
            } catch (_) {
                try { chrome.appendChild(transport); } catch (_2) {}
            }
        } else {
            chrome.appendChild(transport);
        }

        stage.addEventListener('click', (e) => {
            if (e.target && e.target.closest &&
                e.target.closest('.omt-pip-chrome, .omt-pip-timer-host')) return;
            if (!(e.target === stage || (e.target && e.target.tagName === 'VIDEO'))) return;
            omtPopoutWithTargetVideo(videoEl, () => {
                if (typeof togglePlay === 'function') togglePlay();
                else if (videoEl.paused) videoEl.play().catch(() => {});
                else videoEl.pause();
            });
            omtPopoutSyncPlayIcon(transport, videoEl);
            if (state._chromeShow) state._chromeShow();
        });

        omtPopoutWireTransport(transport, videoEl);
        omtPopoutUpdateLayout(root, pipWin);
        omtPopoutArmChromeReveal(root, state);

        const onResize = () => {
            omtPopoutUpdateLayout(root, pipWin);
            if (state.timelineBar) omtPopoutRefreshPeriodTicks(state.timelineBar);
        };
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

    function omtPopoutRestoreNode(node, parent, next) {
        if (!node || !parent) return;
        try {
            if (next && next.parentNode === parent) parent.insertBefore(node, next);
            else parent.appendChild(node);
        } catch (_) {}
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
            if (state._tipHandlers) {
                const { track, onMove, onLeave, onDown } = state._tipHandlers;
                if (track) {
                    track.removeEventListener('pointermove', onMove);
                    track.removeEventListener('pointerleave', onLeave);
                    track.removeEventListener('pointerdown', onDown, true);
                }
            }
            if (state._tipHide) state._tipHide();
        } catch (_) {}

        try {
            if (state.video && state._playStateHandler) {
                state.video.removeEventListener('play', state._playStateHandler);
                state.video.removeEventListener('pause', state._playStateHandler);
            }
        } catch (_) {}

        try {
            if (state.win && state._keyHandler) {
                state.win.document.removeEventListener('keydown', state._keyHandler, true);
                state.win.removeEventListener('keydown', state._keyHandler, true);
            }
        } catch (_) {}

        omtPopoutRestoreNode(state.timelineBar, state.timelineParent, state.timelineNext);
        omtPopoutRestoreNode(state.timerWrap, state.timerParent, state.timerNext);

        try {
            if (state.mode === 'move' && state.video && state.parent) {
                omtPopoutRestoreNode(state.video, state.parent, state.nextSibling);
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
            if (typeof atualizarMarcadores === 'function') atualizarMarcadores();
            if (typeof paintTimelineScrubberProgress === 'function') paintTimelineScrubberProgress(true);
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
