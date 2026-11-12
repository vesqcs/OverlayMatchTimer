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
        return !!el.closest('.glass-panel, .omt-controls-scrim, #match-timer-wrap, #match-timer, #omt-more-panel, #omt-kickoff-bar, #omt-examino-settings, #osd-message, button, input, select, label, a, .omt-timeline-full, .omt-hud-chip');
    }

    function noteOmtUiActivity(showPanel = true) {
        resetControlsTimeout(showPanel);
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

        if (showPanel && controlsPanel) {
            controlsPanel.style.opacity = '1';
            controlsPanel.style.pointerEvents = 'auto';
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
            if (controlsPanel) {
                controlsPanel.style.opacity = '0';
                controlsPanel.style.pointerEvents = 'none';
            }
        }, 2500);
    }
