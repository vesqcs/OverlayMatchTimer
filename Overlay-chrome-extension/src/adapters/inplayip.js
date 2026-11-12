/* InplayIP (Video.js Review/DVR) site adapter */
    /* =========================================================
       SITE ADAPTERS
       Isolate host-specific DOM / mode / fullscreen behaviour so
       InplayIP keeps its proven Review/Live SPA logic while Examino
       uses OpenPlayer-aware wait/anchor/suppress rules.
       ========================================================= */
    const SITE_INPLAYIP = {
        id: 'inplayip',
        rootClass: 'omt-inplayip',

        findVideo() {
            // Prefer the Video.js tech element
            const tech = document.querySelector('.vjs-tech');
            if (tech && tech.tagName === 'VIDEO') return tech;
            const any = document.querySelector('video');
            return any || null;
        },

        findAnchor(videoEl) {
            return videoEl.closest('.video-js') ||
                videoEl.closest('.vjs-player') ||
                videoEl.parentElement;
        },

        findFullscreenTarget(videoEl) {
            return videoEl.closest('.video-js') || videoEl.parentElement || videoEl;
        },

        // Exact Inplay Review/Live signals from the known-good baseline.
        isReviewStream() {
            return !!document.querySelector('.vjs-progress-control');
        },

        isLiveStream() {
            const bodyText = document.body ? document.body.innerText : '';
            if (/\b(hd|sd)\s+live\b/i.test(bodyText)) return true;
            const hasLiveUI = !!document.querySelector('.vjs-live-control, .vjs-live-display');
            const hasProgress = !!document.querySelector('.vjs-progress-control');
            if (hasLiveUI && !hasProgress) return true;
            return false;
        },

        suppressHostControls(videoEl) {
            document.querySelectorAll('.video-js, .vjs-tech').forEach(el => {
                el.setAttribute('tabindex', '-1');
            });
        },

        // MSE DVR on Inplay Review exposes a finite duration — keep baseline gate.
        mediaReady(videoEl) {
            return !!(videoEl && videoEl.duration && isFinite(videoEl.duration));
        },

        effectiveDuration(videoEl) {
            if (videoEl && videoEl.duration && isFinite(videoEl.duration)) return videoEl.duration;
            return NaN;
        }
    };
