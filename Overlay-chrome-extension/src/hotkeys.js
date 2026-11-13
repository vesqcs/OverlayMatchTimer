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

    function runHotkeyAction(actionId) {
        if (!ensureLiveVideo()) return;
        switch (actionId) {
            case 'skipFwd2': saltarVideo(2); break;
            case 'skipBack2': saltarVideo(-2); break;
            case 'skipFwd10': saltarVideo(10); break;
            case 'skipBack10': saltarVideo(-10); break;
            case 'skipFwd2m': saltarVideo(120); break;
            case 'skipBack2m': saltarVideo(-120); break;
            case 'frameFwd': avancarFrame(); break;
            case 'frameBack': retrocederFrame(); break;
            case 'playPause': togglePlay(); break;
            case 'speedDown': {
                const closestRate = closestSpeedRate(vid.playbackRate);
                const currentIndex = OMT_SPEED_RATES.indexOf(closestRate);
                const newIndex = Math.max(0, currentIndex - 1);
                applyPlaybackSpeed(OMT_SPEED_RATES[newIndex]);
                break;
            }
            case 'speedUp': {
                const closestRate = closestSpeedRate(vid.playbackRate);
                const currentIndex = OMT_SPEED_RATES.indexOf(closestRate);
                const newIndex = Math.min(OMT_SPEED_RATES.length - 1, currentIndex + 1);
                applyPlaybackSpeed(OMT_SPEED_RATES[newIndex]);
                break;
            }
            case 'speedReset':
                applyPlaybackSpeed(1.0);
                break;
            case 'hide':
                toggleManualControlsVisibility();
                break;
            case 'kickoff':
                iniciarTimer();
                break;
            case 'live':
                irParaLive();
                break;
            default:
                break;
        }
    }

    function handleKeydown(e) {
        // Don't intercept when user is typing in inputs / contenteditable
        if (isEditableKeyTarget(e.target)) return;

        const actionId = (typeof omtFindHotkeyAction === 'function')
            ? omtFindHotkeyAction(e)
            : null;
        if (!actionId) return;

        // Stop the event before Video.js / OpenPlayer / Examino handles it
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        runHotkeyAction(actionId);
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
