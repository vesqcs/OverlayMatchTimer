/* Wire UI controls to timer / playback / auto-hide / site extras. */
    /* =========================================================
       6. WIRE ALL EVENTS
       ========================================================= */
    function wireEvents() {
        // --- Kick-off / more panel (in-video expandable group) ---
        q('omt-btn-set-kickoff').addEventListener('click', () => { iniciarTimer(); });
        q('omt-btn-clear-timer').addEventListener('click', () => { limparTimer(); });
        q('omt-btn-fullscreen').addEventListener('click', toggleFullScreen);
        const moreToggle = q('omt-more-toggle');
        if (moreToggle) moreToggle.addEventListener('click', () => toggleMorePanel());

        // --- Kick-off offset nudge (same offsetEmSegundos / kickoff state) ---
        const nudge = (sec) => () => nudgeKickoffOffset(sec);
        const nM5 = q('omt-offset-m5');
        const nM1 = q('omt-offset-m1');
        const nP1 = q('omt-offset-p1');
        const nP5 = q('omt-offset-p5');
        if (nM5) nM5.addEventListener('click', nudge(-5));
        if (nM1) nM1.addEventListener('click', nudge(-1));
        if (nP1) nP1.addEventListener('click', nudge(1));
        if (nP5) nP5.addEventListener('click', nudge(5));

        // --- Half selector memory ---
        q('omt-half-select').addEventListener('change', function () {
            const newHalf = this.value;
            const hrVal = q('omt-sync-hr').value;
            const minVal = q('omt-sync-min').value;
            const secVal = q('omt-sync-sec').value;
            if (hrVal !== '' || minVal !== '' || secVal !== '') {
                localStorage.setItem('matchTimerWhistle_' + previousHalf, JSON.stringify({ h: hrVal, m: minVal, s: secVal }));
            }
            const saved = localStorage.getItem('matchTimerWhistle_' + newHalf);
            if (saved) {
                const t = JSON.parse(saved);
                q('omt-sync-hr').value = t.h;
                q('omt-sync-min').value = t.m;
                q('omt-sync-sec').value = t.s;
            } else {
                q('omt-sync-hr').value = q('omt-sync-min').value = q('omt-sync-sec').value = '';
            }
            q('omt-custom-c1').style.display = (newHalf === 'custom1') ? 'inline-flex' : 'none';
            q('omt-custom-c2').style.display = (newHalf === 'custom2') ? 'inline-flex' : 'none';
            previousHalf = newHalf;
            this.blur();
        });

        // Enter key in whistle inputs
        ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec', 'omt-custom-minute-c1', 'omt-custom-minute-c2'].forEach(id => {
            const el = q(id);
            if (el) {
                el.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); iniciarTimer(); this.blur(); }
                });
            }
        });

        // --- Playback controls ---
        q('omt-m120').addEventListener('click', () => saltarVideo(-120));
        q('omt-m10').addEventListener('click', () => saltarVideo(-10));
        q('omt-m2').addEventListener('click', () => saltarVideo(-2));
        q('omt-p2').addEventListener('click', () => saltarVideo(2));
        q('omt-p10').addEventListener('click', () => saltarVideo(10));
        q('omt-p120').addEventListener('click', () => saltarVideo(120));
        q('omt-btn-play').addEventListener('click', togglePlay);
        q('omt-prev-frame').addEventListener('click', retrocederFrame);
        q('omt-next-frame').addEventListener('click', avancarFrame);

        // --- Kickoff jump buttons ---
        q('omt-jump-k1').addEventListener('click', () => jumpToKickoff('1'));
        q('omt-jump-k2').addEventListener('click', () => jumpToKickoff('2'));
        q('omt-jump-kc1').addEventListener('click', () => jumpToKickoff('custom1'));
        q('omt-jump-kc2').addEventListener('click', () => jumpToKickoff('custom2'));

        // --- Speed selector + quick chips ---
        speedSelect.addEventListener('change', selecionarVelocidade);
        omtRoot.querySelectorAll('.omt-speed-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                applyPlaybackSpeed(chip.getAttribute('data-speed'));
                noteOmtUiActivity(true);
            });
        });
        syncSpeedChips();

        // --- Auto hide toggle (redesign eye button; H hotkey still hides completely) ---
        const hidePanelBtn = q('omt-hide-panel');
        if (hidePanelBtn) {
            hidePanelBtn.addEventListener('click', () => {
                toggleAutoHideChrome();
            });
            syncAutoHideChromeButton();
        }

        // --- Live button ---
        liveBtn.addEventListener('click', irParaLive);

        // --- Volume ---
        const volGuardado = localStorage.getItem('matchTimerVolume');
        if (volGuardado !== null) {
            vid.volume = parseFloat(volGuardado);
            volumeRange.value = volGuardado;
            atualizarIconeVolume(vid.volume);
            if (vid.volume > 0) {
                vid.muted = false;
            }
        }
        volumeRange.addEventListener('input', function () {
            vid.volume = this.value;
            if (vid.volume > 0) {
                vid.muted = false;
            }
            atualizarIconeVolume(vid.volume);
            localStorage.setItem('matchTimerVolume', vid.volume);
        });
        volumeRange.addEventListener('change', () => volumeRange.blur());
        volumeIconBtn.addEventListener('click', toggleMute);

        vid.addEventListener('volumechange', () => {
            if (vid.muted || vid.volume === 0) {
                volumeRange.value = 0;
                atualizarIconeVolume(0);
            } else {
                volumeRange.value = vid.volume;
                atualizarIconeVolume(vid.volume);
            }
        });

        // --- Timeline slider ---
        timelineSlider.addEventListener('input', function () {
            isDraggingTimeline = true;
            vTimeCurrent.innerText = formatarTempoVideo(parseFloat(this.value));
            // Redesign only: keep fill glued to the thumb while dragging (no wait for timeupdate).
            if (typeof paintTimelineScrubberProgress === 'function') paintTimelineScrubberProgress(true);
        });
        timelineSlider.addEventListener('change', function () {
            const t = parseFloat(this.value);
            if (typeof paintTimelineScrubberProgress === 'function') paintTimelineScrubberProgress(true);
            seekTo(t);
            isDraggingTimeline = false;
            this.blur();
            resetControlsTimeout(false);
        });

        // Period + time hover tip (redesign); no "Seek timeline" label on the slider.
        const timelineTrack = omtRoot ? omtRoot.querySelector('.omt-timeline-track') : null;
        if (timelineTrack) {
            timelineTrack.addEventListener('pointermove', (e) => {
                if (typeof updateTimelineHoverTip === 'function') updateTimelineHoverTip(e.clientX);
            });
            timelineTrack.addEventListener('pointerleave', () => {
                if (typeof hideTimelineHoverTip === 'function') hideTimelineHoverTip();
            });
        }

        // --- Video element events (AbortController so teardown detaches cleanly) ---
        if (vidAbortController) {
            try { vidAbortController.abort(); } catch (_) {}
        }
        vidAbortController = new AbortController();
        const vsig = { signal: vidAbortController.signal };

        vid.addEventListener('loadedmetadata', inicializarMetadadosTimeline, vsig);
        vid.addEventListener('durationchange', inicializarMetadadosTimeline, vsig);

        vid.addEventListener('timeupdate', () => {
            // Anti-live-snap: if HLS pushed us forward unexpectedly, pull back
            antiLiveSnap();

            if (!isDraggingTimeline) {
                timelineSlider.value = vid.currentTime;
                vTimeCurrent.innerText = formatarTempoVideo(vid.currentTime);
            }
            atualizarRelogio();
            atualizarEstadoLive();

            // Re-calibrate slider min when PDT becomes available after a kickoff was set
            if (kickoff1 !== null) {
                const k1Time = getVideoTimeForPdt(kickoff1);
                if (k1Time !== null) {
                    const expectedMin = Math.max(0, k1Time - 900);
                    if (parseFloat(timelineSlider.min) !== expectedMin) {
                        inicializarMetadadosTimeline();
                    }
                }
            }
        }, vsig);

        vid.addEventListener('play', () => {
            // External/manual play cancels a pending auto-resume (our resume sets in-progress).
            if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
            syncPlayButtonFromVideo();
            // Don't reveal the panel — ShuttleXpress triggers play() silently.
            resetControlsTimeout(false);
        }, vsig);
        vid.addEventListener('pause', () => {
            // Do not clear auto-pause flag here — auto-pause itself fires pause.
            // Manual pause clears via togglePlay / click / Shuttle handlers.
            syncPlayButtonFromVideo();
        }, vsig);
        vid.addEventListener('ended', () => {
            if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
            syncPlayButtonFromVideo();
        }, vsig);
        vid.addEventListener('seeking', () => {
            if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
        }, vsig);
        vid.addEventListener('seeked', () => {
            if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
            syncPlayButtonFromVideo();
        }, vsig);
        // Initial icon/colour from the real media state (no centre-screen flash).
        syncPlayButtonFromVideo();
        if (typeof installAutoPauseOnBlur === 'function') installAutoPauseOnBlur();

        // Floating control panel is draggable via the top handle (timeline stays fixed at bottom).
        if (controlsPanel) {
            const handle = q('controls-handle');
            if (handle) fazerArrastavel(controlsPanel, handle);
        }

        // --- Auto-hide controls: mouse move + clicks/keys/wheel on our UI ---
        vid.addEventListener('mousemove', () => resetControlsTimeout(true), vsig);
        wireOmtUiActivityTracking();
        resetControlsTimeout(false);

        if (site.id === 'examino') {
            installExaminoHotkeys();
            installExaminoClickToToggle();
            wireExaminoSettingsUI();
            if (examinoPendingDvrSettle) {
                examinoPendingDvrSettle = false;
                settleExaminoMediaAfterBind();
            }
        } else {
            document.addEventListener('keydown', handleKeydown, true);
            // Click-to-play/pause on the <video> surface — same mechanism as
            // OverlayMatchTimer.html (local dashboard). Examino uses its own
            // capture-phase installer above. #omt-root is pointer-events:none so
            // clicks reach <video>; our panels restore pointer-events:auto and
            // never hit this handler (e.target !== vid).
            // Regression: local player (v1.5.0+) never got this ported from the
            // HTML dashboard, so video clicks did nothing.
            // Capture + stop so host players (e.g. Video.js) cannot also toggle
            // (would net to a no-op) — same exclusivity idea as Examino.
            vid.addEventListener('click', function (e) {
                if (e.target !== vid) return;
                // Allow blob/http src and MediaStream (srcObject) — mocks / some hosts
                // have empty currentSrc when only srcObject is set.
                if (!vid.src && !vid.currentSrc && !vid.srcObject) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                togglePlay();
            }, { capture: true, signal: vidAbortController.signal });
            vid.addEventListener('dblclick', function (e) {
                if (e.target !== vid) return;
                toggleFullScreen();
            }, vsig);
            // Click fires once before dblclick — reverse that toggle so
            // play/pause is unchanged after going fullscreen (original HTML).
            vid.addEventListener('dblclick', function (e) {
                if (e.target !== vid) return;
                if (!vid.src && !vid.currentSrc && !vid.srcObject) return;
                if (vid.paused) {
                    vid.play().catch(() => {});
                } else {
                    vid.pause();
                }
            }, vsig);
        }

        omtRoot.addEventListener('click', function (e) {
            noteOmtUiActivity(true);
            const el = e.target.closest('button');
            if (el) setTimeout(() => el.blur(), 50);
        });

        liveBtn.style.display = 'flex';

        if (typeof updateControlsTipFlip === 'function') {
            updateControlsTipFlip();
            window.addEventListener('resize', updateControlsTipFlip, { passive: true });
        }

        // Match-clock click-to-edit is wired in customize.js (omtInstallClockClickEdit).
        // Fixed presets only — no drag.

        // Shuttle toggle lives in the in-video more panel (analyst browser only).
        if (shuttleToggle) {
            shuttleToggle.addEventListener('change', handleToggleChange);
        }
        syncShuttleToggleFromStorage();
        setMorePanelOpen(false);
    }
