/* Alt+Tab / tab-hidden playback (all sites: Examino, InPlay, Xeatre, local).
 *
 * v2.2.14 setting "Não pausar no alt tab" (omtKeepPlayingOnAltTab, default OFF):
 *   OFF (default): pause on blur/hidden if playing; resume on return only if we
 *                  paused (autoPausedByBlur). User pause is never auto-resumed.
 *   ON: keep playing while hidden — if the host pauses on away, play() once on
 *       the next microtask. Armed only between away and return / user pause.
 *
 * Cost: one-time visibilitychange/blur/focus listeners. No intervals, no
 * timeouts, no observers. One-shot pause()/play() only on those events.
 */
    let autoPauseInstalled = false;
    let autoPausedByBlur = false;
    let autoPauseInProgress = false;
    let autoResumeInProgress = false;
    let lastShuttleActivityAt = 0;
    // Keep-playing arm (setting ON): set on away while playing; cleared on
    // return or user intent. No wall-clock window / timers.
    let keepPlayingArmed = false;
    let keepPlayingInFlight = false;

    function noteShuttleActivity() {
        lastShuttleActivityAt = Date.now();
    }

    function clearKeepPlayingArm() {
        keepPlayingArmed = false;
    }

    /** Used by togglePlay — user intent cancels keep-playing and blur-resume. */
    function clearExaminoHostResumeIntent() {
        clearKeepPlayingArm();
    }

    function clearAutoPauseFlag() {
        if (autoPauseInProgress || autoResumeInProgress) return;
        autoPausedByBlur = false;
        if (!keepPlayingInFlight) clearKeepPlayingArm();
    }

    function storageKeepPlayingOnAltTab() {
        if (typeof storageGetKeepPlayingOnAltTab === 'function') {
            return !!storageGetKeepPlayingOnAltTab();
        }
        // Legacy fallback during partial loads: old key meant "pause on blur".
        if (typeof storageGetAutoPauseOnBlur === 'function') {
            return !storageGetAutoPauseOnBlur();
        }
        return false;
    }

    function shouldSkipAwayPause() {
        if (storageKeepPlayingOnAltTab()) return true;
        if (typeof storageGetShuttleEnabled === 'function' && storageGetShuttleEnabled()) {
            return true;
        }
        if (Date.now() - lastShuttleActivityAt < 1000) return true;
        return false;
    }

    /** Capture on away: arm keep-playing if setting ON and media is playing. */
    function onAwayCapture() {
        if (!storageKeepPlayingOnAltTab()) {
            clearKeepPlayingArm();
            return;
        }
        if (!vid || !vid.isConnected) return;
        if (vid.paused || vid.ended) return;
        keepPlayingArmed = true;
    }

    /**
     * Video 'pause' while keep-playing is armed → host hid the tab.
     * Re-play on next microtask (event-driven, not a timer poll).
     */
    function onMaybeKeepPlaying() {
        if (!storageKeepPlayingOnAltTab()) return;
        if (autoPauseInProgress) return;
        if (!keepPlayingArmed) return;
        if (!vid || !vid.isConnected || vid.ended) {
            clearKeepPlayingArm();
            return;
        }
        if (!vid.paused) return;
        const media = vid;
        keepPlayingInFlight = true;
        const resume = () => {
            keepPlayingInFlight = false;
            if (!storageKeepPlayingOnAltTab() || !keepPlayingArmed) return;
            if (!media.isConnected || media.ended || !media.paused) return;
            try {
                const p = media.play();
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        if (typeof syncPlayButtonFromVideo === 'function') syncPlayButtonFromVideo();
                    }).catch((err) => {
                        try {
                            console.warn('[OMT] Keep-playing while hidden: play() rejected',
                                err && (err.name || err.message) || err);
                        } catch (_) {}
                    });
                    return;
                }
            } catch (err) {
                try {
                    console.warn('[OMT] Keep-playing while hidden: play() threw',
                        err && (err.name || err.message) || err);
                } catch (_) {}
            }
            if (typeof syncPlayButtonFromVideo === 'function') syncPlayButtonFromVideo();
        };
        try {
            queueMicrotask(resume);
        } catch (_) {
            // queueMicrotask unavailable — same-tick fallback (still not a timer).
            resume();
        }
    }

    function maybeAutoPauseOnAway() {
        if (shouldSkipAwayPause()) return;
        if (!ensureLiveVideo()) return;
        if (vid.paused || vid.ended) return;
        autoPauseInProgress = true;
        try {
            vid.pause();
            if (vid.paused) {
                autoPausedByBlur = true;
                if (typeof mostrarOSD === 'function') mostrarOSD('Auto paused');
            }
        } finally {
            autoPauseInProgress = false;
        }
        if (typeof syncPlayButtonFromVideo === 'function') syncPlayButtonFromVideo();
    }

    function maybeAutoResumeOnReturn() {
        clearKeepPlayingArm();
        if (!autoPausedByBlur) return;
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
                if (typeof syncPlayButtonFromVideo === 'function') syncPlayButtonFromVideo();
            });
    }

    function onDocumentVisibilityChangeCapture() {
        if (document.visibilityState === 'hidden') onAwayCapture();
    }

    function onWindowBlurCapture() {
        onAwayCapture();
    }

    function onDocumentVisibilityChange() {
        if (document.visibilityState === 'hidden') maybeAutoPauseOnAway();
        else if (document.visibilityState === 'visible') {
            maybeAutoResumeOnReturn();
            if (typeof wakeFullscreenDecode === 'function') wakeFullscreenDecode();
        }
    }

    function onWindowBlur() {
        if (document.visibilityState === 'hidden') return;
        maybeAutoPauseOnAway();
    }

    function onWindowFocus() {
        maybeAutoResumeOnReturn();
        if (typeof wakeFullscreenDecode === 'function') wakeFullscreenDecode();
    }

    function installAutoPauseOnBlur() {
        if (autoPauseInstalled) return;
        autoPauseInstalled = true;
        document.addEventListener('visibilitychange', onDocumentVisibilityChangeCapture, true);
        window.addEventListener('blur', onWindowBlurCapture, true);
        document.addEventListener('visibilitychange', onDocumentVisibilityChange);
        window.addEventListener('blur', onWindowBlur);
        window.addEventListener('focus', onWindowFocus);
    }
