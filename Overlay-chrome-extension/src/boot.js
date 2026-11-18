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
        if (typeof clearInplayBootMoTimer === 'function') {
            try { clearInplayBootMoTimer(); } catch (_) {}
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
        if (typeof omtKickoffSyncStop === 'function') omtKickoffSyncStop();
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
        if (typeof stopXeatreNativeChromeObserver === 'function') {
            try { stopXeatreNativeChromeObserver(); } catch (_) {}
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
        omtSetHudMounted(false);
        omtReleaseHudStacking();
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
        omtTimelineLiveChipOn = false;
        omtLiveEdgeLastSec = null;
        omtLiveEdgeAdvanceAtMs = [];
        omtLiveLastStallAtMs = 0;
        btnMainPlay = null;
        btnTimelinePlay = null;
        timelineSlider = null;
        vTimeCurrent = null;
        vTimeDuration = null;
        speedSelect = null;
        volumeRange = null;
        volumeIconBtn = null;
        timelineVolRange = null;
        timelineVolBtn = null;

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

    // InPlay close-X: after video is gone, never attach a document-wide
    // MutationObserver while the host is still tearing down the player tree.
    // Poll quietly until a new Review <video> appears (SPA interval).
    let inplayBootMoTimer = null;
    let inplayQuietUntil = 0;
    try { window.__omtInplayBootMoFires = 0; } catch (_) {}

    function clearInplayBootMoTimer() {
        if (inplayBootMoTimer) {
            clearTimeout(inplayBootMoTimer);
            inplayBootMoTimer = null;
        }
    }

    function startInplayIdleWatch() {
        // Poll-only wait for the next Review session. No MutationObserver.
        console.log('[OMT] InPlay idle watch (no MutationObserver) — waiting for next video.');
        startSPAMonitor();
    }

    function boot() {
        if (bootObserver) {
            bootObserver.disconnect();
            bootObserver = null;
        }
        clearInplayBootMoTimer();

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

        // InPlay: after close-X quiet period, stay on interval polling only.
        if (site.id === 'inplayip' && Date.now() < inplayQuietUntil) {
            startInplayIdleWatch();
            return;
        }

        // --- Player / video not ready yet: observe DOM mutations ---
        // InPlay: debounce heavily. Close-X mutates hundreds of VJS nodes; a
        // sync observer callback per batch used to re-enter mode detection and
        // freeze the tab. Examino keeps the immediate observer (OpenPlayer).
        bootObserver = new MutationObserver(() => {
            if (site.id === 'inplayip') {
                try { window.__omtInplayBootMoFires = (window.__omtInplayBootMoFires || 0) + 1; } catch (_) {}
                if (inplayBootMoTimer) return;
                inplayBootMoTimer = setTimeout(() => {
                    inplayBootMoTimer = null;
                    if (!bootObserver) return;
                    if (Date.now() < inplayQuietUntil) return;
                    if (isReviewStream()) {
                        const v = findVideo();
                        if (!v) return;
                        if (bootObserver) {
                            bootObserver.disconnect();
                            bootObserver = null;
                        }
                        clearInplayBootMoTimer();
                        init(v);
                        return;
                    }
                    if (isLiveStream()) {
                        if (bootObserver) {
                            bootObserver.disconnect();
                            bootObserver = null;
                        }
                        clearInplayBootMoTimer();
                        console.log('[OMT] Live stream — extension inactive. Watching for next session.');
                        startSPAMonitor();
                    }
                }, 250);
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

    /**
     * A replaced <video> must go through teardown/boot so every per-video
     * listener (timeupdate, play/pause, mousemove) moves with it. Assigning
     * `vid = newEl` directly leaves those listeners on the dead element and
     * the SPA monitor then sees `currentVid === vid` and never rebinds.
     */
    function omtAdoptReplacedVideo(el) {
        if (!el || el === vid || !el.isConnected) return vid;
        teardown();
        boot();
        return vid || el;
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
                // Video element gone — player was closed (InPlay close-X / leave).
                if (site.id === 'inplayip') {
                    // Do NOT boot() → document MutationObserver while the host is
                    // still dismantling VJS. Quiet poll until a new video appears.
                    const hadSession = !!(omtRoot || vid || bootObserver);
                    if (hadSession) {
                        teardown();
                        inplayQuietUntil = Date.now() + 4000;
                        startInplayIdleWatch();
                    }
                    return;
                }
                teardown();
                boot();
                return;
            }

            if (currentVid && !currentRoot) {
                // A new stream loaded but our HUD is missing — stream was swapped.
                // Full teardown, then re-evaluate mode from scratch.
                if (site.id === 'inplayip' && Date.now() < inplayQuietUntil) {
                    return; // still in close-X quiet window
                }
                teardown();
                boot();
                return;
            }

            if (currentVid && currentVid !== vid) {
                // The video element itself was replaced by a new one.
                if (site.id === 'inplayip' && Date.now() < inplayQuietUntil) {
                    return;
                }
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
        if (omtRoot) omtSetHudMounted(true);
        cacheUIRefs();
        if (typeof omtApplyCustomizeFromStorage === 'function') omtApplyCustomizeFromStorage();
        wireEvents();
        restoreState();
        if (typeof omtApplyClockAppearance === 'function') omtApplyClockAppearance();
        startSPAMonitor();
        initShuttleXpress();
        if (typeof omtKickoffSyncStart === 'function') omtKickoffSyncStart();
        if (site.id === 'examino') {
            initExaminoPlayerFeatures();
        }
        if (site.id === 'xeatre' && typeof initXeatrePlayerFeatures === 'function') {
            initXeatrePlayerFeatures();
        }
        if (site.id === 'local') {
            installLocalPlayerFeatures();
        }
        console.log('[OMT] Overlay MatchTimer active — ' + (site.id === 'local' ? 'local player' : 'Review/DVR') + ' mode.');
    }
