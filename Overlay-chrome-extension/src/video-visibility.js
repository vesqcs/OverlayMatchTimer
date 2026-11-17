/* Hide overlay when the video surface is not meaningfully visible
       (InPlay Review curtain / collapsed player). Layout only — does not
       read or change video time / PDT.

       v2.0.2:
       - No elementFromPoint (forced layout + false hides).
       - No ResizeObserver on the video (toggling #omt-root display was
         feeding RO → apply → layout → RO storms on InPlay).
       - Size hysteresis so curtain animations do not flap hud-on.
       - Debounced IntersectionObserver + window resize/fullscreen only.
       - When obscured, clear html.omt-hud-on so host chrome can show. */
    const OMT_VIDEO_VIS_SHOW_MIN_PX = 24;
    const OMT_VIDEO_VIS_HIDE_MAX_PX = 12;
    const OMT_VIDEO_VIS_DEBOUNCE_MS = 150;

    let omtVisApplyTimer = null;
    let omtVisLastVisible = null;
    let omtVisIntersectionObserver = null;
    let omtVisListenersBound = false;
    // Test/diagnostics counters (idle pages should stay tiny).
    let omtVisSchedules = 0;
    let omtVisApplies = 0;
    let omtVisDomWrites = 0;

    function omtVideoVisibilityStats() {
        return {
            schedules: omtVisSchedules,
            applies: omtVisApplies,
            domWrites: omtVisDomWrites,
            lastVisible: omtVisLastVisible
        };
    }

    function omtSetHudActive(active) {
        try {
            const on = !!active;
            if (document.documentElement.classList.contains('omt-hud-on') === on &&
                (!document.body || document.body.classList.contains('omt-hud-on') === on)) {
                return;
            }
            document.documentElement.classList.toggle('omt-hud-on', on);
            if (document.body) document.body.classList.toggle('omt-hud-on', on);
            omtVisDomWrites += 1;
        } catch (_) {}
    }

    function omtVideoSurfaceVisible(videoEl) {
        if (!videoEl || !videoEl.isConnected) return false;
        // Fullscreen owns the screen. IntersectionObserver often mis-reads the
        // FS element (0 intersection vs layout viewport), which hid our HUD /
        // flipped hud-on and left Chrome treating the media as background —
        // local player: skip-forward freezes until exit fullscreen. Always
        // treat FS that contains the video as visible.
        try {
            const fs = document.fullscreenElement;
            if (fs && (fs === videoEl || fs.contains(videoEl))) return true;
        } catch (_) {}
        try {
            const cs = getComputedStyle(videoEl);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
                return false;
            }
        } catch (_) {}
        const r = videoEl.getBoundingClientRect();
        const minSide = Math.min(r.width, r.height);
        // Hysteresis: once hidden, need SHOW_MIN to become visible; once
        // visible, only hide below HIDE_MAX (avoids curtain-animation flaps).
        const need = (omtVisLastVisible === true) ? OMT_VIDEO_VIS_HIDE_MAX_PX : OMT_VIDEO_VIS_SHOW_MIN_PX;
        if (!(minSide >= need)) return false;
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (vw <= 0 || vh <= 0) return false;
        return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    }

    function omtApplyVideoSurfaceVisibility() {
        omtVisApplies += 1;
        if (!omtRoot) {
            omtSetHudActive(false);
            return;
        }
        const visible = omtVideoSurfaceVisible(vid);
        if (omtVisLastVisible === visible) {
            return;
        }
        omtVisLastVisible = visible;
        omtVisDomWrites += 1;
        omtRoot.classList.toggle('omt-video-obscured', !visible);
        omtRoot.setAttribute('data-omt-video-visible', visible ? '1' : '0');
        omtSetHudActive(visible);
    }

    function omtScheduleVideoSurfaceVisibility() {
        omtVisSchedules += 1;
        if (omtVisApplyTimer) return;
        omtVisApplyTimer = setTimeout(() => {
            omtVisApplyTimer = null;
            try { omtApplyVideoSurfaceVisibility(); } catch (_) {}
        }, OMT_VIDEO_VIS_DEBOUNCE_MS);
    }

    function teardownVideoVisibilityGuard() {
        if (omtVisApplyTimer) {
            clearTimeout(omtVisApplyTimer);
            omtVisApplyTimer = null;
        }
        if (omtVisIntersectionObserver) {
            try { omtVisIntersectionObserver.disconnect(); } catch (_) {}
            omtVisIntersectionObserver = null;
        }
        if (omtVisListenersBound) {
            window.removeEventListener('scroll', omtScheduleVideoSurfaceVisibility);
            window.removeEventListener('resize', omtScheduleVideoSurfaceVisibility);
            document.removeEventListener('fullscreenchange', omtScheduleVideoSurfaceVisibility);
            omtVisListenersBound = false;
        }
        omtVisLastVisible = null;
        omtSetHudActive(false);
    }

    function installVideoVisibilityGuard() {
        if (!vid || !omtRoot) return;
        if (omtRoot.dataset.omtVisGuard === '1') {
            omtApplyVideoSurfaceVisibility();
            return;
        }
        omtRoot.dataset.omtVisGuard = '1';
        omtVisSchedules = 0;
        omtVisApplies = 0;
        omtVisDomWrites = 0;

        // IntersectionObserver only — do NOT ResizeObserver(vid): showing/hiding
        // #omt-root inside the player changes layout and re-enters RO forever.
        if (typeof IntersectionObserver === 'function') {
            try {
                omtVisIntersectionObserver = new IntersectionObserver(
                    () => omtScheduleVideoSurfaceVisibility(),
                    { threshold: [0, 1] }
                );
                omtVisIntersectionObserver.observe(vid);
            } catch (_) {
                omtVisIntersectionObserver = null;
            }
        }
        if (!omtVisListenersBound) {
            // Bubble scroll only (not capture) — InPlay curtains scroll often;
            // capture+every scroll was scheduling visibility work constantly.
            window.addEventListener('scroll', omtScheduleVideoSurfaceVisibility, { passive: true });
            window.addEventListener('resize', omtScheduleVideoSurfaceVisibility, { passive: true });
            document.addEventListener('fullscreenchange', omtScheduleVideoSurfaceVisibility);
            omtVisListenersBound = true;
        }
        // Expose counters for e2e (MAIN world).
        try { window.__omtVideoVisibilityStats = omtVideoVisibilityStats; } catch (_) {}
        omtApplyVideoSurfaceVisibility();
    }
