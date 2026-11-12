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

        // --- Speed selector ---
        speedSelect.addEventListener('change', selecionarVelocidade);

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
        });
        timelineSlider.addEventListener('change', function () {
            const t = parseFloat(this.value);
            seekTo(t);
            isDraggingTimeline = false;
            this.blur();
            resetControlsTimeout(false);
        });

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
            if (!btnMainPlay || !controlsPanel) return; // null-guard: UI may have been torn down
            atualizarBotaoPlay(true);
            controlsPanel.classList.add('playing-state');
            // Don't reveal the panel — ShuttleXpress triggers play() silently.
            resetControlsTimeout(false);
        }, vsig);
        vid.addEventListener('pause', () => {
            if (!btnMainPlay || !controlsPanel) return; // null-guard: UI may have been torn down
            atualizarBotaoPlay(false);
            controlsPanel.classList.remove('playing-state');
        }, vsig);

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
        }

        omtRoot.addEventListener('click', function (e) {
            noteOmtUiActivity(true);
            const el = e.target.closest('button');
            if (el) setTimeout(() => el.blur(), 50);
        });

        liveBtn.style.display = 'flex';

        // Match-clock click-to-edit ("set video time") removed from in-video UI.
        // navegarParaMinutoDeJogo / iniciarEdicaoTimer remain available internally.

        // Shuttle toggle lives in the in-video more panel (analyst browser only).
        if (shuttleToggle) {
            shuttleToggle.addEventListener('change', handleToggleChange);
        }
        syncShuttleToggleFromStorage();
        setMorePanelOpen(false);
    }
