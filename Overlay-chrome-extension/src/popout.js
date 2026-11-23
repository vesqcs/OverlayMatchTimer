/* Document Picture-in-Picture pop-out (v2.4.4) — additive only.
 *
 * Full-bleed video + OMT match timer (full MM:SS, never abbreviated) +
 * hover-only chrome:
 *   - narrow (< OMT_PIP_CONTROLS_MIN_W, or short height): real timeline +
 *     slim icon-only transport + video time readout + hover tooltips
 *   - wide: real timeline at bottom + COMPACT small OMT control panel
 *     (no speed row, no transform scale — hits stay accurate)
 *
 * Field fixes vs 2.4.3: raise large-mode threshold, compact panel, hide LIVE
 * on local, timeline under panel, scrubber progress, panel buttons, PiP-local
 * drag, PiP keydown focus, icon-row tips, black/orange placeholder, hide
 * pop-out button inside the PiP panel.
 *
 * No Return button — Chrome's PiP title bar is enough.
 * Unsupported → hide button; failures silent. Does not change player hooks,
 * seek/PDT math, adapters, or host media logic.
 */
    /**
     * Below this width → icon row. Tuned so a medium window (~640×400) stays
     * on the icon row; large mode only when the PiP is genuinely big.
     */
    const OMT_PIP_CONTROLS_MIN_W = 720;
    /**
     * Soft height floor: only force icon-row when the window is both short AND
     * not wide. Default 800×450 still opens large; ~640×400 stays icon-row via width.
     */
    const OMT_PIP_CONTROLS_MIN_H = 300;
    const OMT_PIP_IDLE_MS = 1600;
    /** Match-timer font floor so MM:SS stays readable when the window shrinks. */
    const OMT_PIP_TIMER_MIN_PX = 16;

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

    function omtPopoutIsLocal() {
        return omtPopoutSiteId() === 'local';
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
                } catch (_) {}
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
            ':root{--omt-pip-timer-size:26px;',
            '--omt-scrub:#b0b0b0;--omt-orange:#F5831F;--omt-text:#e8e8e8;',
            '--omt-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
            '--omt-font:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;}',
            '.omt-pip-root{position:relative;width:100%;height:100%;background:#0a0a0a;',
            'background-image:radial-gradient(ellipse at 50% 18%,rgba(245,131,31,0.08),transparent 55%);',
            'outline:none;}',
            '.omt-pip-stage{position:absolute;inset:0;background:#000;}',
            '.omt-pip-stage>video{position:absolute;inset:0;width:100%;height:100%;',
            'object-fit:contain;background:#000;display:block;cursor:pointer;}',
            '.omt-pip-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
            'color:#9aa3ad;font:600 13px/1.4 var(--omt-font);padding:16px;text-align:center;pointer-events:none;}',
            /* Timer: full MM:SS always; scale font only — never clip/abbreviate. */
            '.omt-pip-timer-host{position:absolute;top:max(8px,1.4%);left:max(8px,1.4%);z-index:6;',
            'pointer-events:auto;overflow:visible;}',
            '.omt-pip-timer-host #match-timer-wrap,.omt-pip-timer-host .omt-match-timer-wrap,',
            '.omt-pip-timer-host [id$="match-timer-wrap"]{',
            'position:static!important;display:block!important;visibility:visible!important;',
            'transform:none!important;top:auto!important;left:auto!important;right:auto!important;bottom:auto!important;',
            'overflow:visible!important;max-width:none!important;opacity:1!important;}',
            '.omt-pip-timer-host #match-timer,.omt-pip-timer-host .omt-match-timer,',
            '.omt-pip-timer-host [id$="match-timer"]{',
            'display:inline-block!important;visibility:visible!important;opacity:1!important;',
            'background:rgba(0,0,0,0.62)!important;color:#f3f3f3!important;',
            'font-family:var(--omt-mono)!important;font-weight:650!important;',
            'font-size:var(--omt-pip-timer-size)!important;line-height:1.15!important;',
            'font-variant-numeric:tabular-nums!important;letter-spacing:0.03em!important;',
            'padding:7px 12px!important;border-radius:3px!important;',
            'border:1px solid rgba(255,255,255,0.12)!important;',
            'white-space:nowrap!important;overflow:visible!important;max-width:none!important;',
            'text-overflow:clip!important;box-sizing:border-box!important;}',
            /* Hover chrome — overlay only. Column: controls then timeline at bottom. */
            '.omt-pip-chrome{position:absolute;left:0;right:0;bottom:0;z-index:7;pointer-events:none;',
            'opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;',
            'padding:36px 10px 10px;box-sizing:border-box;',
            'background:linear-gradient(to top,rgba(0,0,0,0.78) 0%,rgba(0,0,0,0.32) 55%,rgba(0,0,0,0) 100%);',
            'display:flex;flex-direction:column;gap:8px;align-items:stretch;}',
            '.omt-pip-root.omt-pip-chrome-on .omt-pip-chrome{opacity:1;transform:none;pointer-events:auto;}',
            /* Real timeline — last in flex = anchored under the control panel. */
            '.omt-pip-chrome .omt-timeline-bar,.omt-pip-chrome #omt-timeline-bar{',
            'position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;',
            'inset:auto!important;width:100%!important;padding:0!important;margin:0!important;',
            'background:transparent!important;pointer-events:auto!important;z-index:1!important;',
            'order:3;}',
            '.omt-pip-chrome .omt-timeline-chrome-row{display:none!important;}',
            '.omt-pip-chrome .omt-timeline-track{pointer-events:auto!important;}',
            '.omt-pip-chrome .omt-timeline-hover-tip{position:fixed!important;}',
            /* Scrubber: light fill = played up to playhead; dark ahead; thumb at playhead. */
            '.omt-pip-chrome .timeline-slider,.omt-pip-chrome #omt-timeline-slider{',
            'background:linear-gradient(to right,var(--omt-scrub) 0%,var(--omt-scrub) var(--omt-progress,0%),',
            'rgba(255,255,255,0.2) var(--omt-progress,0%))!important;}',
            '.omt-pip-root.omt-pip-chrome-on .omt-pip-chrome .timeline-slider::-webkit-slider-thumb,',
            '.omt-pip-chrome .omt-timeline-bar:hover .timeline-slider::-webkit-slider-thumb,',
            '.omt-pip-chrome .timeline-slider:active::-webkit-slider-thumb{opacity:1!important;}',
            '.omt-pip-root.omt-pip-chrome-on .omt-pip-chrome .timeline-slider::-moz-range-thumb,',
            '.omt-pip-chrome .omt-timeline-bar:hover .timeline-slider::-moz-range-thumb{opacity:1!important;}',
            /* Narrow: icon-only slim row + time on the right */
            '.omt-pip-icon-row{display:none;align-items:center;gap:8px;width:100%;pointer-events:auto;',
            'min-height:28px;box-sizing:border-box;order:2;}',
            '.omt-pip-root.omt-pip-narrow .omt-pip-icon-row{display:flex;}',
            '.omt-pip-root:not(.omt-pip-narrow) .omt-pip-icon-row{display:none!important;}',
            '.omt-pip-icons{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto;}',
            '.omt-pip-icons button{appearance:none;-webkit-appearance:none;border:none;background:transparent;',
            'color:#e8e8e8;width:28px;height:28px;padding:0;margin:0;border-radius:4px;cursor:pointer;',
            'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;}',
            '.omt-pip-icons button:hover{background:rgba(255,255,255,0.12);color:#fff;}',
            '.omt-pip-icons button.omt-pip-play{color:var(--omt-orange);width:32px;}',
            '.omt-pip-icons button.omt-pip-play.playing{color:var(--omt-orange);}',
            '.omt-pip-icons button .omt-icon{width:16px;height:16px;display:block;}',
            '.omt-pip-icons button.omt-pip-skip-long .omt-icon{width:17px;height:17px;}',
            '.omt-pip-videotime{margin-left:auto;font:600 11px/1 var(--omt-mono);',
            'font-variant-numeric:tabular-nums;color:#c8c8c8;white-space:nowrap;flex-shrink:0;}',
            /* Wide: compact small control panel — NO transform scale (breaks hit-testing). */
            '.omt-pip-panel-slot{display:none;width:100%;justify-content:center;pointer-events:auto;',
            'order:1;position:relative;min-height:0;}',
            '.omt-pip-root:not(.omt-pip-narrow) .omt-pip-panel-slot{display:flex;}',
            '.omt-pip-root.omt-pip-narrow .omt-pip-panel-slot{display:none!important;}',
            '.omt-pip-panel-slot .omt-controls-panel,.omt-pip-panel-slot #omt-controls-panel,',
            '.omt-pip-root > .omt-controls-panel.omt-pip-panel-floating{',
            'position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;',
            'transform:none!important;margin:0 auto!important;pointer-events:auto!important;max-width:100%;',
            'opacity:1!important;visibility:visible!important;z-index:8;}',
            '.omt-pip-root > .omt-controls-panel.omt-pip-panel-floating{',
            'position:fixed!important;margin:0!important;}',
            /* Local: hide LIVE (same as main local player). Always hide pop-out in PiP panel. */
            '.omt-pip-root.omt-pip-local #omt-live-btn,.omt-pip-root.omt-pip-local .omt-live-spacer,',
            '.omt-pip-root.omt-pip-local [id$="omt-live-btn"]{display:none!important;}',
            '.omt-pip-root #omt-popout-btn,.omt-pip-root [id$="omt-popout-btn"],',
            '.omt-pip-root .omt-tile-popout{display:none!important;}',
            /* Icon-row tooltips (OMT tip style). */
            '.omt-pip-icon-tip{position:fixed;z-index:2147483646;pointer-events:none;',
            'background:#141414;color:#f0f0f0;border:1px solid rgba(255,255,255,0.14);',
            'border-radius:4px;padding:4px 8px;font:500 11px/1.25 var(--omt-font);',
            'white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,0.55);}',
            '.omt-pip-icon-tip[hidden]{display:none!important;}'
        ].join('');
    }

    /**
     * Icon-only transport for analysts:
     * 2m = double-chevron (chevrons-*), 10s = skip (triangle+bar), frame = step (bar+triangle).
     * Tooltips override the old no-tooltip rule — icons have no text.
     */
    function omtPopoutBuildIconRow(doc) {
        const row = doc.createElement('div');
        row.className = 'omt-pip-icon-row';
        const ic = (name, size) => (typeof omtIcon === 'function' ? omtIcon(name, size) : '');
        row.innerHTML =
            '<div class="omt-pip-icons" role="group" aria-label="Playback transport">' +
            '<button type="button" class="omt-pip-skip-long omt-tip" data-omt-pip-act="skip" data-skip-dir="back" data-skip-slot="2" data-tip="2 min back" aria-label="2 min back">' +
            ic('chevrons-left', 17) + '</button>' +
            '<button type="button" class="omt-tip" data-omt-pip-act="skip" data-skip-dir="back" data-skip-slot="1" data-tip="10 s back" aria-label="10 s back">' +
            ic('skip-back', 16) + '</button>' +
            '<button type="button" class="omt-tip" data-omt-pip-act="frame" data-frame="-1" data-tip="Frame back" aria-label="Frame back">' +
            ic('step-back', 16) + '</button>' +
            '<button type="button" class="omt-pip-play omt-tip" data-omt-pip-act="play" data-tip="Play / Pause" aria-label="Play / Pause">' +
            ic('play', 16) + '</button>' +
            '<button type="button" class="omt-tip" data-omt-pip-act="frame" data-frame="1" data-tip="Frame forward" aria-label="Frame forward">' +
            ic('step-forward', 16) + '</button>' +
            '<button type="button" class="omt-tip" data-omt-pip-act="skip" data-skip-dir="fwd" data-skip-slot="1" data-tip="10 s forward" aria-label="10 s forward">' +
            ic('skip-forward', 16) + '</button>' +
            '<button type="button" class="omt-pip-skip-long omt-tip" data-omt-pip-act="skip" data-skip-dir="fwd" data-skip-slot="2" data-tip="2 min forward" aria-label="2 min forward">' +
            ic('chevrons-right', 17) + '</button>' +
            '</div>' +
            '<span class="omt-pip-videotime">0:00 / 0:00</span>';
        return row;
    }

    function omtPopoutFmtTime(sec) {
        if (typeof formatarTempoVideo === 'function') {
            try { return formatarTempoVideo(sec); } catch (_) {}
        }
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

    function omtPopoutSyncPlayIcon(rootEl, videoEl) {
        if (!rootEl || !videoEl) return;
        const playBtn = rootEl.querySelector('[data-omt-pip-act="play"]');
        if (!playBtn) return;
        const on = !videoEl.paused && !videoEl.ended;
        if (typeof omtIcon === 'function') {
            playBtn.innerHTML = omtIcon(on ? 'pause' : 'play', 16);
        }
        playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
        playBtn.classList.toggle('playing', on);
    }

    function omtPopoutPaintVideoTime(iconRow, videoEl) {
        if (!iconRow || !videoEl) return;
        const el = iconRow.querySelector('.omt-pip-videotime');
        if (!el) return;
        let dur = 0;
        try {
            if (videoEl.seekable && videoEl.seekable.length > 0) {
                dur = videoEl.seekable.end(videoEl.seekable.length - 1);
            } else if (isFinite(videoEl.duration) && videoEl.duration > 0) {
                dur = videoEl.duration;
            }
        } catch (_) {}
        const cur = videoEl.currentTime || 0;
        el.textContent = omtPopoutFmtTime(cur) + ' / ' + omtPopoutFmtTime(dur);
    }

    /** Keep scrubber value + --omt-progress in lockstep with the playhead. */
    function omtPopoutSyncTimelineProgress(state) {
        if (!state || !state.timelineBar || !state.video) return;
        const slider = state.timelineBar.querySelector('.timeline-slider, #omt-timeline-slider');
        if (!slider) return;
        try {
            const min = parseFloat(slider.min) || 0;
            const max = parseFloat(slider.max) || 0;
            const dragging = (typeof isDraggingTimeline !== 'undefined') && isDraggingTimeline;
            if (!dragging) {
                const t = state.video.currentTime || 0;
                if (max > min) {
                    slider.value = String(Math.max(min, Math.min(max, t)));
                }
            }
            const val = parseFloat(slider.value) || 0;
            const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
            const rounded = Math.round(pct * 10) / 10;
            slider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, rounded)) + '%');
            if (typeof paintTimelineScrubberProgress === 'function') {
                try { paintTimelineScrubberProgress(true); } catch (_) {}
            }
        } catch (_) {}
    }

    function omtPopoutWireIconRow(iconRow, videoEl) {
        if (!iconRow || !videoEl) return;
        const run = (fn) => omtPopoutWithTargetVideo(videoEl, fn);
        iconRow.querySelectorAll('[data-omt-pip-act="skip"]').forEach((btn) => {
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
                omtPopoutPaintVideoTime(iconRow, videoEl);
                if (omtPipState) omtPopoutSyncTimelineProgress(omtPipState);
            });
        });
        iconRow.querySelectorAll('[data-omt-pip-act="frame"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const d = parseInt(btn.getAttribute('data-frame'), 10);
                run(() => {
                    if (d < 0 && typeof retrocederFrame === 'function') retrocederFrame();
                    else if (d > 0 && typeof avancarFrame === 'function') avancarFrame();
                });
                omtPopoutPaintVideoTime(iconRow, videoEl);
                if (omtPipState) omtPopoutSyncTimelineProgress(omtPipState);
            });
        });
        const playBtn = iconRow.querySelector('[data-omt-pip-act="play"]');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                run(() => {
                    if (typeof togglePlay === 'function') togglePlay();
                    else if (videoEl.paused) videoEl.play().catch(() => {});
                    else videoEl.pause();
                });
                omtPopoutSyncPlayIcon(iconRow, videoEl);
            });
        }
        iconRow.addEventListener('click', (e) => e.stopPropagation());
        const onPlayState = () => omtPopoutSyncPlayIcon(iconRow, videoEl);
        const onTime = () => {
            omtPopoutPaintVideoTime(iconRow, videoEl);
            if (omtPipState) omtPopoutSyncTimelineProgress(omtPipState);
        };
        videoEl.addEventListener('play', onPlayState);
        videoEl.addEventListener('pause', onPlayState);
        videoEl.addEventListener('timeupdate', onTime);
        videoEl.addEventListener('seeked', onTime);
        videoEl.addEventListener('durationchange', onTime);
        omtPopoutSyncPlayIcon(iconRow, videoEl);
        omtPopoutPaintVideoTime(iconRow, videoEl);
        if (omtPipState) {
            omtPipState._playStateHandler = onPlayState;
            omtPipState._timeHandler = onTime;
        }
    }

    /** OMT-style hover tips for the icon-only row (icons have no labels). */
    function omtPopoutWireIconTips(iconRow, pipDoc, state) {
        if (!iconRow || !pipDoc) return;
        const tip = pipDoc.createElement('div');
        tip.className = 'omt-pip-icon-tip';
        tip.hidden = true;
        tip.setAttribute('role', 'tooltip');
        try { pipDoc.body.appendChild(tip); } catch (_) {}
        let activeBtn = null;
        const hide = () => {
            tip.hidden = true;
            tip.textContent = '';
            activeBtn = null;
        };
        const show = (btn) => {
            const text = btn && btn.getAttribute('data-tip');
            if (!text) { hide(); return; }
            activeBtn = btn;
            tip.textContent = text;
            tip.hidden = false;
            const br = btn.getBoundingClientRect();
            const tipW = Math.max(40, tip.offsetWidth || 80);
            const tipH = Math.max(18, tip.offsetHeight || 22);
            const vw = pipDoc.defaultView ? pipDoc.defaultView.innerWidth : 800;
            let left = br.left + (br.width / 2) - (tipW / 2);
            if (left < 6) left = 6;
            if (left + tipW > vw - 6) left = vw - 6 - tipW;
            let top = br.top - tipH - 8;
            if (top < 6) top = br.bottom + 8;
            tip.style.left = Math.round(left) + 'px';
            tip.style.top = Math.round(top) + 'px';
        };
        const onEnter = (e) => {
            const btn = e.target && e.target.closest && e.target.closest('button[data-tip]');
            if (btn) show(btn);
        };
        const onLeave = (e) => {
            const to = e.relatedTarget;
            if (activeBtn && to && activeBtn.contains(to)) return;
            if (to && to.closest && to.closest('button[data-tip]')) return;
            hide();
        };
        iconRow.addEventListener('mouseover', onEnter);
        iconRow.addEventListener('mouseout', onLeave);
        iconRow.addEventListener('focusin', onEnter);
        iconRow.addEventListener('focusout', onLeave);
        if (state) {
            state._iconTip = tip;
            state._iconTipHide = hide;
            state._tipHide = () => {
                hide();
                if (state._timelineTipHide) state._timelineTipHide();
            };
        }
    }

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

    /** Seek when the moved timeline slider is scrubbed inside PiP. */
    function omtPopoutWireTimelineSeek(bar, videoEl) {
        if (!bar || !videoEl) return null;
        const slider = bar.querySelector('.timeline-slider, #omt-timeline-slider');
        if (!slider) return null;
        const onScrub = () => {
            const t = parseFloat(slider.value);
            if (!isFinite(t)) return;
            omtPopoutWithTargetVideo(videoEl, () => {
                if (typeof seekTo === 'function') seekTo(t);
                else videoEl.currentTime = t;
            });
            if (omtPipState) omtPopoutSyncTimelineProgress(omtPipState);
        };
        slider.addEventListener('input', onScrub);
        slider.addEventListener('change', onScrub);
        return () => {
            try {
                slider.removeEventListener('input', onScrub);
                slider.removeEventListener('change', onScrub);
            } catch (_) {}
        };
    }

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
            omtPipState._timelineTipHide = hide;
            omtPipState._tipHandlers = { track, onMove, onLeave, onDown };
            const prev = omtPipState._tipHide;
            omtPipState._tipHide = () => {
                hide();
                if (typeof prev === 'function') prev();
                if (omtPipState && omtPipState._iconTipHide) omtPipState._iconTipHide();
            };
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

    function omtPopoutRestoreNode(node, parent, next) {
        if (!node || !parent) return;
        try {
            if (next && next.parentNode === parent) parent.insertBefore(node, next);
            else parent.appendChild(node);
        } catch (_) {}
    }

    /**
     * PiP-local drag: opener `fazerArrastavel` binds move/up on the opener
     * window, so pointer moves inside Document PiP never reach it. Capture
     * pointerdown and drive left/top with the PiP window's own listeners.
     */
    function omtPopoutInstallPipDrag(panel, pipWin, root) {
        if (!panel || !pipWin || !root) return null;
        const handle = panel.querySelector('.drag-handle, [data-omt-tile-handle], .drag-center-grip');
        let dragging = false;
        let grabOffsetX = 0;
        let grabOffsetY = 0;
        let activePointerId = null;

        const edgeHit = (e) => {
            if (typeof omtPanelEdgeGrabHit === 'function') {
                try { return omtPanelEdgeGrabHit(e, panel, 8); } catch (_) { return false; }
            }
            return false;
        };

        const stopDrag = () => {
            if (!dragging) return;
            dragging = false;
            activePointerId = null;
            try {
                pipWin.removeEventListener('pointermove', drag, true);
                pipWin.removeEventListener('mousemove', drag, true);
                pipWin.removeEventListener('pointerup', stopDrag, true);
                pipWin.removeEventListener('mouseup', stopDrag, true);
                pipWin.removeEventListener('pointercancel', stopDrag, true);
            } catch (_) {}
        };

        const drag = (e) => {
            if (!dragging) return;
            if (e.pointerId != null && activePointerId != null && e.pointerId !== activePointerId) return;
            try { e.preventDefault(); } catch (_) {}
            const panelW = panel.offsetWidth || 0;
            const panelH = panel.offsetHeight || 0;
            const maxLeft = Math.max(0, (pipWin.innerWidth || 0) - panelW);
            const maxTop = Math.max(0, (pipWin.innerHeight || 0) - panelH);
            let newLeft = e.clientX - grabOffsetX;
            let newTop = e.clientY - grabOffsetY;
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        };

        const startDrag = (e) => {
            if (e.target.closest && e.target.closest('button, select, input, textarea, a, label')) return;
            if (e.button != null && e.button !== 0) return;
            if (dragging) return;
            try { e.preventDefault(); } catch (_) {}
            try { e.stopPropagation(); } catch (_) {}
            try { e.stopImmediatePropagation(); } catch (_) {}

            try { panel.dataset.omtUserDragged = '1'; } catch (_) {}
            panel.classList.add('omt-pip-panel-floating');
            /* Reparent onto root so fixed positioning is free of the chrome flex. */
            try {
                if (panel.parentNode !== root) root.appendChild(panel);
            } catch (_) {}

            const rect = panel.getBoundingClientRect();
            panel.style.position = 'fixed';
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.transform = 'none';
            panel.style.margin = '0';
            panel.style.zIndex = '20';

            grabOffsetX = e.clientX - rect.left;
            grabOffsetY = e.clientY - rect.top;
            dragging = true;
            activePointerId = e.pointerId != null ? e.pointerId : null;

            try {
                pipWin.addEventListener('pointermove', drag, true);
                pipWin.addEventListener('mousemove', drag, true);
                pipWin.addEventListener('pointerup', stopDrag, true);
                pipWin.addEventListener('mouseup', stopDrag, true);
                pipWin.addEventListener('pointercancel', stopDrag, true);
            } catch (_) {}

            try {
                if (e.pointerId != null && handle && handle.setPointerCapture) {
                    handle.setPointerCapture(e.pointerId);
                } else if (e.pointerId != null && panel.setPointerCapture) {
                    panel.setPointerCapture(e.pointerId);
                }
            } catch (_) {}
        };

        const maybeStart = (e) => {
            if (e.target.closest && e.target.closest('button, select, input, textarea, a, label')) return;
            const onHandle = !!(handle && e.target.closest && (
                e.target === handle || handle.contains(e.target) ||
                e.target.closest('.drag-handle, .drag-center-grip, [data-omt-tile-handle]')
            ));
            if (!onHandle && !edgeHit(e)) return;
            startDrag(e);
        };

        /* Capture phase so opener fazerArrastavel (bubble) never starts with wrong rootRect. */
        if (handle) {
            handle.addEventListener('pointerdown', startDrag, true);
            handle.addEventListener('mousedown', function (e) {
                if (e.pointerType) return;
                startDrag(e);
            }, true);
        }
        panel.addEventListener('pointerdown', maybeStart, true);
        panel.addEventListener('mousedown', function (e) {
            if (e.pointerType) return;
            maybeStart(e);
        }, true);

        return () => {
            stopDrag();
            try {
                if (handle) {
                    handle.removeEventListener('pointerdown', startDrag, true);
                }
                panel.removeEventListener('pointerdown', maybeStart, true);
            } catch (_) {}
            try { panel.classList.remove('omt-pip-panel-floating'); } catch (_) {}
        };
    }

    /**
     * PiP-local control bridge. Moving the panel into another document can drop
     * opener-world listeners (iframe mocks) or leave clicks inert; capture-phase
     * handlers here drive the same transport functions with the PiP video.
     */
    function omtPopoutInstallPanelBridge(panel, videoEl) {
        if (!panel || !videoEl) return null;
        const run = (fn) => omtPopoutWithTargetVideo(videoEl, fn);
        const skipFromEl = (el) => {
            if (!el) return null;
            if (el.hasAttribute('data-skip')) {
                const n = parseFloat(el.getAttribute('data-skip'));
                return isFinite(n) ? n : null;
            }
            const id = el.id || '';
            const map = {
                'omt-m120': -120, 'omt-m10': -10, 'omt-m2': -2,
                'omt-p2': 2, 'omt-p10': 10, 'omt-p120': 120
            };
            if (Object.prototype.hasOwnProperty.call(map, id)) {
                const abs = Math.abs(map[id]);
                const dir = map[id] < 0 ? 'back' : 'fwd';
                const slot = abs >= 120 ? 2 : (abs >= 10 ? 1 : 0);
                if (typeof omtPanelSkipSeconds === 'function') {
                    const sec = omtPanelSkipSeconds(dir, slot);
                    return dir === 'back' ? -Math.abs(sec) : Math.abs(sec);
                }
                return map[id];
            }
            return null;
        };

        const onClick = (e) => {
            const t = e.target && e.target.closest && e.target.closest('button, select');
            if (!t || !panel.contains(t)) return;
            /* Never handle pop-out from inside PiP. */
            if (t.id === 'omt-popout-btn' || t.classList.contains('omt-popout-btn') ||
                t.classList.contains('omt-tile-popout')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
            if (t.id === 'omt-live-btn' || t.classList.contains('omt-tile-panel-live')) {
                if (omtPopoutIsLocal()) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    return;
                }
            }

            const id = t.id || '';
            let handled = false;

            if (id === 'omt-btn-play' || t.classList.contains('btn-play') || t.classList.contains('omt-tile-play')) {
                handled = true;
                run(() => {
                    if (typeof togglePlay === 'function') togglePlay();
                    else if (videoEl.paused) videoEl.play().catch(() => {});
                    else videoEl.pause();
                });
            } else if (id === 'omt-prev-frame' || (t.hasAttribute('data-frame') && t.getAttribute('data-frame') === '-1')) {
                handled = true;
                run(() => { if (typeof retrocederFrame === 'function') retrocederFrame(); });
            } else if (id === 'omt-next-frame' || (t.hasAttribute('data-frame') && t.getAttribute('data-frame') === '1')) {
                handled = true;
                run(() => { if (typeof avancarFrame === 'function') avancarFrame(); });
            } else {
                const sec = skipFromEl(t);
                if (sec != null) {
                    handled = true;
                    run(() => {
                        if (typeof saltarVideo === 'function') saltarVideo(sec);
                        else if (isFinite(videoEl.currentTime)) {
                            videoEl.currentTime = Math.max(0, (videoEl.currentTime || 0) + sec);
                        }
                    });
                } else if (id === 'omt-more-toggle' || t.classList.contains('omt-more-toggle')) {
                    /* q() looks under omtRoot — panel is in PiP, so toggle DOM locally. */
                    handled = true;
                    const morePanel = panel.querySelector('#omt-more-panel, .omt-more-panel');
                    const moreBtn = t;
                    if (morePanel) {
                        const next = !morePanel.classList.contains('is-open');
                        morePanel.classList.toggle('is-open', next);
                        morePanel.setAttribute('aria-hidden', next ? 'false' : 'true');
                        moreBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
                        moreBtn.setAttribute('data-tip', next ? 'Less controls' : 'More controls');
                        moreBtn.classList.toggle('is-open', next);
                        const collapsedIcon = moreBtn.querySelector('.omt-more-icon-collapsed');
                        const expandedIcon = moreBtn.querySelector('.omt-more-icon-expanded');
                        if (collapsedIcon) collapsedIcon.hidden = next;
                        if (expandedIcon) expandedIcon.hidden = !next;
                        panel.classList.toggle('omt-more-open', next);
                    }
                } else if (id === 'omt-hide-panel' || t.classList.contains('omt-tile-hide')) {
                    handled = true;
                    run(() => {
                        if (typeof toggleAutoHideChrome === 'function') toggleAutoHideChrome();
                        else if (typeof toggleManualControlsVisibility === 'function') toggleManualControlsVisibility();
                        /* Refresh tip/classes on the live PiP button (q() misses PiP nodes). */
                        const on = typeof storageGetAutoHideChrome === 'function'
                            ? storageGetAutoHideChrome() : true;
                        t.classList.toggle('is-auto-hide-on', on);
                        t.classList.toggle('is-auto-hide-off', !on);
                        t.setAttribute('aria-pressed', on ? 'true' : 'false');
                        t.setAttribute('data-tip', on ? 'Auto hide: on' : 'Auto hide: off');
                        if (typeof omtIcon === 'function') {
                            try { t.innerHTML = omtIcon(on ? 'eye-off' : 'eye', 16); } catch (_) {}
                        }
                    });
                } else if (id === 'omt-volume-icon-btn' || t.classList.contains('omt-tile-panel-vol-btn')) {
                    handled = true;
                    run(() => {
                        if (typeof toggleMute === 'function') toggleMute();
                        else videoEl.muted = !videoEl.muted;
                    });
                } else if (id === 'omt-live-btn' || t.classList.contains('omt-tile-panel-live')) {
                    handled = true;
                    run(() => { if (typeof irParaLive === 'function') irParaLive(); });
                }
            }

            if (handled) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (omtPipState) {
                    omtPopoutSyncPlayIcon(omtPipState.iconRow, videoEl);
                    omtPopoutPaintVideoTime(omtPipState.iconRow, videoEl);
                    omtPopoutSyncTimelineProgress(omtPipState);
                    if (omtPipState._chromeShow) omtPipState._chromeShow();
                }
            }
        };

        const onInput = (e) => {
            const t = e.target;
            if (!t || !panel.contains(t)) return;
            if (t.id === 'omt-volume-range' || t.classList.contains('omt-tile-panel-vol-range')) {
                e.stopPropagation();
                const val = parseFloat(t.value);
                run(() => {
                    if (!isFinite(val)) return;
                    videoEl.volume = Math.max(0, Math.min(1, val));
                    videoEl.muted = val <= 0;
                    if (typeof atualizarIconeVolume === 'function') {
                        try { atualizarIconeVolume(); } catch (_) {}
                    }
                });
            }
        };

        const onChange = (e) => {
            const t = e.target;
            if (!t || !panel.contains(t)) return;
            if (t.id === 'omt-speed-select' || t.classList.contains('omt-tile-speed-select')) {
                e.stopPropagation();
                const rate = parseFloat(t.value);
                run(() => {
                    if (!isFinite(rate)) return;
                    if (typeof applyPlaybackSpeed === 'function') applyPlaybackSpeed(rate);
                    else videoEl.playbackRate = rate;
                    if (typeof syncSpeedSelect === 'function') {
                        try { syncSpeedSelect(); } catch (_) {}
                    }
                });
            }
        };

        panel.addEventListener('click', onClick, true);
        panel.addEventListener('input', onInput, true);
        panel.addEventListener('change', onChange, true);
        return () => {
            try {
                panel.removeEventListener('click', onClick, true);
                panel.removeEventListener('input', onInput, true);
                panel.removeEventListener('change', onChange, true);
            } catch (_) {}
        };
    }

    /** Force compact small panel; hide LIVE on local; hide pop-out; install PiP drag. */
    function omtPopoutPreparePanelForPip(state) {
        const panel = state && state.controlsPanel;
        if (!panel) return;
        if (!state._panelClassSnap) {
            state._panelClassSnap = {
                small: panel.classList.contains('omt-panel-size-small'),
                compact: panel.classList.contains('omt-panel-compact')
            };
        }
        panel.classList.add('omt-panel-size-small', 'omt-panel-compact');

        const popBtn = panel.querySelector('#omt-popout-btn, [id$="omt-popout-btn"], .omt-tile-popout');
        if (popBtn) {
            state._popBtn = popBtn;
            state._popBtnWasHidden = popBtn.hidden;
            popBtn.hidden = true;
            popBtn.style.display = 'none';
        }

        if (omtPopoutIsLocal()) {
            const live = panel.querySelector('#omt-live-btn, [id$="omt-live-btn"]');
            if (live) {
                state._liveBtn = live;
                state._liveBtnWasHidden = live.hidden;
                live.hidden = true;
                live.style.display = 'none';
            }
            const spacer = panel.querySelector('.omt-live-spacer');
            if (spacer) {
                state._liveSpacer = spacer;
                spacer.style.display = 'none';
            }
        }

        /* Clear page auto-hide / positioning so the slot centers a clickable panel. */
        try {
            panel.style.opacity = '1';
            panel.style.pointerEvents = 'auto';
            panel.style.visibility = 'visible';
        } catch (_) {}
        if (!panel.classList.contains('omt-pip-panel-floating')) {
            try {
                panel.style.left = '';
                panel.style.top = '';
                panel.style.bottom = '';
                panel.style.right = '';
                panel.style.transform = '';
                panel.style.position = '';
            } catch (_) {}
        }

        if (!state._pipDragTeardown && state.win && state.root) {
            state._pipDragTeardown = omtPopoutInstallPipDrag(panel, state.win, state.root);
        }
        if (!state._pipBridgeTeardown && state.video) {
            state._pipBridgeTeardown = omtPopoutInstallPanelBridge(panel, state.video);
        }
    }

    function omtPopoutRestorePanelAfterPip(state) {
        const panel = state && state.controlsPanel;
        if (!panel) return;
        try {
            if (state._pipDragTeardown) {
                state._pipDragTeardown();
                state._pipDragTeardown = null;
            }
        } catch (_) {}
        try {
            if (state._pipBridgeTeardown) {
                state._pipBridgeTeardown();
                state._pipBridgeTeardown = null;
            }
        } catch (_) {}
        try { panel.classList.remove('omt-pip-panel-floating'); } catch (_) {}
        if (state._panelClassSnap) {
            if (!state._panelClassSnap.small) panel.classList.remove('omt-panel-size-small');
            if (!state._panelClassSnap.compact) panel.classList.remove('omt-panel-compact');
            state._panelClassSnap = null;
        }
        if (state._popBtn) {
            state._popBtn.hidden = !!state._popBtnWasHidden;
            state._popBtn.style.display = '';
            state._popBtn = null;
        }
        if (state._liveBtn) {
            state._liveBtn.hidden = !!state._liveBtnWasHidden;
            state._liveBtn.style.display = '';
            state._liveBtn = null;
        }
        if (state._liveSpacer) {
            state._liveSpacer.style.display = '';
            state._liveSpacer = null;
        }
        try {
            panel.style.zIndex = '';
            panel.style.margin = '';
        } catch (_) {}
    }

    /** Attach / detach the real control panel based on narrow vs wide. */
    function omtPopoutSyncPanelMode(state) {
        if (!state || !state.root) return;
        const narrow = state.root.classList.contains('omt-pip-narrow');
        const panel = state.controlsPanel;
        const slot = state.panelSlot;
        if (!panel || !slot) return;
        if (narrow) {
            if (panel.parentNode === slot || panel.classList.contains('omt-pip-panel-floating')) {
                try { panel.classList.remove('omt-pip-panel-floating'); } catch (_) {}
                omtPopoutRestoreNode(panel, state.panelParent, state.panelNext);
            }
        } else {
            if (panel.parentNode !== slot && !panel.classList.contains('omt-pip-panel-floating')) {
                if (!state.panelParent) {
                    state.panelParent = panel.parentNode;
                    state.panelNext = panel.nextSibling;
                }
                try { slot.appendChild(panel); } catch (_) {}
            }
            omtPopoutPreparePanelForPip(state);
        }
    }

    function omtPopoutUpdateLayout(root, win, state) {
        if (!root || !win) return;
        const w = win.innerWidth || 0;
        const h = win.innerHeight || 0;
        /* Large only when wide enough; very short windows also stay icon-row. */
        const narrow = w > 0 && (w < OMT_PIP_CONTROLS_MIN_W || (h > 0 && h < OMT_PIP_CONTROLS_MIN_H));
        root.classList.toggle('omt-pip-narrow', narrow);
        const timerPx = w <= 0
            ? 26
            : Math.max(OMT_PIP_TIMER_MIN_PX, Math.min(26, Math.round(11 + w * 0.022)));
        try { root.style.setProperty('--omt-pip-timer-size', timerPx + 'px'); } catch (_) {}
        if (state) omtPopoutSyncPanelMode(state);
    }

    function omtPopoutArmChromeReveal(root, state) {
        if (!root || !state) return;
        const show = () => {
            root.classList.add('omt-pip-chrome-on');
            if (state.timelineBar) {
                omtPopoutRefreshPeriodTicks(state.timelineBar);
                omtPopoutSyncTimelineProgress(state);
            }
            if (state.iconRow && state.video) omtPopoutPaintVideoTime(state.iconRow, state.video);
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

    function omtPopoutResolveControlsPanel(tileRoot) {
        try {
            if (tileRoot) {
                const p = tileRoot.querySelector('.omt-controls-panel, [id$="omt-controls-panel"]');
                if (p) return p;
            }
        } catch (_) {}
        try {
            if (typeof q === 'function') {
                const p = q('omt-controls-panel');
                if (p) return p;
            }
        } catch (_) {}
        return document.getElementById('omt-controls-panel');
    }

    /**
     * Forward PiP keydowns into the same handleKeydown path. Keep focus inside
     * the PiP so Chrome delivers keys to this document.
     */
    function omtPopoutInstallFocusInput(pipWin, videoEl, tileRoot, root) {
        if (!pipWin || !pipWin.document) return null;
        const onKey = (e) => {
            try {
                if (tileRoot && typeof omtInplayMvSetHotkeyTarget === 'function') {
                    omtInplayMvSetHotkeyTarget(videoEl);
                }
            } catch (_) {}
            omtPopoutWithTargetVideo(videoEl, () => {
                if (typeof handleKeydown === 'function') {
                    try { handleKeydown(e); } catch (_) {}
                }
            });
            if (omtPipState) {
                omtPopoutPaintVideoTime(omtPipState.iconRow, videoEl);
                omtPopoutSyncTimelineProgress(omtPipState);
                omtPopoutSyncPlayIcon(omtPipState.iconRow, videoEl);
                if (omtPipState._chromeShow) omtPipState._chromeShow();
            }
        };
        const keepFocus = (e) => {
            try {
                const t = e && e.target;
                if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
                if (root && pipWin.document.activeElement !== root) {
                    root.focus({ preventScroll: true });
                }
            } catch (_) {}
        };
        try {
            if (root) {
                root.tabIndex = -1;
                root.setAttribute('tabindex', '-1');
            }
            pipWin.document.addEventListener('keydown', onKey, true);
            pipWin.addEventListener('keydown', onKey, true);
            if (pipWin.document.documentElement) {
                pipWin.document.documentElement.addEventListener('keydown', onKey, true);
            }
            pipWin.document.addEventListener('pointerdown', keepFocus, true);
            pipWin.addEventListener('focus', keepFocus);
            try { pipWin.focus(); } catch (_) {}
            try { if (root) root.focus({ preventScroll: true }); } catch (_) {}
        } catch (_) {}
        if (omtPipState) omtPipState._keepFocus = keepFocus;
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
        if (omtPopoutIsLocal()) root.classList.add('omt-pip-local');
        root.tabIndex = -1;
        const stage = doc.createElement('div');
        stage.className = 'omt-pip-stage';
        const timerHost = doc.createElement('div');
        timerHost.className = 'omt-pip-timer-host';
        const chrome = doc.createElement('div');
        chrome.className = 'omt-pip-chrome';
        const iconRow = omtPopoutBuildIconRow(doc);
        const panelSlot = doc.createElement('div');
        panelSlot.className = 'omt-pip-panel-slot';
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
            controlsPanel: null,
            panelParent: null,
            panelNext: null,
            panelSlot,
            iconRow,
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
            try {
                timerHost.appendChild(timerWrap);
                timerWrap.style.display = 'block';
                timerWrap.style.visibility = 'visible';
                timerWrap.classList.add('is-visible');
                const chip = timerWrap.querySelector('#match-timer, .omt-match-timer, [id$="match-timer"]');
                if (chip) {
                    chip.style.display = 'inline-block';
                    chip.style.visibility = 'visible';
                }
                if (typeof atualizarRelogio === 'function') {
                    try { atualizarRelogio(); } catch (_) {}
                }
            } catch (_) {}
        }

        /* Order: panel slot + icon row first, timeline LAST (bottom-anchored). */
        chrome.appendChild(panelSlot);
        chrome.appendChild(iconRow);

        const timelineBar = omtPopoutResolveTimelineBar(resolved.tileRoot);
        if (timelineBar && timelineBar.parentNode) {
            state.timelineBar = timelineBar;
            state.timelineParent = timelineBar.parentNode;
            state.timelineNext = timelineBar.nextSibling;
            try {
                chrome.appendChild(timelineBar);
                omtPopoutRefreshPeriodTicks(timelineBar);
                omtPopoutWireTimelineTips(timelineBar);
                state._timelineSeekTeardown = omtPopoutWireTimelineSeek(timelineBar, videoEl);
                omtPopoutSyncTimelineProgress(state);
            } catch (_) {}
        }

        const controlsPanel = omtPopoutResolveControlsPanel(resolved.tileRoot);
        if (controlsPanel) {
            state.controlsPanel = controlsPanel;
            state.panelParent = controlsPanel.parentNode;
            state.panelNext = controlsPanel.nextSibling;
        }

        omtPopoutWireIconRow(iconRow, videoEl);
        omtPopoutWireIconTips(iconRow, doc, state);

        stage.addEventListener('click', (e) => {
            if (e.target && e.target.closest &&
                e.target.closest('.omt-pip-chrome, .omt-pip-timer-host, .omt-controls-panel')) return;
            if (!(e.target === stage || (e.target && e.target.tagName === 'VIDEO'))) return;
            omtPopoutWithTargetVideo(videoEl, () => {
                if (typeof togglePlay === 'function') togglePlay();
                else if (videoEl.paused) videoEl.play().catch(() => {});
                else videoEl.pause();
            });
            omtPopoutSyncPlayIcon(iconRow, videoEl);
            if (state._chromeShow) state._chromeShow();
        });

        omtPopoutUpdateLayout(root, pipWin, state);
        omtPopoutArmChromeReveal(root, state);

        const onResize = () => {
            omtPopoutUpdateLayout(root, pipWin, state);
            if (state.timelineBar) {
                omtPopoutRefreshPeriodTicks(state.timelineBar);
                omtPopoutSyncTimelineProgress(state);
            }
        };
        try { pipWin.addEventListener('resize', onResize); } catch (_) {}
        state._onResize = onResize;

        state._keyHandler = omtPopoutInstallFocusInput(pipWin, videoEl, resolved.tileRoot, root);

        const onPageHide = () => { omtPopoutClose({ fromPip: true }); };
        try { pipWin.addEventListener('pagehide', onPageHide); } catch (_) {}
        state._onPageHide = onPageHide;

        try {
            if (omtRoot) omtRoot.classList.add('omt-pip-active');
            if (resolved.tileRoot) resolved.tileRoot.classList.add('omt-pip-active');
        } catch (_) {}

        try { pipWin.focus(); } catch (_) {}
        try { root.focus({ preventScroll: true }); } catch (_) {}
        if (state._chromeShow) state._chromeShow();
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
            if (state._timelineSeekTeardown) {
                state._timelineSeekTeardown();
                state._timelineSeekTeardown = null;
            }
            if (state._tipHide) state._tipHide();
            if (state._iconTip && state._iconTip.parentNode) {
                state._iconTip.parentNode.removeChild(state._iconTip);
            }
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
                if (state.win.document.documentElement) {
                    state.win.document.documentElement.removeEventListener('keydown', state._keyHandler, true);
                }
            }
            if (state.win && state._keepFocus) {
                state.win.document.removeEventListener('pointerdown', state._keepFocus, true);
                state.win.removeEventListener('focus', state._keepFocus);
            }
            if (state.win && state._onResize) {
                state.win.removeEventListener('resize', state._onResize);
            }
            if (state.win && state._onPageHide) {
                state.win.removeEventListener('pagehide', state._onPageHide);
            }
        } catch (_) {}

        omtPopoutRestorePanelAfterPip(state);

        /* Restore panel before timeline so page layout settles cleanly. */
        omtPopoutRestoreNode(state.controlsPanel, state.panelParent, state.panelNext);
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
            if (typeof atualizarRelogio === 'function') atualizarRelogio();
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
        window.__omtPipControlsMinH = OMT_PIP_CONTROLS_MIN_H;
    } catch (_) {}
