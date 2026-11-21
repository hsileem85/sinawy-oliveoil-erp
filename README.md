# Sinawy Olive Oil ERP (`sinawy.net`)

Lightweight, bilingual (**English + Arabic RTL**) back-office ERP for **Sinawy Olive Oil**, built for **GitHub Pages + Supabase (PostgreSQL + Auth + RPC + Edge Functions)** with EasyOrders REST API readiness.

- **Live GitHub Pages URL**: `https://hsileem85.github.io/sinawy-oliveoil-erp/`

---

## Phases Included

1. **Phase 1 — Purchases & Raw Material Inventory**: 17-litre olive oil gallons (auto gallon ↔ litre & landed cost/L), Tin & Glass bottles, Stickers, Packaging, Suppliers, and Hidden Costs (landed or P&L overhead).
2. **Phase 2 — Bottling & Packaging (COGS Batches)**: Finished SKUs with BOM recipes, Live Yield & Bottleneck Estimator, atomic raw-stock deduction with spillage + batch labor/hidden cost, and weighted-average Unit COGS.
3. **Phase 3 — Multi-Channel Sales & True P&L**: Online (`sinawy.net` / EasyOrders), Offline / Phone & WhatsApp, and Social Media Ads (Facebook/Instagram/TikTok) with Ad Spend, ROAS, COD tracking, automatic stock restore on cancel/return, and Arabic-safe Excel CSV Export.
4. **REST API & EasyOrders Integration**: Serverless Supabase Edge Functions (`easyorders-webhook` & `stock-feed`) secured by `X-API-Key` / webhook secret.

---

## Connect Supabase + Publish Live (3-Minute Setup)

### Step 1: Create a Free Supabase Project
1. Go to [supabase.com](https://supabase.com) and create a new project (e.g., `sinawy-erp`).
2. Save your **Database Password** and open **Project Settings → API** to copy:
   - **Project URL** (`https://<project-ref>.supabase.co`)
   - **anon public key** (`eyJ...`)
   - **Project Reference ID** (`<project-ref>`, under Project Settings → General)

### Step 2: Create the Database Tables & RPC Functions (Choose Option A or B)

#### Option A — Automated via GitHub Actions (Recommended, also deploys EasyOrders Edge Functions!)
1. In GitHub repo **Settings → Secrets and variables → Actions → Secrets**, add:
   - `VITE_SUPABASE_URL` = your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon public key
   - `SUPABASE_PROJECT_REF` = your 20-char Project Reference ID
   - `SUPABASE_DB_PASSWORD` = your Supabase database password
   - `SUPABASE_ACCESS_TOKEN` = create at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
2. Go to **Actions → Deploy Supabase Database & Edge Functions → Run workflow**.
3. Go to **Actions → Deploy Sinawy ERP to GitHub Pages → Run workflow** (bakes your Supabase URL/key into the live GitHub Pages site).

#### Option B — Instant 1-Click SQL Editor (No Supabase Token Needed)
1. Open your Supabase project → **SQL Editor → New Query**.
2. Paste the contents of [`supabase/migrations/20261121000001_sinawy_erp.sql`](./supabase/migrations/20261121000001_sinawy_erp.sql) and click **Run**.
3. Open `https://hsileem85.github.io/sinawy-oliveoil-erp/`, click **Connect DB** on the Login screen (or add `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` to GitHub repo Secrets and re-run the Pages workflow), then click **Create Admin Account**!
4. After signing in, click **Load Starter Data** on the Dashboard banner if you want Sinawy's sample 17L gallons, bottles, stickers, and orders loaded automatically.

---

## Local Development (Zero-Config Embedded PostgreSQL)

```bash
npm install
npm --prefix client install
npm run dev
```

- Web UI: `http://localhost:5173` (default local admin: `admin@sinawy.net` / `sinawy2026`)
- Automated Tests: `npm test`
