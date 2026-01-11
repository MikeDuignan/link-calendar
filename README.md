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

## Run locally

- Open `index.html` for a local-only version (no cloud sync).
- Cloud sync requires deploying to Vercel (or running with Vercel CLI).

