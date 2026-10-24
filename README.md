# M-Interest website and admin dashboard

A server-rendered business website (Home, About, Laundry, Cyber café, optional Food menu, Contact, Privacy) with a **database-backed admin dashboard**. The owner changes prices, listings, contact details, WhatsApp number, opening hours and homepage text in the browser. No code edits or redeploys are needed for routine content.

No business facts are invented. Until the owner enters them, addresses, phone numbers, hours, prices and the food menu are simply not shown.

## Stack

| Part | Choice | Reason |
|---|---|---|
| Server | Node.js 22+ with Express 5 | One small process, no build step |
| Database | **PostgreSQL** (`pg` driver) | Data lives outside the web server, so hosts without a persistent disk (Render, etc.) work |
| Pages | Server-rendered HTML, about 2 KB of JavaScript | Fast on mobile data, good for SEO |
| Auth | scrypt password hashing, server-side sessions, CSRF tokens | No custom crypto |
| Images | Stored **in PostgreSQL** (max 1 MB each), served from `/uploads/<name>` | No disk needed. Fine for a small price list, not for a photo gallery |

## Run locally

You need a PostgreSQL database. Example on Kali/Debian:
```bash
sudo apt install -y postgresql
sudo systemctl start postgresql
sudo -u postgres psql -c "CREATE USER minterest WITH PASSWORD 'choose-a-password'" -c "CREATE DATABASE minterest OWNER minterest"
```
Then:
```bash
npm install
cp .env.example .env     # set DATABASE_URL=postgres://minterest:choose-a-password@localhost:5432/minterest
npm run create-admin     # creates tables on first run, asks for e-mail + password (hidden). First account is the owner.
npm run dev              # http://localhost:3000   admin: http://localhost:3000/admin
npm run seed:demo        # optional: clearly labelled "DEMO" listings (refuses to run in production)
```
Tests (they create and delete throw-away databases, so the user needs the CREATEDB right):
```bash
TEST_DATABASE_URL=postgres://postgres:password@localhost:5432/postgres npm test
```

## Creating the first administrator (no default password exists)

Choose one:

1. **Command line (recommended).** `npm run create-admin`. For scripted setup use `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin`.
2. **Browser, one time.** Set `SETUP_TOKEN` (24+ random characters) in the server environment, open `/admin/setup`, enter the token plus e-mail and password. The page returns 404 as soon as any administrator exists. Remove `SETUP_TOKEN` afterwards.

Passwords need at least 12 characters. Public registration does not exist. More people are added only with `npm run create-admin` (the second and later accounts are asked for a role: `owner` or `staff`).

## How to manage content (sign in at `/admin/login`)

Sign-in is rate limited and locks an account for 15 minutes after 5 wrong passwords. Sessions end after 2 idle hours or 12 hours in total.

**Laundry, Cyber café, Food menu** (left menu)
1. Open **Manage categories** and add a category first (for example "Washing"). Unticking *Visible* hides the whole category and its listings from the public.
2. **Add** a listing: name, category, description, price in KES (numbers only, `250` or `250.50`), pricing unit (per kg, per page, per hour…), conditions, optional image with description, availability, and publication status.
3. **Draft** listings are invisible everywhere on the public site and API. **Published** listings appear immediately.
4. In the list, use **Publish / Unpublish** for quick changes, **Preview** to see how a listing looks (administrators only), **Edit**, or **Delete** (a confirmation page appears first).
5. Use search, category and status filters to find listings.
6. "Show in Popular prices on the homepage" controls the homepage price board. Nothing is featured automatically.

Rules the system enforces: a published fixed-price listing needs a price and (outside food) a unit. "Contact us for pricing" listings can only be published after the owner ticks the approval box in Settings.

**Food menu.** Hidden completely (navigation, `/menu`, API, sitemap) until the owner ticks *Show the food menu* in Settings.

**Enquiries.** Contact-form messages appear here with a reference number. Set the status (New / In progress / Resolved / Archived), add internal notes, or delete (with confirmation). Archived enquiries are hidden from the default list.

**Settings (owner only).** Business name, WhatsApp number, phone, e-mail, address, town/area, opening hours (one line per entry), map link, social links, logo, homepage headline and introduction, verified value points, About text, mission/vision, the accent colour (orange or crimson), enquiry retention, and the privacy-review flag. Numbers are accepted in any common format and stored in international form (`0712 345 678` becomes `+254712345678`).

