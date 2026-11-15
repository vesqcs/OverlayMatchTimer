/* Hide overlay when the video surface is not meaningfully visible
       (InPlay Review curtain/drawer, collapsed/offscreen player, etc.).
       Layout/observer only — does not read or change video time / PDT. */
    const OMT_VIDEO_VIS_MIN_PX = 24;

    function omtVideoSurfaceVisible(videoEl) {
        if (!videoEl || !videoEl.isConnected) return false;
        try {
            const cs = getComputedStyle(videoEl);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
                return false;
            }
        } catch (_) {}
        const r = videoEl.getBoundingClientRect();
        if (!(r.width >= OMT_VIDEO_VIS_MIN_PX && r.height >= OMT_VIDEO_VIS_MIN_PX)) return false;
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (vw <= 0 || vh <= 0) return false;
        const intersects = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
        if (!intersects) return false;

        // Soft cover check: if the centre pixel is neither the video, its
        // player container, nor our overlay, treat as covered (drawer/list).
        try {
            const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
            const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
            const topEl = document.elementFromPoint(cx, cy);
            if (topEl) {
                if (topEl === videoEl || videoEl.contains(topEl)) return true;
                if (omtRoot && (omtRoot === topEl || omtRoot.contains(topEl))) return true;
                const anchor = (typeof site !== 'undefined' && site && typeof site.findAnchor === 'function')
                    ? site.findAnchor(videoEl)
                    : (videoEl.parentElement);
                if (anchor && (anchor === topEl || anchor.contains(topEl))) return true;
                // Something else is painted at the video centre.
                return false;
            }
        } catch (_) {}
        return true;
    }

    function omtApplyVideoSurfaceVisibility() {
        if (!omtRoot) return;
        const visible = omtVideoSurfaceVisible(vid);
        omtRoot.classList.toggle('omt-video-obscured', !visible);
        omtRoot.setAttribute('data-omt-video-visible', visible ? '1' : '0');
    }

    function installVideoVisibilityGuard() {
        if (!vid || !omtRoot) return;
        if (omtRoot.dataset.omtVisGuard === '1') {
            omtApplyVideoSurfaceVisibility();
            return;
        }
        omtRoot.dataset.omtVisGuard = '1';

        const apply = () => {
            try { omtApplyVideoSurfaceVisibility(); } catch (_) {}
        };

        if (typeof IntersectionObserver === 'function') {
            try {
                const io = new IntersectionObserver(() => apply(), {
                    threshold: [0, 0.01, 0.05, 0.1, 0.25, 0.5, 1]
                });
                io.observe(vid);
                const anchor = omtRoot.parentElement;
                if (anchor && anchor !== vid) io.observe(anchor);
            } catch (_) {}
        }
        if (typeof ResizeObserver === 'function') {
            try {
                const ro = new ResizeObserver(() => apply());
                ro.observe(vid);
                if (omtRoot.parentElement) ro.observe(omtRoot.parentElement);
            } catch (_) {}
        }
        window.addEventListener('scroll', apply, true);
        window.addEventListener('resize', apply);
        document.addEventListener('fullscreenchange', apply);
        apply();
    }
