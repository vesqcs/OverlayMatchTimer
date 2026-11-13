/* Derive a stable match room key for kickoff sync. */
    function omtSyncNormalizePath(pathname) {
        let p = String(pathname || '/');
        if (!p.startsWith('/')) p = '/' + p;
        // Drop trailing slash except root
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        return p;
    }

    function omtSyncMatchKey() {
        const cfg = typeof omtSyncGetConfig === 'function' ? omtSyncGetConfig() : { room: '' };
        if (cfg.room) {
            return ('room:' + cfg.room).slice(0, 200);
        }
        try {
            const host = (location.hostname || '').toLowerCase();
            const path = omtSyncNormalizePath(location.pathname);
            // Prefer Examino play id segment when present
            const m = path.match(/\/play\/(?:dvr|vod)\/([^/]+)/i);
            if (m && m[1]) return ('examino:' + decodeURIComponent(m[1])).slice(0, 200);
            return (host + path).slice(0, 200);
        } catch (_) {
            return 'unknown';
        }
    }
