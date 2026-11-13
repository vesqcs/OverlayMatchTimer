# Publishing Overlay MatchTimer (Unlisted) — owner steps

This package prepares the listing; **you** create the developer account, pay the fee, upload, and submit. No payments or publishing from the agent.

## Before you start

1. Build folder to upload: use `OverlayMatchTimer-v1.6.5.zip` → inside it, the `Overlay-chrome-extension/` directory is what Chrome needs (or zip **only** that folder’s contents as the store package).
2. Host the privacy page somewhere public the Store can link to (e.g. GitHub Pages from `store/privacy/index.html`), or paste `PRIVACY.md` into an internal doc and publish a stable HTTPS URL.
3. Keep listing **Unlisted** (only people with the link can install).

## Exact steps (Chrome Web Store Developer Dashboard)

1. Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in with the Google account that will own the listing.
3. If first time: accept the developer agreement and pay the **one-time $5** registration fee (you do this yourself).
4. **New item** → upload a zip of the extension root (`manifest.json` at the top level of the zip).
5. Fill listing from `LISTING.md`:
   - Title, short description, detailed description
   - Single purpose (from LISTING.md)
   - Category: Productivity (or Workflow)
   - Language: English
6. Upload graphics from `store/screenshots/` and `store/promo-small-440x280.png`.
7. Privacy:
   - Link to the hosted privacy policy URL
   - Confirm: no remote code; no user data collection / “not sold”
8. Permissions: paste justifications from `PERMISSIONS.md` when prompted.
9. Distribution: set visibility to **Unlisted**.
10. **Submit for review**. Wait for email; fix any rejection notes and resubmit.

## After approval

- Copy the Unlisted install link to the internal team.
- For updates: bump `manifest.json` version → rebuild zip → Upload new package → Submit.

## Review risk report (do not auto-change)

| Item | Risk | Minimal fix (propose only) |
|------|------|----------------------------|
| `host_permissions`: `http://127.0.0.1/*` and `http://localhost/*` | **Medium** — broader than content-script matches; reviewers may ask why all loopback paths | Narrow to the same patterns as content_scripts, e.g. `http://127.0.0.1/*inplay*`, `http://127.0.0.1/*examino*`, `http://localhost/*inplay*`, `http://localhost/*examino*`, plus the extension’s `player.html` origin if needed via `chrome-extension://` only (no host perm) |
| `host_permissions`: `*://examino.statsperform.io/*` | **Low–medium** — content scripts only run on `/play/dvr/*` and `/play/vod/*` | Change host permission to `*://examino.statsperform.io/play/dvr/*` and `*://examino.statsperform.io/play/vod/*` to match |
| `host_permissions` / matches: `*://*.inplayip.tv/*` | **Low** — whole product domain is intentional | Keep; explain “all InplayIP match pages under this product domain” |
| `world: MAIN` content scripts | **Low** — needed to reach page video APIs | Explain in review notes: must call page `video` element / player APIs; bridge remains isolated |
| WebHID for ShuttleXpress | **Low** — not a manifest permission; user gesture | Mention in description: optional device access after user enables + chooser |
| Remote code / eval | None observed in build | Keep build as concatenated local sources only |

**Not applied in this PR:** narrowing host_permissions (could break a local QA URL the owner relies on). Apply only after confirming local fixture URL patterns.
