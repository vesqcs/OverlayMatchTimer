/* Xeatre (Stats Perform Global Media Manager DVR popup) site adapter.
 * Player: Video.js 7.7.4 + videojs-http-streaming over Wowza nDVR HLS.
 * Host-only hide/CSS lives in xeatre-features.js — do not touch Examino/InPlay.
 * v2.2.5: never call videojs(); never reparent <video>; HUD mounts outside the
 * VJS player tree so host MutationObservers cannot re-init "hdmi-video".
 * v2.2.9: never mount HUD under #ControlBar (may wrap the player); never
 * attribute-mutate the tech/shell (host re-calls videojs → already initialised).
 */
    const SITE_XEATRE = {
        id: 'xeatre',
        rootClass: 'omt-xeatre',

        findVideo() {
            // Field player id is "hdmi-video" (VJS shell or the tech itself).
            const byId = document.getElementById('hdmi-video');
            if (byId) {
                if (byId.tagName === 'VIDEO') return byId;
                const inner = byId.querySelector('video.vjs-tech, video');
                if (inner) return inner;
            }
            const tech = document.querySelector('.video-js video.vjs-tech, .video-js video, video.vjs-tech');
            if (tech && tech.tagName === 'VIDEO') return tech;
            const any = document.querySelector('video');
            return any || null;
        },

        findAnchor(videoEl) {
            // Prefer a parent WRAPPER of the Video.js shell so #omt-root is a
            // sibling of the player — not a child. Appending into #hdmi-video /
            // .video-js mutates the player tree and can make the host call
            // videojs('hdmi-video') again ("already initialised" → black).
            const shell = videoEl.closest('.video-js') ||
                videoEl.closest('#hdmi-video') ||
                videoEl.closest('.vjs-player') ||
                videoEl.closest('#video-player');
            let anchor = shell && shell.parentElement;
            // Field: #ControlBar may WRAP #hdmi-video. Never mount under a
            // chrome wrapper we hide — HUD would go display:none with the video.
            while (anchor && (
                anchor.id === 'ControlBar' ||
                (anchor.classList && (
                    anchor.classList.contains('vjs-control-bar') ||
                    (anchor.classList.contains('overlay-fullscreen') && anchor.id === 'ControlBar') ||
                    (anchor.classList.contains('overlay-normal') && anchor.id === 'ControlBar')
                ))
            )) {
                anchor = anchor.parentElement;
            }
            if (anchor && anchor !== document.body && anchor !== document.documentElement) {
                return anchor;
            }
            return shell || videoEl.parentElement;
        },

        findFullscreenTarget(videoEl) {
            return videoEl.closest('.video-js') ||
                videoEl.closest('#hdmi-video') ||
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
            // v2.2.9: do NOT set tabindex / attributes on tech or shell — host
            // MutationObservers may re-call videojs('hdmi-video') ("already initialised").
            // Never call videojs(); never reparent <video>.
            if (typeof omtDebugXeatre === 'function') {
                omtDebugXeatre('suppressHostControls', {
                    videoId: videoEl && videoEl.id || null,
                    paint: typeof describeXeatreVideoPaint === 'function' ? describeXeatreVideoPaint() : null
                });
            }
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
