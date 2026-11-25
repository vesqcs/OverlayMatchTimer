/* Content-script entry: early Examino / Xeatre hooks, then boot. */
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

    if (site.id === 'xeatre') {
        try { document.documentElement.classList.add('omt-host-xeatre'); } catch (_) {}
        if (typeof injectXeatreHideCSS === 'function') injectXeatreHideCSS();
        if (document.documentElement) {
            if (typeof startXeatreNativeChromeObserver === 'function') startXeatreNativeChromeObserver();
            if (typeof hideXeatreNativeChrome === 'function') hideXeatreNativeChrome();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
