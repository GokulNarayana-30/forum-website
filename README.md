# Forum Labs website

Local customer website, created at the owner's request while mobile app work continues. Uses the existing Angular SSR starter from `../apps/web`, with its dependency manifest and lockfile unchanged. `apps/web` remains untouched; this is the requested working folder.

## Run

```sh
cd /Users/gokul/forum/forum-website
npm ci --ignore-scripts
npm start -- --port 4300
```

Open http://localhost:4300. Production check: `npm run build`.

## First version

Responsive Forum-branded homepage with bundled Montserrat and existing mobile brand illustrations; searchable illustrative test cards, category filters, expandable details, collection explanation and FAQs. No remote fonts or asset services.

This is a local UI preview. The test selection is explicitly illustrative. Sign-in, live catalog/prices, serviceability, slots, bookings and report access still need implementation against the existing NestJS API. Booking buttons explain this limitation and never create a booking. No patient data is collected or stored. Payment remains cash or UPI at collection.

Keep Angular SSR for indexable catalog pages. Use Supabase Auth for identity and call only `apps/api` for business data and external services. Follow `../docs/DECISIONS.md` and `../docs/design/BRAND.md`. No database or e2e runs before Phase 17. No new packages were introduced for this starter.
