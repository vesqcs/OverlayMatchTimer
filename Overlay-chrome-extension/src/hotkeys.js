/* Capture-phase hotkeys (shared handler; Examino installs on window). */
    /* =========================================================
       14. KEYBOARD SHORTCUTS (capture phase — intercepts Video.js)
       ========================================================= */
    function isEditableKeyTarget(target) {
        if (!target) return false;
        if (target.isContentEditable) return true;
        const el = target.nodeType === 1 ? target : target.parentElement;
        if (!el) return false;
        if (el.closest && el.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]')) {
            return true;
        }
        const tag = (el.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    }

    function handleKeydown(e) {
        // Don't intercept when user is typing in inputs / contenteditable
        if (isEditableKeyTarget(e.target)) return;

        const key = e.key.toLowerCase();
        // L was free (not previously bound) — used for Go Live via irParaLive().
        // K marks kick-off at the current frame via existing iniciarTimer().
        const controlled = ['arrowright', 'arrowleft', 'arrowup', 'arrowdown', ' ', 'z', 'c', 'x', 'h', 'k', 'l'];
        if (!controlled.includes(key)) return;

        // Stop the event before Video.js / OpenPlayer / Examino handles it
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (!ensureLiveVideo()) return;

        switch (key) {
            case 'arrowright':
                if (e.ctrlKey) saltarVideo(120);
                else if (e.shiftKey) saltarVideo(10);
                else saltarVideo(2);
                break;
            case 'arrowleft':
                if (e.ctrlKey) saltarVideo(-120);
                else if (e.shiftKey) saltarVideo(-10);
                else saltarVideo(-2);
                break;
            case 'arrowup': avancarFrame(); break;
            case 'arrowdown': retrocederFrame(); break;
            case ' ': togglePlay(); break;
            case 'z': {
                const closestRate = closestSpeedRate(vid.playbackRate);
                const currentIndex = OMT_SPEED_RATES.indexOf(closestRate);
                const newIndex = Math.max(0, currentIndex - 1);
                applyPlaybackSpeed(OMT_SPEED_RATES[newIndex]);
                break;
            }
            case 'c': {
                const closestRate = closestSpeedRate(vid.playbackRate);
                const currentIndex = OMT_SPEED_RATES.indexOf(closestRate);
                const newIndex = Math.min(OMT_SPEED_RATES.length - 1, currentIndex + 1);
                applyPlaybackSpeed(OMT_SPEED_RATES[newIndex]);
                break;
            }
            case 'x':
                applyPlaybackSpeed(1.0);
                break;
            case 'h':
                toggleManualControlsVisibility();
                break;
            case 'k':
                // Same path as the Kick-off button (auto-captures current frame).
                iniciarTimer();
                break;
            case 'l':
                // Same path as the LIVE button.
                irParaLive();
                break;

        }
    }

    function toggleManualControlsVisibility() {
        if (!controlsPanel) return;
        if (isManuallyHidden) {
            isManuallyHidden = false;
            resetControlsTimeout();
            mostrarOSD('Controls Visible');
            return;
        }
        isManuallyHidden = true;
        if (mouseMoveTimeout) {
            clearTimeout(mouseMoveTimeout);
            mouseMoveTimeout = null;
        }
        controlsPanel.style.opacity = '0';
        controlsPanel.style.pointerEvents = 'none';
        const timelineBar = omtRoot ? omtRoot.querySelector('#omt-timeline-bar') : null;
        if (timelineBar) {
            timelineBar.style.opacity = '0';
            timelineBar.style.pointerEvents = 'none';
        }
        mostrarOSD('Controls Hidden');
    }

    function syncSpeedSelect() {
        if (!ensureLiveVideo()) return;
        const closestRate = closestSpeedRate(vid.playbackRate);
        if (speedSelect) {
            speedSelect.value = OMT_SPEED_SELECT_VALUES[closestRate] || String(closestRate);
        }
        if (typeof syncSpeedChips === 'function') syncSpeedChips();
    }