**Account.** Change your password. This signs out other devices.

The dashboard home lists what still needs attention (missing WhatsApp number, address, hours, unreviewed privacy notice, and so on).

## Deployment on Render (no disk needed)

1. Push this project to a (private) GitHub repository.
2. Render dashboard: **New -> PostgreSQL**. Create the database and copy its **Internal Database URL**. Check Render's current terms first: free databases have been time-limited, so use a paid database for a real business site, or use another managed PostgreSQL (Neon, Supabase, etc.) after checking its terms.
3. **New -> Web Service**, pick the repository. Language Node, Build Command `npm ci --omit=dev`, Start Command `npm start`, Health Check Path `/healthz`. Keep it at **one instance**. Do not attach a disk.
4. Environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `DATABASE_URL` | the Internal Database URL from step 2 |
| `SITE_URL` | `https://your-service.onrender.com` (later your own domain) |
| `SESSION_SECRET` | output of `openssl rand -base64 48` |
| `TRUST_PROXY` | `1` |
| `SETUP_TOKEN` | output of `openssl rand -base64 36` (temporary) |

5. Deploy. Tables are created automatically on start. Open `/admin/setup`, enter the token, create the owner account, then **delete `SETUP_TOKEN`** in Render and redeploy.
6. Sign in at `/admin/login` and fill in Settings and the price lists.
7. **Backups.** Use the database provider's backups, and also take your own dump now and then: `pg_dump "$DATABASE_URL" > backup.sql` (needs the external URL from a machine that can reach it). Test a restore once.
8. **Custom domain.** Add it under the web service's Custom Domains, create the DNS record Render shows, then change `SITE_URL`.

Elsewhere: any host that runs Node 22 and can reach a PostgreSQL database works. Set `DATABASE_SSL=require` if the provider needs TLS and the hostname auto-detection gets it wrong.

Free web services on Render sleep after inactivity, so the first visit after a quiet period is slow. A paid web instance stays awake.

## Security summary

Server-side authorization on every admin route; CSRF tokens on every admin POST and signed tokens on public forms; HttpOnly SameSite cookies; scrypt hashing with constant-time checks and lockout; rate limits on sign-in, contact form, setup and API; strict Content-Security-Policy (no inline scripts), frame denial, nosniff; all output HTML-escaped; parameterised SQL only; image uploads checked by magic bytes, limited to 1 MB, stored in the database under random names (SVG refused); admin pages are `no-store` and `noindex`; errors never reveal internals. Rate limits are in memory, so they reset on restart and assume one server process.

## Public JSON API (read only)

`GET /api/services[?section=laundry|cyber]`, `GET /api/services/:id`, `GET /api/menu` (only when enabled). Only published listings in visible categories are returned, with no internal fields. Enquiries have no public endpoint. All admin actions are the form routes under `/admin` (session + CSRF required).

## Project layout

`src/models` data and validation · `src/routes` public and admin handlers · `src/views` HTML templates · `src/migrations` SQL schema · `public` CSS/JS/fonts · `scripts` CLI tools · `tests` automated tests.

## Status

**Done and tested:** everything above, including the full cycle *create → edit price → publish → public page updates → unpublish → public page no longer shows it*, plus draft/API privacy, validation, uploads, roles, CSRF, lockout, setup flow, enquiries, WhatsApp links, SEO files and palette contrast.

**Depends on the owner or external setup:** real business details and price lists; logo and photos; domain, hosting and HTTPS; review of the privacy notice by the owner or a legal adviser (the site shows "awaiting review" until the flag is ticked); the enquiry retention period; database backups.

**Not built (not requested or not confirmed):** e-mail or SMS notifications for new enquiries (check the dashboard, or add a mail provider later); online booking or M-Pesa payments; Terms page (no bookings or payments exist); analytics; a user-management screen (use the CLI); field performance data (Core Web Vitals can only be measured after launch).

**Known limits:** manual accessibility review with a screen reader has not been done (semantic HTML, labels, focus styles, skip link and contrast are in place); one server process is assumed. Images are stored in the database, so keep them small and few.
