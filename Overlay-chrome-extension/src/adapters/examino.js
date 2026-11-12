/* Examino (OpenPlayer DVR/VOD) site adapter.
 * Host-only extras (click-toggle, Source, hide chrome) live in examino-features.js.
 */
    const SITE_EXAMINO = {
        id: 'examino',
        rootClass: 'omt-examino',

        findVideo() {
            const inOp = document.querySelector('.op-media-element-container video, .op-player video');
            if (inOp) return inOp;
            const any = document.querySelector('video');
            return any || null;
        },

        findAnchor(videoEl) {
            // Prefer the OpenPlayer root that typically owns fullscreen, then
            // fall back to the media container / parent.
            return videoEl.closest('.op-player') ||
                videoEl.closest('.video-container') ||
                videoEl.closest('.op-media-element-container') ||
                videoEl.parentElement;
        },

        findFullscreenTarget(videoEl) {
            return videoEl.closest('.op-player') ||
                videoEl.closest('.video-container') ||
                videoEl.closest('.op-media-element-container') ||
                videoEl.parentElement ||
                videoEl;
        },

        // Examino /play/dvr/ pages are already DVR — no Live/Review fork.
        isReviewStream() { return true; },
        isLiveStream() { return false; },

        suppressHostControls(videoEl) {
            injectExaminoHideCSS();
            hideExaminoNativeChrome();
            startExaminoNativeChromeObserver();
            // Soften OpenPlayer keyboard/focus capture so our capture-phase
            // hotkeys win; CSS hides the chrome.
            const root = this.findAnchor(videoEl) || document;
            root.querySelectorAll(
                '.op-controls, .op-ui, .op-progressbar-container, .button-bar, .examino-bottom-controls, video, button, [tabindex]'
            ).forEach(el => {
                if (el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return;
                try { el.setAttribute('tabindex', '-1'); } catch (_) {}
            });
        },

        // OpenPlayer MSE often reports duration=Infinity; seekable end is enough.
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
