/* Wire UI controls to timer / playback / auto-hide / site extras. */
    /* =========================================================
       6. WIRE ALL EVENTS
       ========================================================= */
    function wireEvents() {
        // --- Setup panel buttons ---
        q('omt-btn-close-setup').addEventListener('click', esconderSetup);
        q('omt-btn-set-kickoff').addEventListener('click', () => { iniciarTimer(); });
        q('omt-btn-clear-timer').addEventListener('click', () => { limparTimer(); });
        q('omt-btn-show-setup').addEventListener('click', mostrarSetup);
        q('omt-btn-fullscreen').addEventListener('click', toggleFullScreen);

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
            q('omt-custom-c1').style.display = (newHalf === 'custom1') ? 'block' : 'none';
            q('omt-custom-c2').style.display = (newHalf === 'custom2') ? 'block' : 'none';
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
            btnMainPlay.innerHTML = '⏸ Pause';
            btnMainPlay.classList.add('playing');
            controlsPanel.classList.add('playing-state');
            // Don't reveal the panel — ShuttleXpress triggers play() silently.
            resetControlsTimeout(false);
        }, vsig);
        vid.addEventListener('pause', () => {
            if (!btnMainPlay || !controlsPanel) return; // null-guard: UI may have been torn down
            btnMainPlay.innerHTML = '⏯ Play';
            btnMainPlay.classList.remove('playing');
            controlsPanel.classList.remove('playing-state');
        }, vsig);

        // --- Drag system for both panels ---
        fazerArrastavel(setupPanel, q('setup-handle'));
        fazerArrastavel(controlsPanel, q('controls-handle'));

        // --- Auto-hide controls: mouse move + clicks/keys/wheel on our UI ---
        // Never hide while the pointer is over our interactive chrome.
        vid.addEventListener('mousemove', () => resetControlsTimeout(true), vsig);
        wireOmtUiActivityTracking();
        resetControlsTimeout(false); // bootstrap: start timer, don't force-show

        // --- Keyboard shortcuts (capture phase, highest priority) ---
        // Examino: persistent window listener installed at document_start.
        // InplayIP: document capture listener (baseline behaviour).
        if (site.id === 'examino') {
            installExaminoHotkeys();
            installExaminoClickToToggle();
            wireExaminoSettingsUI();
            // Only settle to live-edge after an explicit VOD→DVR switch — never on every bind.
            if (examinoPendingDvrSettle) {
                examinoPendingDvrSettle = false;
                settleExaminoMediaAfterBind();
            }
        } else {
            document.addEventListener('keydown', handleKeydown, true);
        }

        // Auto-blur our own buttons after click (prevent shortcut hijack)
        omtRoot.addEventListener('click', function (e) {
            noteOmtUiActivity(true);
            const el = e.target.closest('button');
            if (el) setTimeout(() => el.blur(), 50);
        });

        // Show live button immediately (always a stream)
        liveBtn.style.display = 'flex';

        // Click listener for interactive timer
        timerUI.addEventListener('click', iniciarEdicaoTimer);

        // ShuttleXpress toggle change listener
        if (shuttleToggle) {
            shuttleToggle.addEventListener('change', handleToggleChange);
            shuttleToggle.addEventListener('click', () => shuttleToggle.blur());
        }
    }
