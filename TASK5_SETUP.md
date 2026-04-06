# Task #5 Setup & Testing

**Phase 1B Task #5** — Simple Mode AI Search + Brand Swap + Custom Domain

This doc is the step-by-step Tony-runs-it-tomorrow guide. Everything is numbered per the CLAUDE.md "1st / 2nd / 3rd" rule.

---

## Snapshot / Revert Point

Before Task #5, the codebase was snapshotted to branch `backup/v1.0.0-pretask5` on GitHub at commit `3b54b4a`.

**To revert everything** if Task #5 breaks things:

1st — in terminal:
```
git fetch origin
git reset --hard origin/backup/v1.0.0-pretask5
git push --force origin claude/review-claude-md-WReks
```

(Only run `--force` if you're certain — it overwrites the working branch.)

---

## 1. Run the Supabase Migration

This creates the `brands` and `custom_domains` tables and seeds the default IXIntel brand row.

1st — Open Supabase: https://supabase.com/dashboard → your IXIntel project.

2nd — Click **SQL Editor** in the left sidebar → **New query**.

3rd — In your code repo, open `migrations/001_brands.sql` and copy the entire file contents.

4th — Paste into the Supabase SQL editor.

5th — Click **Run** (bottom right). You should see `Success. No rows returned` for each statement.

6th — Verify: go to **Table Editor** → you should now see two new tables:
- `brands` (1 row — the seeded "ixintel" default)
- `custom_domains` (empty)
- `profiles` will have a new `brand_id` column.

**If anything errors:** screenshot it and send to Claude in a new session.

---

## 2. Deploy to Railway

The scaffold commit `d5cc991` is already pushed to `claude/review-claude-md-WReks`. Railway only auto-deploys from `master`, so:

1st — On GitHub, open a PR from `claude/review-claude-md-WReks` → `master`.
- URL: https://github.com/tgrey7x/tradeintel-backend/compare/master...claude/review-claude-md-WReks

2nd — Review the diff (6 files, 890 insertions). No existing files rewritten — only 4 small additions to `server.js`.

3rd — Click **Merge pull request**.

4th — Railway will auto-deploy in ~60 seconds. Watch the deploy at https://railway.app → your project → Deployments.

5th — Confirm ANTHROPIC_API_KEY is set in Railway Variables (it should already be — the existing `/api/agent` route depends on it).

---

## 3. Smoke Tests (post-deploy)

Run these in order. All URLs use your production Railway domain — replace `YOUR_URL` with `tradeintel-backend-production.up.railway.app`.

### 3A. Brand endpoint (public, no auth)
1st — In your browser, visit:
```
https://YOUR_URL/api/brand
```
Expected: JSON `{ success: true, brand: { slug: "ixintel", name: "IXIntel", ... } }`.

### 3B. Simple Mode page
1st — Visit:
```
https://YOUR_URL/simple
```
Expected: Dark search page titled "Simple Search — IXIntel" with a centered search box. Brand name + colors should match whatever is in Supabase.

### 3C. Simple Mode health check (no Claude token cost)
1st — Visit:
```
https://YOUR_URL/api/simple-search/health
```
Expected: JSON showing `status: "ready"` and both `anthropic_api_key: "set"` and `anthropic_sdk: "installed"`. If either is "missing", fix that before testing 3D.

### 3D. Simple Mode live search (spends ~1¢ of Claude tokens per query)
1st — Go back to `/simple` in your browser.
2nd — Type "Who are the top exporters of coffee to the US?" and click Search (or Ctrl+Enter).
3rd — Expected: an "Answer" card appears with 1–3 sentences, plus 1–4 "source" cards with HS codes or data-source labels.

### 3E. Admin Brands page (admin login required)
1st — Visit `/login` and sign in as an admin user.
2nd — Visit:
```
https://YOUR_URL/admin/brands
```
Expected: Admin Brands page with a "Create Brand" form on the left and a list on the right containing the seeded "ixintel" brand.
3rd — Click the ixintel row → it should populate the form and show an empty "Custom Domains" panel.

### 3F. Create a test brand
1st — Click **New** button on the admin-brands page.
2nd — Slug: `test-brand`, Name: `Test Brand`, Primary Color: pick something.
3rd — Click **Save Brand**. Expected: green "Brand created" message and the new row appears in the list.
4th — Click the new row → change the name → Save. Expected: green "Brand updated".

### 3G. Custom domain add (DNS verification will fail without real DNS)
1st — With a brand selected, scroll to "Custom Domains" → enter something like `trade.test.com` → Add.
2nd — Expected: a pending domain row appears with a TXT record token like `ixintel-verify-abc123...`.
3rd — The "Verify now" button will fail unless the TXT record actually exists in DNS — that's expected for a fake domain.

---

## 4. What Still Needs to Be Built

Open items tracked in CLAUDE.md → Priority Build Order #5:

- **Cloudflare custom hostname SSL** — needs a module `cloudflare-domains.js` that calls the Cloudflare SaaS Custom Hostnames API when a domain is verified. Requires `CLOUDFLARE_API_TOKEN` in Railway Variables.
- **Brand-scoped user signup** — signup form should accept a `?brand=slug` query and stamp `profiles.brand_id`.
- **Tenant data isolation** — RLS policies on trade data tables (once they exist) to prevent cross-brand leakage.
- **Simple Mode → real trade data** — currently the parser answers from Claude's training data. Next iteration: the parser should emit structured params and the route should call `/api/trade-data` to return real numbers.
- **Admin Console integration** — `admin.html` currently has no link to `/admin/brands`. A one-line `<a href="/admin/brands">Brands</a>` in its nav would help, but it's a crown-jewel file, so do it deliberately.

---

## 5. Module Map (per the Modular Architecture rule)

Task #5 ships as 4 self-contained modules. Each can be removed by deleting the file and removing one `require` + one `app.use` line from `server.js`.

| Module | File | Mount point | Can be deleted? |
|---|---|---|---|
| Brands / Domains | `brands.js` | `app.use(brands.router)` + `app.use(brands.hostMiddleware)` | Yes — 2 lines in server.js |
| Simple Search | `simple-search.js` | `app.use(simpleSearch.router)` | Yes — 1 line in server.js |
| Simple Mode UI | `simple.html` | `GET /simple` in server.js | Yes — 3 lines in server.js |
| Admin Brands UI | `admin-brands.html` | `GET /admin/brands` in server.js | Yes — 3 lines in server.js |
| DB schema | `migrations/001_brands.sql` | Supabase SQL editor | Yes — `drop table` reverse |

The existing crown-jewel files `index.html`, `admin.html`, `login.html` were **not touched**.
