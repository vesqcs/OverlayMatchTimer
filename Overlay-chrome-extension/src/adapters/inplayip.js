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
            // Prefer the Video.js shell (original). Also accept InPlay's
            // current .player-container wrapper when VJS class is absent.
            return videoEl.closest('.video-js') ||
                videoEl.closest('.vjs-player') ||
                videoEl.closest('.player-container') ||
                videoEl.parentElement;
        },

        findFullscreenTarget(videoEl) {
            return videoEl.closest('.video-js') ||
                videoEl.closest('.player-container') ||
                videoEl.parentElement ||
                videoEl;
        },

        // Exact Inplay Review/Live signals from the known-good baseline.
        isReviewStream() {
            return !!document.querySelector('.vjs-progress-control');
        },

        isLiveStream() {
            // Selectors only — never innerText. Close-X tears down the VJS tree
            // under .players-container; reading innerText there from a boot
            // MutationObserver forced full layout on every mutation and froze
            // Chrome ("page unresponsive") with the extension on (2.1.1 field).
            const hasLiveUI = !!document.querySelector('.vjs-live-control, .vjs-live-display');
            const hasProgress = !!document.querySelector('.vjs-progress-control');
            return !!(hasLiveUI && !hasProgress);
        },

        suppressHostControls(videoEl) {
            // v2.2.13: only soften the player that hosts #omt-root (multi-view
            // tiles must keep native focus/controls). Single-video identical.
            const shell = (typeof omtRoot !== 'undefined' && omtRoot && omtRoot.closest)
                ? omtRoot.closest('.video-js')
                : null;
            const target = shell ||
                (videoEl && videoEl.closest && videoEl.closest('.video-js')) ||
                videoEl;
            if (!target) return;
            try { target.setAttribute('tabindex', '-1'); } catch (_) {}
            try {
                target.querySelectorAll('.vjs-tech, video').forEach((el) => {
                    try { el.setAttribute('tabindex', '-1'); } catch (_) {}
                });
            } catch (_) {}
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
