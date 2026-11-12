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
                const allowedRates = [0.25, 0.5, 1.0, 1.5, 2.0];
                const currentRate = vid.playbackRate;
                const closestRate = allowedRates.reduce((prev, curr) => 
                    Math.abs(curr - currentRate) < Math.abs(prev - currentRate) ? curr : prev
                );
                const currentIndex = allowedRates.indexOf(closestRate);
                const newIndex = Math.max(0, currentIndex - 1);
                applyPlaybackSpeed(allowedRates[newIndex]);
                break;
            }
            case 'c': {
                const allowedRates = [0.25, 0.5, 1.0, 1.5, 2.0];
                const currentRate = vid.playbackRate;
                const closestRate = allowedRates.reduce((prev, curr) => 
                    Math.abs(curr - currentRate) < Math.abs(prev - currentRate) ? curr : prev
                );
                const currentIndex = allowedRates.indexOf(closestRate);
                const newIndex = Math.min(allowedRates.length - 1, currentIndex + 1);
                applyPlaybackSpeed(allowedRates[newIndex]);
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
        const currentRate = vid.playbackRate;
        const allowedRates = [0.25, 0.5, 1.0, 1.5, 2.0];
        const closestRate = allowedRates.reduce((prev, curr) => 
            Math.abs(curr - currentRate) < Math.abs(prev - currentRate) ? curr : prev
        );
        const rateStrings = { 0.25: "0.25", 0.5: "0.5", 1.0: "1.0", 1.5: "1.5", 2.0: "2.0" };
        if (speedSelect) {
            speedSelect.value = rateStrings[closestRate] || closestRate.toString();
        }
        if (typeof syncSpeedChips === 'function') syncSpeedChips();
    }
