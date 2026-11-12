/* Shared mutable state for the Overlay MatchTimer content script.
 * Fragments are concatenated into one IIFE — do not use import/export here.
 */
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
        vTimeCurrent, vTimeDuration, liveBtn, btnMainPlay, speedSelect,
        volumeRange, volumeIconBtn, shuttleToggle, shuttleCheatsheet;
