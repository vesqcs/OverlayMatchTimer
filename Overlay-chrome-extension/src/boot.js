/* Boot lifecycle: wait for <video>, init, SPA remount monitor. */
    /* =========================================================
       1. BOOT — WAIT FOR VIDEO ELEMENT
       ========================================================= */
    function teardown() {
        // Stop the SPA monitor before re-init to avoid double-starts
        if (spaMonitorInterval) {
            clearInterval(spaMonitorInterval);
            spaMonitorInterval = null;
        }
        if (bootObserver) {
            bootObserver.disconnect();
            bootObserver = null;
        }
        // Stop any running timers
        if (mouseMoveTimeout) {
            clearTimeout(mouseMoveTimeout);
            mouseMoveTimeout = null;
        }
        if (osdTimeout) {
            clearTimeout(osdTimeout);
            osdTimeout = null;
        }
        // Clean up ShuttleXpress
        cleanupShuttle();
        if (navigator.hid) {
            try {
                navigator.hid.removeEventListener('disconnect', handleHidDisconnect);
            } catch (e) {}
        }
        // Disconnect the controls-attribute observer (started in suppressNativeControls)
        if (controlsObserver) {
            controlsObserver.disconnect();
            controlsObserver = null;
        }
        if (nativeChromeObserver) {
            nativeChromeObserver.disconnect();
            nativeChromeObserver = null;
        }
        if (examinoSettingsRefreshTimer) {
            clearTimeout(examinoSettingsRefreshTimer);
            examinoSettingsRefreshTimer = null;
        }
        // Detach all per-video listeners so a replaced MediaSource/video cannot
        // keep seeking/playing the new element (VOD→DVR freeze root cause).
        if (vidAbortController) {
            try { vidAbortController.abort(); } catch (_) {}
            vidAbortController = null;
        }
        // InplayIP: remove document capture listener. Examino keeps a persistent
        // window capture listener installed at document_start.
        if (site.id !== 'examino') {
            document.removeEventListener('keydown', handleKeydown, true);
        }
        // Remove the injected HUD from the DOM
        const existingRoot = document.getElementById('omt-root');
        if (existingRoot && existingRoot.parentNode) {
            existingRoot.parentNode.removeChild(existingRoot);
        }
        // Clear element references
        omtRoot = null;
        vid = null;
        hlsInstance = null;
        timerUI = null;
        osd = null;
        setupPanel = null;
        controlsPanel = null;
        shuttleToggle = null;
        shuttleCheatsheet = null;
        liveBtn = null;
        btnMainPlay = null;
        timelineSlider = null;
        vTimeCurrent = null;
        vTimeDuration = null;
        speedSelect = null;
        volumeRange = null;
        volumeIconBtn = null;

        // --- TOTAL LIFECYCLE RESET (Bug 1 fix) ---
        // Every SPA navigation must begin with a completely clean slate so that
        // going Live -> Review (or any other transition) re-evaluates everything
        // from scratch without stale flags blocking re-injection.
        isManuallyHidden = false;
        isDraggingTimeline = false;
        isEditingTimer = false;
        userIntendedTime = null;
        seekLockUntil = 0;
        timerAtivo = false;
        offsetEmSegundos = 0;
        tempoBase = 0;
        if (typeof omtResetClockClickEditFlag === 'function') omtResetClockClickEditFlag();
    }

    /* =========================================================
       1A. STREAM MODE DETECTION — delegated to site adapter
       =========================================================
       InplayIP: Review vs Live via VJS control-bar / text badges
       (byte-equivalent to the known-good baseline).
       Examino: /play/dvr/ is always treated as Review/DVR.
    */
    function isReviewStream() { return site.isReviewStream(); }
    function isLiveStream() { return site.isLiveStream(); }

    /* =========================================================
       1B. BOOT — OBSERVE FOR PLAYER, THEN ROUTE BY MODE
       =========================================================
       boot() is the single entry point for all (re-)initializations.
       InplayIP waits for the VJS control bar before deciding mode.
       Examino waits for a (possibly late / replaced) <video> via
       MutationObserver — OpenPlayer mounts after document_idle.
    */
    function boot() {
        if (bootObserver) {
            bootObserver.disconnect();
            bootObserver = null;
        }

        // --- Immediate check: player may already be in the DOM ---
        if (isReviewStream()) {
            const v = findVideo();
            if (v) { init(v); return; }
            // Review/DVR signal present (or Examino always-DVR) but <video> not
            // mounted yet — fall through to the MutationObserver below.
        } else if (site.id === 'inplayip' && isLiveStream()) {
            console.log('[OMT] Live stream — extension inactive. Watching for next session.');
            startSPAMonitor();
            return;
        }

        // --- Player / video not ready yet: observe DOM mutations ---
        bootObserver = new MutationObserver(() => {
            if (site.id === 'inplayip') {
                if (isReviewStream()) {
                    const v = findVideo();
                    if (!v) return; // Video element itself not yet attached — keep watching.
                    bootObserver.disconnect();
                    bootObserver = null;
                    init(v);
                    return;
                }
                if (isLiveStream()) {
                    bootObserver.disconnect();
                    bootObserver = null;
                    console.log('[OMT] Live stream — extension inactive. Watching for next session.');
                    startSPAMonitor();
                }
                return;
            }

            // Examino (and other always-DVR adapters): any video is enough.
            const v = findVideo();
            if (!v) return;
            bootObserver.disconnect();
            bootObserver = null;
            init(v);
        });
        bootObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function findVideo() {
        return site.findVideo();
    }

    /* =========================================================
       1C. SPA MONITOR — DETECT VIDEO REMOVAL / STREAM SWITCH
       =========================================================
       Runs every 1500 ms once a session (Live or Review) is active.
       Detects three events and responds to each with teardown()+boot():

         • Video element removed  → user exited the player back to schedule.
         • Video present, HUD gone → stream was swapped (Review→Live or vice versa).
         • Video element replaced  → a new player instance was mounted.

       In all cases teardown() wipes all state, and boot() starts fresh
       observation so the next session is correctly detected and handled.
    */
    function startSPAMonitor() {
        if (spaMonitorInterval) return; // Already running — do not double-start.
        spaMonitorInterval = setInterval(() => {
            const currentVid = findVideo();
            const currentRoot = document.getElementById('omt-root');

            if (!currentVid) {
                // Video element gone — player was closed. Clean up and go back
                // to watching state so the next session triggers correctly.
                teardown();
                boot();
                return;
            }

            if (currentVid && !currentRoot) {
                // A new stream loaded but our HUD is missing — stream was swapped.
                // Full teardown, then re-evaluate mode from scratch.
                teardown();
                boot();
                return;
            }

            if (currentVid && currentVid !== vid) {
                // The video element itself was replaced by a new one.
                teardown();
                boot();
            }
        }, 1500);
    }

    function init(videoEl) {
        vid = videoEl;
        vid.preservesPitch = true;

        // Inject synchronously — control-bar detection already confirmed
        // this is a Review/DVR session with a seekable timeline.
        hlsInstance = getHlsInstance();
        patchHlsForDvr();
        suppressNativeControls();
        injectUI();
        cacheUIRefs();
        if (typeof omtApplyCustomizeFromStorage === 'function') omtApplyCustomizeFromStorage();
        wireEvents();
        restoreState();
        if (typeof omtApplyClockAppearance === 'function') omtApplyClockAppearance();
        startSPAMonitor();
        initShuttleXpress();
        if (site.id === 'examino') {
            initExaminoPlayerFeatures();
        }
        if (site.id === 'local') {
            installLocalPlayerFeatures();
        }
        console.log('[OMT] Overlay MatchTimer active — ' + (site.id === 'local' ? 'local player' : 'Review/DVR') + ' mode.');
    }
