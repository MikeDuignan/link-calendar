# Link Calendar

A tiny calendar that lets you save a link per day. When deployed on Vercel, it syncs to Vercel Postgres (tiny Postgres DB).

## How it works

- Your browser creates/stores a **calendar key**.
- The API saves/loads entries from Postgres using that key.
- Anyone with the key can read/write that calendar (no accounts yet).

## Deploy to Vercel + Postgres

1. Create a new project from `MikeDuignan/link-calendar`: `https://vercel.com/new`
2. In the Vercel project: **Storage → Create Database → Postgres**
3. Connect the database to the project (Vercel will add env vars like `POSTGRES_URL`)
4. Redeploy the project

The table is created automatically on first use.

## Import the Academic Calendar PDF

This repo includes a one-time importer that extracts dated items from `Academic Calendar 2025-2026 Approved 24Mar25 V1.pdf` and saves them into your calendar (Vercel Postgres).

1. Install Python deps: `python -m pip install -r scripts/requirements.txt`
2. Get your **Calendar key** from the app UI
3. Run:
   - `python scripts/import_academic_calendar_pdf.py --pdf \"../Academic Calendar 2025-2026 Approved 24Mar25 V1.pdf\" --base-url \"https://YOUR-APP.vercel.app\" --calendar-id \"YOUR_CALENDAR_KEY\"`

## Run locally

- Open `index.html` for a local-only version (no cloud sync).
- Cloud sync requires deploying to Vercel (or running with Vercel CLI).
