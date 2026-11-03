# Forum Labs customer website

Angular SSR customer website in the owner-requested `forum-website` folder. Uses the dependency manifest and lockfile from `../apps/web` without adding packages. The original `apps/web` starter is preserved.

## Run locally

```sh
cd /Users/gokul/forum/forum-website
npm ci --ignore-scripts
npm start -- --host 127.0.0.1 --port 4300 --no-hmr
```

Open http://127.0.0.1:4300. Checks:

```sh
npm run build
npm test -- --watch=false
```

## Customer journey

- Home and searchable/filterable tests and packages, individual detail routes with preparation, inclusions, parameters and eligibility.
- Guest cart, sign-in gate and six checkout steps matching `apps/mobile`: Patients → Address → Slot → Preparation → Coupon → Review.
- Desktop checkout has a persistent order summary. Phone checkout shows a collapsible summary before the current step, with Back/Continue fixed above the safe area.
- Phone navigation uses a 60px sticky logo/menu row, with keyboard dismissal and automatic closing after navigation. Home search and horizontally scrolling category shortcuts appear before the shorter hero; the illustration follows featured items. The catalog has compact list cards and an expandable Filter & sort panel. Floating cart appears only with items and is suppressed on Cart/Checkout to keep controls clear.
- Account has a profile summary and separate Personal details, Family members, Saved addresses and Privacy & help sections. Desktop uses a sidebar; phone navigation keeps all four sections visible. Profile details are read-only until Edit; adding a member/address opens a focused form with Save/Cancel and local feedback. Existing consent/guardian fields and manual collection addresses are retained. Adding an address can start from a search, the browser's location or (with a Maps key) a pin on a map; the API's `places/search` and `places/resolve` fill street, area and pincode and the pin's latitude and longitude are saved with the address. Editing the pincode by hand drops the pin so the two never disagree.
- Home banners under the hero, from the API's public `GET /home` (up to five). Each shows its eyebrow, headline, body and a button to the matching page (a test, a package, a category, all tests, help, bookings or reports; a coupon or "none" has no button). The picture is the banner's **website picture** (`web_image_url`, about 2:1, for example 1600 × 800 px, subject on the right), set in the admin beside the app's own picture; the app's tall 4:5 picture is never used here. A banner with no website picture is text on the purple gradient. The banners the API seeds when no admin banner exists are shown the same way. A failure reading them hides the strip and never blocks the catalogue.
- My bookings with server tracking events, and released reports with fresh authenticated document-link requests and access auditing.
- Explicit empty/error/refusal states, terms/privacy information and help page. No online payment: cash or UPI at collection.

## Preview and live configuration

`src/app/core/public-config.ts` is set to `mode: 'live'`: the site reads the real catalogue from the API. Setting `mode: 'preview'` with empty API values switches to the preview described here. Preview uses only the app's existing sample catalog, fictional people and fixed example slots. It makes no API calls and ends with **Preview complete**, never a fake booking confirmation. Forms for real personal details are hidden in preview.

The live API adapter is connected to the Cloud Run API and the catalogue is verified in a real browser; sign-in and booking are **not proven end to end**. Live mode needs only these public values:

- `mode: 'live'`
- `apiBaseUrl`: the existing NestJS base including `/v1`
- `supabaseUrl`: the existing project's HTTPS URL
- `publishableKey`: a Supabase `sb_publishable_…` public key
- `mapsApiKey` (optional): a Google Maps browser key that turns on the map in the address form. Empty keeps the map off; search and "Use my location" still work. Create it in Google Cloud and restrict it to the HTTP referrer `https://gokulnarayana-30.github.io/forum-website/*` and to the **Maps JavaScript API** only. It is public by design, like the Supabase publishable key; the referrer restriction is what protects it. Google bills map loads to the project, and the map loads only when a customer chooses "Pick on the map".

Never add secrets, service-role keys or database URLs. No `.env` is needed or read by this website. API business data goes only through NestJS; Supabase is used only for Google Auth. API failures in live mode never fall back to sample catalog data.

The owner must allow the website origin in the API's `CORS_ORIGINS` and the exact website `/auth/callback` URL in Supabase's redirect allowlist. Local `127.0.0.1:4300` is a different origin from the existing admin's `localhost:4200`. These external settings were not changed. Also add the exact deployment hostname to `angular.json` → build options → security → allowedHosts; the local build permits only localhost and 127.0.0.1.

The SDK-free Google PKCE implementation follows the API's existing `public-deletion-client.ts`. The sign-in session is kept in this tab's `sessionStorage` (erased when the tab or browser closes, never in local storage): a refresh stays signed in, and the token is renewed with its single-use refresh token, one renewal at a time. A refused refresh token, or sign-out, erases it. A short-lived PKCE verifier, guest item IDs and unresolved checkout key/account ID can use sessionStorage. Patient names, addresses, report links and diagnostic-consent records are not persisted there.

## Booking safety

Live prices, eligibility, collection fees, coupons and capacity are owned by the server. Booking uses server cart/quote/address/slot IDs, not a client-calculated total. Address changes clear the slot. Review requires preparation acknowledgement and explicit diagnostic consent, without marketing opt-in.

One placement attempt freezes its body and idempotency key in memory. A lost response is recovered using `/checkout/attempts/{key}/order` before retrying the exact same POST. The UI locks edits while that outcome is unresolved. Only an actual `order_placed` response or recovered server order creates a confirmation. Expired quotes/holds and business refusals cannot become confirmation screens.

Only the key/account ID is retained across reload. If a recovered attempt has no server order yet, the website blocks a fresh POST because the original consent record is intentionally not persisted. Check My bookings/support to resolve it. This deliberately conservative recovery path needs live verification before launch.

## Remaining launch work

- Configure and verify the real API, Google callback, CORS, public key and hospital-approved terms, privacy, diagnostic-consent wording and contact details. Current legal copy is explicitly marked as development copy.
- Run DB and e2e proof in Phase 17. These checks have not been performed here.
- Finish secondary parity: editing/removing saved family/addresses, coupon discovery, server-side alias/symptom search, doctor attribution picker, cancellation/rescheduling/recollection actions, receipts, support tickets and notification preferences. Current booking tracking is read-only; Help sends no messages.
- Cross-device and accessibility verification, session-expiry UX and uncertain-attempt recovery should be reviewed before public use. No production-readiness claim is made.

Follow `../docs/DECISIONS.md`, `../docs/design/BRAND.md` and `../AGENTS.md`. This owner-requested website work is outside the numbered phase plans; no roadmap phase is marked complete.
