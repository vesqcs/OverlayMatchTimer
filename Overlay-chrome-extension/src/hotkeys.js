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
        const controlled = ['arrowright', 'arrowleft', 'arrowup', 'arrowdown', ' ', 'z', 'c', 'x', 'h'];
        if (!controlled.includes(key)) return;

        // Stop the event before Video.js / OpenPlayer / Examino handles it
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (!vid) return;

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
                vid.playbackRate = allowedRates[newIndex];
                syncSpeedSelect();
                mostrarOSD('⚡ Speed: ' + vid.playbackRate.toFixed(2) + 'x');
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
                vid.playbackRate = allowedRates[newIndex];
                syncSpeedSelect();
                mostrarOSD('⚡ Speed: ' + vid.playbackRate.toFixed(2) + 'x');
                break;
            }
            case 'x':
                vid.playbackRate = 1.0;
                syncSpeedSelect();
                mostrarOSD('⚡ Speed: 1.00x');
                break;
            case 'h':
                if (controlsPanel) {
                    if (isManuallyHidden) {
                        isManuallyHidden = false;
                        resetControlsTimeout();
                        mostrarOSD('🖥️ Controls Visible');
                    } else {
                        isManuallyHidden = true;
                        if (mouseMoveTimeout) {
                            clearTimeout(mouseMoveTimeout);
                            mouseMoveTimeout = null;
                        }
                        controlsPanel.style.opacity = '0';
                        controlsPanel.style.pointerEvents = 'none';
                        mostrarOSD('🙈 Controls Hidden');
                    }
                }
                break;

        }
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
    }
