/* Controls auto-hide: activity tracking, hover keep-visible, idle fade. */
    /* =========================================================
       13B. AUTO-HIDE CONTROLS
       ========================================================= */
    // showPanel=true  → show the panel immediately (mouse hover path).
    // showPanel=false → only reset/maintain the auto-hide countdown without
    //                   making the panel visible (non-mouse paths: play event,
    //                   loadedmetadata, timeline change, ShuttleXpress, etc.).
    function isOmtInteractiveTarget(target) {
        if (!target || !omtRoot) return false;
        const el = target.nodeType === 1 ? target : target.parentElement;
        if (!el || !omtRoot.contains(el)) return false;
        return !!el.closest('.glass-panel, #controls-panel, #match-timer-wrap, #match-timer, #omt-timeline-bar, #omt-more-panel, #omt-kickoff-bar, #omt-examino-settings, #osd-message, button, input, select, label, a, .omt-hud-chip');
    }

    function noteOmtUiActivity(showPanel = true) {
        resetControlsTimeout(showPanel);
    }

    function setChromeVisible(visible) {
        const opacity = visible ? '1' : '0';
        const pe = visible ? 'auto' : 'none';
        if (controlsPanel) {
            controlsPanel.style.opacity = opacity;
            controlsPanel.style.pointerEvents = pe;
        }
        const timelineBar = omtRoot ? omtRoot.querySelector('#omt-timeline-bar') : null;
        if (timelineBar) {
            timelineBar.style.opacity = opacity;
            // Shell stays pointer-events:none (CSS); children hit when visible.
            // Inline 'none' when hidden is a belt-and-braces for hosts that
            // rewrite CSS — class disables interactive children.
            timelineBar.style.pointerEvents = 'none';
            timelineBar.classList.toggle('omt-chrome-hidden', !visible);
        }
    }

    function wireOmtUiActivityTracking() {
        if (!omtRoot) return;
        const activityEvents = ['mousemove', 'mousedown', 'pointerdown', 'click', 'wheel', 'keydown', 'touchstart'];
        activityEvents.forEach((evName) => {
            omtRoot.addEventListener(evName, (e) => {
                if (isOmtInteractiveTarget(e.target)) {
                    noteOmtUiActivity(true);
                }
            }, true);
        });

        const trackHover = (panel) => {
            if (!panel) return;
            panel.addEventListener('mouseenter', () => {
                pointerOverOmtUi = true;
                noteOmtUiActivity(true);
            });
            panel.addEventListener('mouseleave', () => {
                pointerOverOmtUi = false;
                // Restart idle timer once the pointer leaves, without forcing show.
                resetControlsTimeout(false);
            });
        };
        trackHover(controlsPanel);
        trackHover(setupPanel);
        // Hover the interactive timeline pieces only — not the full-width
        // padded bar shell (that was keeping auto-hide stuck ON in v1.7.4).
        const timelineBar = omtRoot.querySelector('#omt-timeline-bar');
        if (timelineBar) {
            trackHover(timelineBar.querySelector('.omt-timeline-track'));
            trackHover(timelineBar.querySelector('.omt-timeline-times'));
        }
        if (timerUI) trackHover(timerUI);
    }

    function resetControlsTimeout(showPanel = true) {
        if (mouseMoveTimeout) {
            clearTimeout(mouseMoveTimeout);
            mouseMoveTimeout = null;
        }

        if (isManuallyHidden) return;

        // InplayIP: identical finite-duration gate. Examino: allow seekable MSE.
        if (vid && !site.mediaReady(vid)) return;

        // Redesign Auto-hide toggle: when OFF, keep chrome visible and skip idle fade.
        // Original timer / activity paths below are unchanged when ON.
        if (typeof storageGetAutoHideChrome === 'function' && !storageGetAutoHideChrome()) {
            if (controlsPanel) setChromeVisible(true);
            return;
        }

        if (showPanel && controlsPanel) {
            setChromeVisible(true);
        }

        // Only schedule the hide timer when the panel is already visible.
        if (!controlsPanel || controlsPanel.style.opacity !== '1') return;

        // While the pointer rests on our UI, keep the panel visible (clicking
        // -2s repeatedly with a still mouse must not hide the bar).
        if (pointerOverOmtUi) return;

        mouseMoveTimeout = setTimeout(() => {
            if (isDraggingTimeline || pointerOverOmtUi) {
                resetControlsTimeout(false);
                return;
            }
            setChromeVisible(false);
        }, 2500);
    }

    function syncAutoHideChromeButton() {
        const btn = typeof q === 'function' ? q('omt-hide-panel') : null;
        if (!btn) return;
        const on = typeof storageGetAutoHideChrome === 'function' ? storageGetAutoHideChrome() : true;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.setAttribute('data-tip', on ? 'Auto hide: on' : 'Auto hide: off');
        btn.classList.toggle('is-auto-hide-on', on);
        btn.classList.toggle('is-auto-hide-off', !on);
        btn.innerHTML = on ? omtIcon('eye-off', 16) : omtIcon('eye', 16);
    }

    function toggleAutoHideChrome() {
        const next = !(typeof storageGetAutoHideChrome === 'function' ? storageGetAutoHideChrome() : true);
        if (typeof storageSetAutoHideChrome === 'function') storageSetAutoHideChrome(next);
        syncAutoHideChromeButton();
        // Never hide immediately — only gate future idle fades.
        if (typeof resetControlsTimeout === 'function') resetControlsTimeout(true);
        if (typeof mostrarOSD === 'function') mostrarOSD(next ? 'Auto hide on' : 'Auto hide off');
    }
