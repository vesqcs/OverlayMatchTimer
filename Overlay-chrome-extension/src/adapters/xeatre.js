/* Xeatre (Stats Perform Global Media Manager DVR popup) site adapter.
 * Player: Video.js 7.7.4 + videojs-http-streaming over Wowza nDVR HLS.
 * Host-only hide/CSS lives in xeatre-features.js — do not touch Examino/InPlay.
 */
    const SITE_XEATRE = {
        id: 'xeatre',
        rootClass: 'omt-xeatre',

        findVideo() {
            const tech = document.querySelector('.video-js video.vjs-tech, .video-js video, video.vjs-tech');
            if (tech && tech.tagName === 'VIDEO') return tech;
            const any = document.querySelector('video');
            return any || null;
        },

        findAnchor(videoEl) {
            // Prefer the Video.js shell (same idea as InPlay). Never use a node
            // we hide — .vjs-control-bar is a sibling of the tech, not the shell.
            return videoEl.closest('.video-js') ||
                videoEl.closest('.vjs-player') ||
                videoEl.closest('#video-player') ||
                videoEl.closest('.player-container') ||
                videoEl.parentElement;
        },

        findFullscreenTarget(videoEl) {
            return videoEl.closest('.video-js') ||
                videoEl.closest('#video-player') ||
                videoEl.parentElement ||
                videoEl;
        },

        // Xeatre DVR popup is always the review/DVR surface (live=true Wowza window).
        isReviewStream() { return true; },
        isLiveStream() { return false; },

        suppressHostControls(videoEl) {
            if (typeof injectXeatreHideCSS === 'function') injectXeatreHideCSS();
            if (typeof hideXeatreNativeChrome === 'function') hideXeatreNativeChrome();
            if (typeof startXeatreNativeChromeObserver === 'function') startXeatreNativeChromeObserver();
            // Soften VJS keyboard capture so our capture-phase hotkeys win; CSS hides chrome.
            try {
                document.querySelectorAll('.video-js, .vjs-tech').forEach((el) => {
                    if (el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return;
                    try { el.setAttribute('tabindex', '-1'); } catch (_) {}
                });
            } catch (_) {}
        },

        // Wowza DVR / VHS often reports Infinity duration; seekable end is enough.
        mediaReady(videoEl) {
            if (!videoEl) return false;
            if (videoEl.duration && isFinite(videoEl.duration)) return true;
            try {
                return !!(videoEl.seekable && videoEl.seekable.length > 0);
            } catch (_) {
                return false;
            }
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
