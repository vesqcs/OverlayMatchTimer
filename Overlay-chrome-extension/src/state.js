/* Shared mutable state for the Overlay MatchTimer content script.
 * Fragments are concatenated into one IIFE — do not use import/export here.
 */
    // MAIN-world scripts share the page realm but each inject is a new IIFE.
    // A second inject (dev reload, duplicate registration) would double every
    // listener — abort before touching the DOM.
    if (window.__OMT_MAIN_LOADED__) {
        console.warn('[OMT] MAIN content script already loaded — skipping duplicate.');
        return;
    }
    window.__OMT_MAIN_LOADED__ = true;

    // SPA monitor interval handle
    let spaMonitorInterval = null;
    let bootObserver = null;
    let fullscreenHooked = false;
    let nativeChromeObserver = null;
    let examinoHotkeysInstalled = false;
    let examinoSettingsRefreshTimer = null;
    let examinoClickToggleInstalled = false;
    let examinoClickArmed = false;
    let examinoSuppressClickToggle = 0; // >0 while we drive OpenPlayer menus via .click()
    let examinoAutoVodWatcher = null;
    let examinoAutoVodInFlight = false;
    let examinoAutoVodDone = false;
    let vidAbortController = null;
    let pointerOverOmtUi = false;
    // Session override: once the user picks DVR manually, auto-VOD stops for this page.
    let examinoManualSourceChoice = null;
    let examinoPendingDvrSettle = false;

    /* =========================================================
       MODULE STATE
       ========================================================= */
    let vid = null;           // The <video> element on the page
    let omtRoot = null;       // Our injected container div
    let hlsInstance = null;   // The hls.js / VHS instance (if found)

    // Timer state
    let offsetEmSegundos = 0;
    let tempoBase = 0;
    let timerAtivo = false;
    let osdTimeout = null;
    let isDraggingTimeline = false;
    let isManuallyHidden = false;
    let mouseMoveTimeout = null;
    // Set when Auto pause on Alt+Tab pauses playback; cleared on manual play/pause/seek.
    let controlsObserver = null; // MutationObserver watching the video 'controls' attribute
    let isEditingTimer = false;
    const isLocalVideo = false; // Extension always targets a live/DVR stream

    // Kickoff markers (persisted in localStorage)
    let kickoff1 = localStorage.getItem('matchTimerKickoff1') !== null ? parseFloat(localStorage.getItem('matchTimerKickoff1')) : null;
    let kickoff2 = localStorage.getItem('matchTimerKickoff2') !== null ? parseFloat(localStorage.getItem('matchTimerKickoff2')) : null;
    let kickoffC1 = localStorage.getItem('matchTimerKickoffC1') !== null ? parseFloat(localStorage.getItem('matchTimerKickoffC1')) : null;
    let kickoffC2 = localStorage.getItem('matchTimerKickoffC2') !== null ? parseFloat(localStorage.getItem('matchTimerKickoffC2')) : null;
    let previousHalf = localStorage.getItem('matchTimerHalf') || '1';

    // Anti-live-snap: track where the user *intended* to be
    let userIntendedTime = null;
    let seekLockUntil = 0; // epoch ms until which we protect the seek position

    // Volume
    let ultimoVolume = 1;

    // Cached UI element refs (populated after injection)
    let timerUI, osd, setupPanel, controlsPanel, timelineSlider,
        vTimeCurrent, vTimeDuration, liveBtn, btnMainPlay, btnTimelinePlay, speedSelect,
        volumeRange, volumeIconBtn, timelineVolRange, timelineVolBtn,
        shuttleToggle, shuttleCheatsheet;
    // Timeline live delay / LIVE chip (hysteresis latch)
    let omtTimelineLiveChipOn = false;
    // Tunable base (v2.2.0): LIVE counts-as-live / chip-enter threshold, and
    // the floor for LIVE jumps after a recent stall. Adaptive jump margin may
    // go closer on stable streams or further when the edge is slow.
    const OMT_LIVE_SAFE_MARGIN_S = 10;
    const OMT_LIVE_SAFE_MARGIN_MIN_S = 4;   // closest LIVE jump on a healthy stream
    const OMT_LIVE_SAFE_MARGIN_MAX_S = 30;  // farthest LIVE jump on a bad stream
    const OMT_LIVE_STALL_MEMORY_MS = 45000; // "stalled recently" window
    // Extra slack so landing on the adaptive safe point still counts as LIVE
    // (float + edge tick during seek). Panel button + timeline chip share this.
    const OMT_LIVE_AT_LIVE_TOL_S = 1.5;
    // v2.2.6: pin the margin used by the last LIVE jump so at-live / red button /
    // bar chip stay in lockstep with the safe point we actually landed on
    // (adaptive margin must not shrink under our feet after the click).
    let omtLivePinnedMarginSec = 0;
    let omtLiveForceAtLiveUntil = 0;
    // Legacy fixed chip thresholds (kept as fallbacks; paint uses adaptive).
    const OMT_LIVE_CHIP_ENTER_S = OMT_LIVE_SAFE_MARGIN_S;
    const OMT_LIVE_CHIP_LEAVE_S = OMT_LIVE_SAFE_MARGIN_S + 5;
    // Edge-advance samples for adaptive LIVE jump (wall-clock ms of each advance).
    let omtLiveEdgeLastSec = null;
    let omtLiveEdgeAdvanceAtMs = [];
    let omtLiveLastStallAtMs = 0;
