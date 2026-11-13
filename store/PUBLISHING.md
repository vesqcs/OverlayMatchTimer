# Publishing Overlay MatchTimer (Unlisted) — owner steps

This package prepares the listing; **you** create the developer account, pay the fee, upload, and submit. Agents must **not** pay, publish, or merge unless you explicitly ask.

---

## What the Chrome Web Store actually requires

Based on Chrome Web Store Developer Programme Policies / dashboard fields (confirm against the live dashboard — Google updates these):

| Requirement | Required? | What to provide | Where it lives in this repo | Where it must be hosted |
|-------------|-----------|-----------------|-----------------------------|-------------------------|
| Extension package (zip) | **Yes** | Zip whose root contains `manifest.json` | Build via `scripts/make-release-zip.sh` → use inner `Overlay-chrome-extension/` or re-zip that folder’s **contents** as the upload | Uploaded in Developer Dashboard (not a public URL) |
| Listing title / descriptions | **Yes** | Store listing copy | `store/LISTING.md` | Dashboard fields only |
| **Single purpose** statement | **Yes** | One clear purpose | `store/LISTING.md` → Single purpose | Dashboard |
| **Privacy policy URL** | **Yes** (for this item) | Stable **HTTPS** URL the public (or reviewers) can open | Source: `store/privacy/PRIVACY.md` + `store/privacy/index.html` | Host `index.html` (e.g. GitHub Pages, internal docs site). Paste that URL into the listing’s privacy field. **[Owner confirms hosting location.]** |
| Data usage / privacy practices disclosures | **Yes** | Dashboard questionnaire: whether you collect data, transfer, sell, etc. | Align answers with `store/privacy/PRIVACY.md` | Dashboard checkboxes / declarations — **no invented claims**; answer truthfully for *this* build |
| Permission justifications | **Yes** when prompted | Plain-language why each permission / host is needed | `store/PERMISSIONS.md` | Dashboard justification fields |
| Graphic assets | **Yes** | Store icon, screenshots, small promo | `Overlay-chrome-extension/assets/icon-128.png`, `store/screenshots/`, `store/promo-small-440x280.png` | Uploaded in Dashboard |
| Terms of use URL | **Optional** | Only if you or Stats Perform want one | `store/terms/TERMS.md` + `store/terms/index.html` | Host like privacy if used; not a CWS hard requirement for every item |
| Remote code disclosure | **Yes** (declare) | This build ships concatenated local JS only — no remote code | — | Dashboard: declare **no** remote code if still true at submit time |
| Distribution | Your choice | **Unlisted** recommended for internal tool | — | Dashboard → Unlisted |

**Needs owner / Stats Perform confirmation before submit:** final privacy URL, whether Terms are linked, data-usage checkbox answers, account that pays the one-time developer fee, and whether Unlisted is mandatory under internal policy.

---

## Privacy & Kickoff sync (v1.7.0)

When answering Store privacy questions:

- **Default:** Kickoff sync is **off**. No Supabase traffic; optional host permission not granted.
- **If a user turns sync on:** kickoff / clock-reference fields for a match room may be sent to **their** configured Supabase project URL using the **anon** key they entered (stored in `chrome.storage.local` on device).
- The extension developer does **not** operate a mandatory backend for sync in this design.
- Optional host permission: `https://*.supabase.co/*` — requested at runtime when enabling sync only.

Do not claim “we never transmit any data” if sync can be enabled; claim accurately: local-only unless the user enables Kickoff sync.

---

## Before you start

1. Build: `./scripts/make-release-zip.sh` → `OverlayMatchTimer-v1.7.0.zip`. For the Store upload, zip **only** the contents of `Overlay-chrome-extension/` (manifest at zip root) or follow Dashboard guidance.
2. Host the privacy page at a stable HTTPS URL (`store/privacy/index.html`).
3. Optionally host Terms (`store/terms/index.html`) after legal confirmation.
4. Keep listing **Unlisted** unless policy says otherwise.

---

## Exact steps (Developer Dashboard)

1. Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in with the Google account that will own the listing.
3. If first time: accept the developer agreement and pay the **one-time** registration fee (**you** do this).
4. **New item** → upload the extension zip (`manifest.json` at top level).
5. Fill listing from `LISTING.md` (title, short/detailed description, single purpose, category, language).
6. Upload graphics from `store/screenshots/` and `store/promo-small-440x280.png`.
7. Privacy: paste hosted privacy policy URL; complete data-usage disclosures honestly per `PRIVACY.md`.
8. Permissions: paste justifications from `PERMISSIONS.md`.
9. Distribution: **Unlisted**.
10. **Submit for review**. Fix any rejection notes and resubmit.

## After approval

- Share the Unlisted install link internally.
- Updates: bump version → rebuild zip → Upload new package → Submit.

---

## Review risk report (do not auto-change)

| Item | Risk | Minimal fix (propose only) |
|------|------|----------------------------|
| `host_permissions` loopback | Medium | Narrow to fixture path patterns after owner confirms QA URLs |
| `host_permissions` Examino whole origin | Low–medium | Narrow to `/play/dvr/*` and `/play/vod/*` |
| `optional_host_permissions` Supabase | Low if default off | Keep runtime request; explain in justifications |
| `world: MAIN` | Low | Needed for page `video` APIs; bridge stays isolated |
| WebHID Shuttle | Low | User gesture / chooser |
| Remote code | None observed | Keep local concat build only |

**Not applied in this PR:** narrowing host_permissions (could break owner QA URLs).
