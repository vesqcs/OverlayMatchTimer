# Publishing Overlay MatchTimer (Unlisted) — owner steps

This package prepares the listing; **you** create the developer account, pay the fee, upload, and submit. Agents must **not** pay, publish, or merge unless you explicitly ask.

---

## What the Chrome Web Store actually requires

Based on Chrome Web Store Developer Programme Policies / dashboard fields (confirm against the live dashboard — Google updates these):

| Requirement | Required? | What to provide | Where it lives in this repo | Where it must be hosted |
|-------------|-----------|-----------------|-----------------------------|-------------------------|
| Extension package (zip) | **Yes** | Zip whose root contains `manifest.json` | `scripts/make-release-zip.sh` → use inner `Overlay-chrome-extension/` contents for upload | Uploaded in Developer Dashboard |
| Listing title / descriptions | **Yes** | Store listing copy | `store/LISTING.md` | Dashboard fields only |
| **Single purpose** statement | **Yes** | One clear purpose | `store/LISTING.md` | Dashboard |
| **Privacy policy URL** | **Yes** | Stable **HTTPS** URL | `store/privacy/` | Host `index.html`; paste URL in listing. **[Owner confirms hosting.]** |
| Data usage disclosures | **Yes** | Dashboard questionnaire | Align with `PRIVACY.md` (v1.7.1 = local-only; no active cloud sync) | Dashboard — **no invented claims** |
| Permission justifications | **Yes** when prompted | Why each permission / host | `store/PERMISSIONS.md` | Dashboard |
| Graphic assets | **Yes** | Icon, screenshots, small promo | `assets/icon-128.png`, `store/screenshots/`, `promo-small-440x280.png` | Uploaded in Dashboard |
| Terms of use URL | **Optional** | Only if org wants one | `store/terms/` | Host after legal confirmation |
| Remote code disclosure | **Yes** (declare) | Local concatenated JS only | — | Declare **no** remote code if still true |
| Distribution | Your choice | **Unlisted** recommended | — | Dashboard |

**Needs owner / Stats Perform confirmation before submit:** privacy URL, whether Terms are linked, data-usage answers, fee-paying account, Unlisted policy.

---

## Kickoff sync and the Store (v1.7.1)

Do **not** claim active cloud sync. Sync is feature-flagged off: no UI, no Supabase host permission, no sync traffic. If a future always-on sync ships, update privacy + permissions + listing **before** submit (drafts in `supabase/SETUP.md`).

---

## Before you start

1. Build: `./scripts/make-release-zip.sh` → versioned zip (e.g. `OverlayMatchTimer-v2.0.0-full.zip`). For Store upload, zip **contents** of `Overlay-chrome-extension/` (manifest at zip root).
2. Host privacy at a stable HTTPS URL.
3. Keep listing **Unlisted** unless policy says otherwise.

## Exact steps

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in; pay one-time fee if first time (**you**).
3. New item → upload extension zip.
4. Fill from `LISTING.md`; upload graphics; paste privacy URL; complete disclosures; paste `PERMISSIONS.md` justifications.
5. Distribution: **Unlisted** → Submit.

## After approval

Share Unlisted link internally. Updates: bump version → rebuild zip → Upload → Submit.

## Review risk report (do not auto-change)

| Item | Risk | Minimal fix (propose only) |
|------|------|----------------------------|
| Loopback host_permissions | Medium | Narrow after owner confirms QA URLs |
| Examino whole origin | Low–medium | Narrow to `/play/dvr/*` and `/play/vod/*` |
| `world: MAIN` | Low | Needed for page `video` APIs |
| WebHID Shuttle | Low | User gesture / chooser |
| Remote code | None observed | Keep local concat build |

**Not applied in this PR:** narrowing host_permissions.
