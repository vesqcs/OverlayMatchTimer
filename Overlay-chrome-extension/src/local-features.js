/* Local player: file picker, drag-and-drop, per-window open-file control. */
    let localObjectUrl = null;
    let localFeaturesInstalled = false;

    function revokeLocalObjectUrl() {
        if (localObjectUrl) {
            try { URL.revokeObjectURL(localObjectUrl); } catch (_) {}
            localObjectUrl = null;
        }
    }

    function setLocalDropVisible(visible) {
        const drop = document.getElementById('omt-local-drop');
        if (drop) drop.hidden = !visible;
        const stage = document.getElementById('omt-local-stage');
        if (stage) stage.classList.toggle('omt-has-media', !visible);
    }

    function loadLocalVideoFile(file) {
        if (!file || (!/^video\//i.test(file.type) && !/\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(file.name || ''))) {
            mostrarOSD('Unsupported file');
            return;
        }
        if (!ensureLiveVideo()) return;
        revokeLocalObjectUrl();
        localObjectUrl = URL.createObjectURL(file);
        try { vid.pause(); } catch (_) {}
        vid.src = localObjectUrl;
        vid.load();
        setLocalDropVisible(false);
        const nameEl = document.getElementById('omt-local-filename');
        if (nameEl) nameEl.textContent = file.name || 'Local video';
        mostrarOSD('Loaded: ' + (file.name || 'video'));
        const playPromise = vid.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }
        // Refresh timeline bounds once metadata is ready.
        const onMeta = () => {
            try {
                if (typeof inicializarMetadadosTimeline === 'function') inicializarMetadadosTimeline();
            } catch (_) {}
            syncPlayButtonFromVideo();
            noteOmtUiActivity(true);
        };
        vid.addEventListener('loadedmetadata', onMeta, { once: true });
        vid.addEventListener('durationchange', onMeta, { once: true });
    }

    function openLocalFilePicker() {
        const input = document.getElementById('omt-local-file-input');
        if (input) input.click();
    }

    function ensureLocalOpenFileControl() {
        if (!omtRoot || site.id !== 'local') return;
        const more = omtRoot.querySelector('#omt-more-panel');
        if (!more || more.querySelector('#omt-local-open-file')) return;
        const block = document.createElement('div');
        block.className = 'omt-more-block omt-local-file-block';
        block.innerHTML =
            '<button type="button" id="omt-local-open-file" class="btn-sync omt-tip" data-tip="Open a local or NAS-mapped video file">' +
            omtIcon('folder-open', 14) +
            '<span class="omt-btn-label">Open file</span></button>' +
            '<span id="omt-local-filename" class="omt-local-filename">No file loaded</span>';
        const shuttle = more.querySelector('.omt-shuttle-block');
        if (shuttle) more.insertBefore(block, shuttle);
        else more.appendChild(block);
        block.querySelector('#omt-local-open-file').addEventListener('click', () => {
            openLocalFilePicker();
            noteOmtUiActivity(true);
        });
    }

    function installLocalPlayerFeatures() {
        if (localFeaturesInstalled || site.id !== 'local') return;
        localFeaturesInstalled = true;

        ensureLocalOpenFileControl();

        const input = document.getElementById('omt-local-file-input');
        if (input) {
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (file) loadLocalVideoFile(file);
                input.value = '';
            });
        }

        const drop = document.getElementById('omt-local-drop');
        const stage = document.getElementById('omt-local-stage');
        const target = drop || stage;
        if (target) {
            const onDrag = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (drop) drop.classList.add('is-dragover');
            };
            const onLeave = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (drop) drop.classList.remove('is-dragover');
            };
            ['dragenter', 'dragover'].forEach((ev) => target.addEventListener(ev, onDrag));
            ['dragleave', 'dragend'].forEach((ev) => target.addEventListener(ev, onLeave));
            target.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (drop) drop.classList.remove('is-dragover');
                const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (file) loadLocalVideoFile(file);
            });
        }
        if (drop) {
            drop.addEventListener('click', (e) => {
                if (e.target.closest('button, input, a, label')) return;
                openLocalFilePicker();
            });
            const browse = drop.querySelector('#omt-local-browse');
            if (browse) browse.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openLocalFilePicker();
            });
        }

        setLocalDropVisible(!(vid && vid.src));
        console.log('[OMT] Local player file/dnd installed.');
    }
