/* Auto pause on Alt+Tab / tab hidden (popup General setting, default OFF).
 * Never touches ShuttleXpress pages; resumes only when we caused the pause.
 * v2.2.13 Examino: when setting is OFF, host still pauses on blur — note if
 * we were playing (capture) and resume once on return without fighting a
 * manual pause. InPlay/Xeatre unchanged.
 */
    let autoPauseInstalled = false;
    let autoPausedByBlur = false;
    let autoPauseInProgress = false;
    let autoResumeInProgress = false;
    let lastShuttleActivityAt = 0;
    let examinoResumeAfterHostPause = false;

    function noteShuttleActivity() {
        lastShuttleActivityAt = Date.now();
    }

    function clearAutoPauseFlag() {
        if (autoPauseInProgress || autoResumeInProgress) return;
        autoPausedByBlur = false;
        examinoResumeAfterHostPause = false;
    }

    function shouldBypassAutoPause() {
        // Setting off, Shuttle enabled on this page, or recent WebHID/shuttle input.
        if (typeof storageGetAutoPauseOnBlur === 'function' && !storageGetAutoPauseOnBlur()) {
            return true;
        }
        if (typeof storageGetShuttleEnabled === 'function' && storageGetShuttleEnabled()) {
            return true;
        }
        if (Date.now() - lastShuttleActivityAt < 1000) return true;
        return false;
    }

    /** Capture-phase: record playing-before-away before host pause handlers run. */
    function noteExaminoPlayingBeforeAway() {
        if (!(site && site.id === 'examino')) return;
        if (typeof storageGetAutoPauseOnBlur === 'function' && storageGetAutoPauseOnBlur()) {
            examinoResumeAfterHostPause = false;
            return;
        }
        if (!vid || !vid.isConnected) {
            examinoResumeAfterHostPause = false;
            return;
        }
        examinoResumeAfterHostPause = !vid.paused && !vid.ended;
    }

    function maybeExaminoResumeAfterHostPause() {
        if (!(site && site.id === 'examino')) return;
        if (typeof storageGetAutoPauseOnBlur === 'function' && storageGetAutoPauseOnBlur()) {
            examinoResumeAfterHostPause = false;
            return;
        }
        if (!examinoResumeAfterHostPause) return;
        examinoResumeAfterHostPause = false;
        if (!ensureLiveVideo()) return;
        // Already playing, or user paused themselves — do nothing.
        if (!vid.paused || vid.ended) return;
        autoResumeInProgress = true;
        safePlay(vid)
            .finally(() => {
                autoResumeInProgress = false;
                if (typeof syncPlayButtonFromVideo === 'function') syncPlayButtonFromVideo();
            });
    }

    function maybeAutoPauseOnAway() {
        if (shouldBypassAutoPause()) return;
        if (!ensureLiveVideo()) return;
        // Already paused (manual or ended) — do not claim an auto-pause resume.
        if (vid.paused || vid.ended) return;
        autoPauseInProgress = true;
        try {
            vid.pause();
            // Set after pause so the pause listener's clear (if any) is skipped via in-progress.
            if (vid.paused) {
                autoPausedByBlur = true;
                mostrarOSD('Auto paused');
            }
        } finally {
            autoPauseInProgress = false;
        }
        syncPlayButtonFromVideo();
    }

    function maybeAutoResumeOnReturn() {
        if (!autoPausedByBlur) return;
        // Shuttle pages never auto-pause; if shuttle was enabled while away, drop resume.
        if (typeof storageGetShuttleEnabled === 'function' && storageGetShuttleEnabled()) {
            autoPausedByBlur = false;
            return;
        }
        if (!ensureLiveVideo()) return;
        if (!vid.paused) {
            autoPausedByBlur = false;
            return;
        }
        autoResumeInProgress = true;
        autoPausedByBlur = false;
        safePlay(vid)
            .finally(() => {
                autoResumeInProgress = false;
                syncPlayButtonFromVideo();
            });
    }

    function onDocumentVisibilityChangeCapture() {
        if (document.visibilityState === 'hidden') noteExaminoPlayingBeforeAway();
    }

    function onWindowBlurCapture() {
        if (document.visibilityState === 'hidden') return;
        noteExaminoPlayingBeforeAway();
    }

    function onDocumentVisibilityChange() {
        if (document.visibilityState === 'hidden') maybeAutoPauseOnAway();
        else if (document.visibilityState === 'visible') {
            maybeAutoResumeOnReturn();
            maybeExaminoResumeAfterHostPause();
            // FS decode can stall after Alt+Tab even when auto-pause is off.
            wakeFullscreenDecode();
        }
    }

    function onWindowBlur() {
        // visibilitychange usually covers Alt+Tab; blur covers focus loss while visible.
        if (document.visibilityState === 'hidden') return;
        maybeAutoPauseOnAway();
    }

    function onWindowFocus() {
        maybeAutoResumeOnReturn();
        maybeExaminoResumeAfterHostPause();
        wakeFullscreenDecode();
    }

    function installAutoPauseOnBlur() {
        if (autoPauseInstalled) return;
        autoPauseInstalled = true;
        // Capture first so Examino host pause (bubble) does not erase "was playing".
        document.addEventListener('visibilitychange', onDocumentVisibilityChangeCapture, true);
        window.addEventListener('blur', onWindowBlurCapture, true);
        document.addEventListener('visibilitychange', onDocumentVisibilityChange);
        window.addEventListener('blur', onWindowBlur);
        window.addEventListener('focus', onWindowFocus);
    }
