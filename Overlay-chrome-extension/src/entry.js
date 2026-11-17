/* Content-script entry: early Examino hooks, then boot. */
    /* =========================================================
       ENTRY POINT
       ========================================================= */
    if (site.id === 'examino') {
        try { document.documentElement.classList.add('omt-host-examino'); } catch (_) {}
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
