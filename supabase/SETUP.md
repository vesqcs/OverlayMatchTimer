# Kickoff sync — setup & planned design

**v1.7.1 status:** Sync is **disabled** in the shipped extension (`OMT_SYNC_FEATURE_ENABLED = false`). The migration file is kept for future use. Do **not** create or modify a real Supabase project from CI/agents unless the owner explicitly asks. Never commit service-role keys or production anon keys to git.

---

## Current tree (inert)

| Path | Role |
|------|------|
| `migrations/20261113120000_kickoff_sync.sql` | Prototype table + open anon RLS (too loose for the future design — replace before ship) |
| `Overlay-chrome-extension/src/sync/` | MAIN-world hooks (no-op while flag off) |
| `Overlay-chrome-extension/sync-feature-flag.js` | Internal gate |

---

## Future design (owner decision — **not implemented**)

Always on. Zero configuration for analysts.

### Product rules

1. **One shared Supabase project** owned/operated for the team; URL + **anon** key are **bundled in extension config** (build-time / private config), not typed into Customize.
2. **Match key** is derived automatically from the match page (e.g. Examino `/play/dvr|vod/<id>`, Inplay host+path). No user Room id.
3. **First analyst who sets the timer** on that match creates/updates the row; everyone else on the same match receives it (poll or Realtime — TBD at implement time).
4. **Conflict rule:** **latest write wins** (upsert by `match_key` with `updated_at`). A later Set Kick-off / nudge replaces the previous values.
5. Analysts never see sync settings in the popup.

### What must change vs the v1.7.0 prototype

| Area | Remove / stop | Add / replace |
|------|----------------|---------------|
| Popup | User Project URL, anon key, Room id, enable toggle | No sync UI |
| Manifest | `optional_host_permissions: https://*.supabase.co/*` | Fixed `host_permissions` for **that one** project origin only |
| Config | `chrome.storage` user credentials | Bundled constants or sealed config (anon only); rotate via new extension build |
| SQL / RLS | Open `USING (true)` policies in the prototype migration | Tight RLS (below) |
| Privacy / store | “User’s own project” wording | Disclosures for a shared operated project (draft below) |

### Tight RLS (target — draft; owner/DBA to confirm)

Goals: anon clients can only touch the row for the match they already know; no table-wide reads; no deletes; rate-limit abuse.

- Enable RLS; **revoke** broad table grants where possible; expose **security-definer RPCs** such as:
  - `kickoff_get(p_match_key text)` → returns at most one row for that key
  - `kickoff_upsert(p_match_key text, …kickoff fields…)` → insert or update that key only; sets `updated_at = now()`
- **No `DELETE`** policy for `anon`.
- Prefer **no** direct `SELECT` on the table for `anon` (only via `kickoff_get`).
- Rate limits: e.g. reject upsert if last write for that key from same client was &lt; N ms ago, and/or global per-IP limits at the API gateway / Supabase protections.
- Never put the **service_role** key in the extension.

The existing `20261113120000_kickoff_sync.sql` is a **prototype** and must be superseded by a new migration before any production enablement.

### Privacy policy wording to add when enabled

*[Needs owner / Stats Perform confirmation before publish.]*

Suggested bullets for `store/privacy/`:

- Kickoff sync is built into the extension and uses a Stats Perform–designated Supabase project.
- When you set or adjust kick-off / clock-reference values on a match page, those values (and a derived match key from the page URL) may be sent to that project so colleagues on the same match can share the same clock reference.
- The extension does not upload match video, keystrokes, or personal account profiles for sync.
- Retention: rows are kept only as needed for live / recent analysis rooms; exact retention period **[owner to specify]**.
- Contact: internal Stats Perform channel for the extension owner.

### Host permission note (v1.7.1)

While sync is disabled, the manifest must **not** declare Supabase optional/fixed host permissions. When implementing always-on sync, add only:

```json
"host_permissions": [
  "https://<PROJECT_REF>.supabase.co/*"
]
```

Document the project ref in the private release checklist; do not use a `*.supabase.co` wildcard for the future design.

### Re-enabling the old prototype UI (internal only)

Not recommended for ship. If needed for a lab build: see comments in `Overlay-chrome-extension/sync-feature-flag.js` (flag + restore `optional_host_permissions` + rebuild). Prefer implementing the always-on design above instead.
