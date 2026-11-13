/* Local player page (chrome-extension://…/player.html) — file / NAS mapped drive. */
    const SITE_LOCAL = {
        id: 'local',
        rootClass: 'omt-local',

        findVideo() {
            return document.getElementById('omt-local-video') ||
                document.querySelector('#omt-local-stage video') ||
                document.querySelector('video');
        },

        findAnchor(videoEl) {
            return document.getElementById('omt-local-stage') ||
                videoEl.parentElement ||
                document.body;
        },

        findFullscreenTarget(videoEl) {
            return document.getElementById('omt-local-stage') ||
                videoEl.parentElement ||
                videoEl;
        },

        isReviewStream() { return true; },
        isLiveStream() { return false; },

        suppressHostControls() {
            // Standalone page — no host chrome to hide.
        },

        mediaReady(videoEl) {
            // Allow auto-hide / activity even before a file is chosen so the
            // empty-state drop zone + HUD stay interactive.
            return !!videoEl;
        },

        effectiveDuration(videoEl) {
            if (!videoEl) return NaN;
            if (videoEl.duration && isFinite(videoEl.duration)) return videoEl.duration;
            try {
                if (videoEl.seekable && videoEl.seekable.length > 0) {
                    return videoEl.seekable.end(videoEl.seekable.length - 1);
                }
            } catch (_) {}
            return NaN;
        }
    };
