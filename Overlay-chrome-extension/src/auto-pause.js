/* Auto pause on Alt+Tab / tab hidden (popup General setting, default OFF).
 * Never touches ShuttleXpress pages; resumes only when we caused the pause.
 */
    let autoPauseInstalled = false;
    let autoPausedByBlur = false;
    let autoPauseInProgress = false;
    let autoResumeInProgress = false;
    let lastShuttleActivityAt = 0;

    function noteShuttleActivity() {
        lastShuttleActivityAt = Date.now();
    }

    function clearAutoPauseFlag() {
        if (autoPauseInProgress || autoResumeInProgress) return;
        autoPausedByBlur = false;
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
        Promise.resolve(vid.play())
            .catch(() => {})
            .finally(() => {
                autoResumeInProgress = false;
                syncPlayButtonFromVideo();
            });
    }

    function onDocumentVisibilityChange() {
        if (document.visibilityState === 'hidden') maybeAutoPauseOnAway();
        else if (document.visibilityState === 'visible') maybeAutoResumeOnReturn();
    }

    function onWindowBlur() {
        // visibilitychange usually covers Alt+Tab; blur covers focus loss while visible.
        if (document.visibilityState === 'hidden') return;
        maybeAutoPauseOnAway();
    }

    function onWindowFocus() {
        maybeAutoResumeOnReturn();
    }

    function installAutoPauseOnBlur() {
        if (autoPauseInstalled) return;
        autoPauseInstalled = true;
        document.addEventListener('visibilitychange', onDocumentVisibilityChange);
        window.addEventListener('blur', onWindowBlur);
        window.addEventListener('focus', onWindowFocus);
    }
