/* Xeatre stub — out of scope for injection; URL paste stays in the HTML companion. */
    // Xeatre works differently (URL paste into the HTML app). Out of scope —
    // leave a stub so a future adapter can plug in without another rewrite.
    const SITE_XEATRE = {
        id: 'xeatre',
        rootClass: 'omt-xeatre',
        findVideo() { return null; },
        findAnchor() { return null; },
        findFullscreenTarget() { return null; },
        isReviewStream() { return false; },
        isLiveStream() { return false; },
        suppressHostControls() {},
        mediaReady() { return false; },
        effectiveDuration() { return NaN; },
        // TODO(xeatre): dedicated adapter when Xeatre DVR is reachable again.
        stub: true
    };
