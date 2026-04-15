# DebtCollector

A small **React + Vite + TypeScript** web app for **shared restaurant-style bills**: scan or enter line items, let everyone claim what they ate, see each person’s share, and record **“confirm paid”** toward the host. Data lives in **Supabase** (Postgres, Auth, Row Level Security). Optional **receipt parsing** uses an external **AI workflow** API.

---

## Prerequisites

- **Node.js** 20+ (or current LTS) and **npm**
- A **[Supabase](https://supabase.com/)** project
- (Optional) **Google OAuth** configured in Supabase if you want “Sign in with Google”
- (Optional) A **receipt AI** HTTP endpoint that accepts `multipart/form-data` with an `image` field and returns JSON in the shape the app expects (see [Receipt AI](#receipt-ai-optional))

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy the example file and edit values:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | Yes | Your project URL (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase **anon** / **publishable** key (safe for the browser) |
| `VITE_AI_API_URL` | No | Full POST URL for the receipt workflow (see below) |
| `VITE_AI_API_KEY` | If AI is used | `Authorization: Bearer …` for that workflow |

Never commit `.env` or real secrets.

### 3. Apply database migrations

SQL migrations live in `supabase/migrations/` (numbered `0001` … `0011`). Apply them to your Supabase database, for example:

- **Supabase Dashboard** → SQL Editor → run each file in order, or  
- **Supabase CLI**: `supabase link` then `supabase db push` (if you use the CLI locally)

Until migrations are applied, sign-in, bills, and RLS will not match what the app expects.

### 4. Auth URLs (Google)

For Google sign-in, the **redirect URI** in Google Cloud Console must be Supabase’s callback (not your Vite URL). Your app origin (e.g. `http://localhost:5173`) belongs under **Supabase → Authentication → URL Configuration → Redirect URLs**. Details are duplicated in `.env.example`.

### 5. Run the dev server

```bash
npm run dev
```

Open the URL Vite prints (by default `http://localhost:5173`). The dev server is configured with **`server.host: true`** so you can also open the app from another device on your LAN using your machine’s IP (you may need to allow the port in the OS firewall).

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Vitest watch mode |

---

## How to use the app

### Sign in

Use **Google** or **email/password** (depending on what you enabled in Supabase). After sign-in you land on **Home**.

### Home

- **Open bills** lists every bill that is **not closed** (any signed-in user can see open bills in this version).
- Bills you **host** are labeled “You’re the host”.
- **Closed** lists bills you hosted or joined that are already closed.
- **New bill** creates a server bill and takes you through scanning or manual lines, then **Create bill**.

### Joining a bill

- Open a bill from Home or use an **invite link**: `/join/<INVITE_CODE>` (the code is shown on the bill card).
- If you open a bill you are not on yet, use **Join this bill** so you become a **participant** and can use **My order** / **My total**.

### On a bill (host and guests)

- **Edit bill** (host only): title, invite link, line items, discounts, service, tax; **Save bill to server** returns you to **My order** when save succeeds.
- **My order**: claim line items and quantities, then **Confirm my order** at the bottom.
- **My total**: your share from what you claimed (works before every line is assigned). Non-hosts see **Confirm paid** toward the host when they still owe; that writes a settled **payment** and updates **My debt**.
- **Who picked this** lists other people’s claims on each line (names from profiles).

### My debt

**My debt** (`/debts`) lists bills where you owe the host and still have a balance; **Confirm paid** there matches **My total** on each bill.

### Receipt AI (optional)

If `VITE_AI_API_URL` and `VITE_AI_API_KEY` are set, **Upload** / **Photo** on the new bill or add-items flow calls your workflow with a multipart field **`image`**. The response should normalize to JSON containing at least **`items`**, **`subtotal`**, and compatible discount/tax/service fields (see `src/services/ai.ts` and `ParsedReceipt` in `src/types/index.ts`). If the model returns a **`merchant`** string (or `store_name`, `vendor`, etc.), the app uses it to **suggest the bill title** when the title is still empty or a generic placeholder.

---

## Tech stack

- **React 19**, **React Router 7**, **TypeScript**
- **Tailwind CSS v4** + **Radix** UI primitives
- **Supabase JS** client (Auth, Postgres, Realtime where enabled)
- **Vite 8** + **vite-plugin-pwa** (installable PWA)

### Install on your phone (PWA)

Deploy over **HTTPS** (e.g. Vercel). The service worker registers automatically.

- **Android (Chrome):** open **Home** — when the browser is ready, an **Install app** card appears; tap it to add to the home screen.
- **iPhone / iPad:** there is no install button in the browser; use **Share → Add to Home Screen** (the Home screen shows the same hint when relevant).

Icons live in `public/` (`pwa-192x192.png`, `pwa-512x512.png`, maskable, Apple touch). Regenerate from `public/favicon.svg` after changing the logo:

```bash
npm run gen:pwa-assets
```

---

## Project layout (high level)

| Path | Role |
|------|------|
| `src/pages/` | Route screens (Home, Bill, New bill, Join, Auth, Debts) |
| `src/features/bill/` | Bill editor, assignments, totals |
| `src/context/` | Auth, bill, debt state |
| `src/services/` | Supabase client, AI parse, offline draft storage |
| `supabase/migrations/` | Schema, RLS, RPCs |

---

## Production build

```bash
npm run build
```

Serve the `dist/` folder with any static host or CDN. Configure Supabase **Authentication → URL Configuration** with your production site URL and redirect URLs.

---

## License

Private project; add a `LICENSE` file if you open-source it.
