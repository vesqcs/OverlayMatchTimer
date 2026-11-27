/* Tab-hidden playback (all sites: Examino, InPlay, Xeatre, local).
 *
 * v2.2.15 setting "Keep playing on alt tab" (omtKeepPlayingOnAltTab, default OFF):
 *   OFF (default): pause only on document.visibilityState === 'hidden'
 *                  (tab switch / minimize / fully covered). Never on blur/focus —
 *                  a visible but unfocused window (beside the collection app,
 *                  or Shuttle "top" video) must keep playing.
 *                  On visible, resume only if we paused (autoPausedByHide).
 *   ON: never pause on hide. If the host pauses while hidden (Examino),
 *       play() once on the next microtask. Armed only between hide and show.
 *
 * Cost: one-time visibilitychange listeners only. No blur/focus handlers.
 * No intervals, no timeouts, no observers. One-shot pause()/play() on events.
 */
    let autoPauseInstalled = false;
    let autoPausedByHide = false;
    let autoPauseInProgress = false;
    let autoResumeInProgress = false;
    let lastShuttleActivityAt = 0;
    // Keep-playing arm (setting ON): set on hide while playing; cleared on
    // show or user intent. No wall-clock window / timers.
    let keepPlayingArmed = false;
    let keepPlayingInFlight = false;

    // Legacy alias — older call sites / tests may still read this name.
    let autoPausedByBlur = false;

    function noteShuttleActivity() {
        lastShuttleActivityAt = Date.now();
    }

    function clearKeepPlayingArm() {
        keepPlayingArmed = false;
    }

    /** Used by togglePlay — user intent cancels keep-playing and hide-resume. */
    function clearExaminoHostResumeIntent() {
        clearKeepPlayingArm();
    }

    function clearAutoPauseFlag() {
        if (autoPauseInProgress || autoResumeInProgress) return;
        autoPausedByHide = false;
        autoPausedByBlur = false;
        if (!keepPlayingInFlight) clearKeepPlayingArm();
    }

    function storageKeepPlayingOnAltTab() {
        if (typeof storageGetKeepPlayingOnAltTab === 'function') {
            return !!storageGetKeepPlayingOnAltTab();
        }
        if (typeof storageGetAutoPauseOnBlur === 'function') {
            return !storageGetAutoPauseOnBlur();
        }
        return false;
    }

    function shouldSkipHidePause() {
        // Document PiP: opener goes visibilityState=hidden when the pop-out is
        // focused. Pausing would freeze the moved video + match-timer chip.
        try {
            if (typeof omtPipState !== 'undefined' && omtPipState) return true;
        } catch (_) {}
        if (storageKeepPlayingOnAltTab()) return true;
        // v2.4.14: only the instance that actually holds the HID device skips
        // pause — never a persisted/shared "shuttle enabled" flag (that made
        // Xeatre/other tabs keep playing after Alt+Tab).
        if (typeof isShuttleConnected === 'function' && isShuttleConnected()) {
            return true;
        }
        if (Date.now() - lastShuttleActivityAt < 1000) return true;
        return false;
    }

    /** Capture on hide: arm keep-playing if setting ON and media is playing. */
    function onHideCapture() {
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
            resume();
        }
    }

    function maybeAutoPauseOnHide() {
        if (shouldSkipHidePause()) return;
        if (!ensureLiveVideo()) return;
        if (vid.paused || vid.ended) return;
        autoPauseInProgress = true;
        try {
            vid.pause();
            if (vid.paused) {
                autoPausedByHide = true;
                autoPausedByBlur = true; // legacy alias
                if (typeof mostrarOSD === 'function') mostrarOSD('Auto paused');
            }
        } finally {
            autoPauseInProgress = false;
        }
        if (typeof syncPlayButtonFromVideo === 'function') syncPlayButtonFromVideo();
    }

    function maybeAutoResumeOnShow() {
        clearKeepPlayingArm();
        if (!autoPausedByHide) return;
        if (typeof isShuttleConnected === 'function' && isShuttleConnected()) {
            autoPausedByHide = false;
            autoPausedByBlur = false;
            return;
        }
        if (!ensureLiveVideo()) return;
        if (!vid.paused) {
            autoPausedByHide = false;
            autoPausedByBlur = false;
            return;
        }
        autoResumeInProgress = true;
        autoPausedByHide = false;
        autoPausedByBlur = false;
        safePlay(vid)
            .finally(() => {
                autoResumeInProgress = false;
                if (typeof syncPlayButtonFromVideo === 'function') syncPlayButtonFromVideo();
            });
    }

    function onDocumentVisibilityChangeCapture() {
        if (document.visibilityState === 'hidden') onHideCapture();
    }

    function onDocumentVisibilityChange() {
        if (document.visibilityState === 'hidden') maybeAutoPauseOnHide();
        else if (document.visibilityState === 'visible') {
            maybeAutoResumeOnShow();
            if (typeof wakeFullscreenDecode === 'function') wakeFullscreenDecode();
        }
    }

    function installAutoPauseOnBlur() {
        if (autoPauseInstalled) return;
        autoPauseInstalled = true;
        // Visibility only — never blur/focus (visible-but-unfocused must play).
        document.addEventListener('visibilitychange', onDocumentVisibilityChangeCapture, true);
        document.addEventListener('visibilitychange', onDocumentVisibilityChange);
    }
