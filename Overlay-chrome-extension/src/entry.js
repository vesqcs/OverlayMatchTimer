/* Content-script entry: early Examino hooks, then boot. */
    /* =========================================================
       ENTRY POINT
       ========================================================= */
    if (site.id === 'examino') {
        installExaminoHotkeys();
        injectExaminoHideCSS();
        // Hide chrome as soon as nodes appear, even before <video>.
        if (document.documentElement) {
            startExaminoNativeChromeObserver();
            hideExaminoNativeChrome();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
