# RedChili

Arabic-first, bilingual QR ordering for a Saudi dine-in restaurant. React, TypeScript, Vite and Supabase, with Node.js for builds, catalog seeding and integration tests. Cloudflare Workers serves the web app and its assets. The order API uses Supabase Postgres functions so checkout, edits, and table payments commit together.

- Guests can browse 45 dishes, open details, add quantities and notes, confirm the QR table and submit for an order number. Payments happen at the cashier.
- Staff sign in with email, password and TOTP. The cashier can see, edit, cancel, and print orders, record a combined table payment, and review paid or cancelled orders. A ticket marked prepared has been opened for printing. Confirm that it actually printed at the cashier station.
- Admins can change photos, descriptions, names, prices, display order, category, and visibility. They can add tables and generate, disable, or replace QR codes.

## Preview and checks

Use Node.js 24 LTS.

```sh
npm ci
npm run dev
npm test
npm run build
```

Without a Supabase URL and publishable key the app opens the browse-only menu. The database integration test runs the real migration and catalog against embedded Postgres, with stand-ins for Supabase auth claims and storage metadata.

## Deploy the connected restaurant app

1. Create a Supabase project in the nearest suitable available region. In Authentication settings, disable new user signups and keep email/password and TOTP enabled. Use the SQL Editor to execute `supabase/migrations/202611110001_ordering.sql` once, then `supabase/seed.sql`. The seed inserts only missing catalog IDs, preserving edits.
2. Create individual users in Authentication → Users and record their UUIDs. From the SQL Editor grant the restaurant's users their roles with `insert into public.staff (id, role) values ('USER_UUID', 'admin');` or use `'cashier'`. Remove a row to revoke staff privileges. Use Supabase's Auth dashboard for account recovery or MFA resets. Set up custom SMTP before using email invites or password reset email.
3. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from project settings. The browser only needs the publishable key. Keep any service key out of the frontend and Git.
4. Sign into Cloudflare with `npx wrangler login`, then run `npm run deploy`. Set the permanent domain before printing table cards. In a Cloudflare Git build, set the two Vite variables in **build variables** and use `npm run deploy` as the deploy command.
5. Sign in at `/admin`, enroll in TOTP, and create the restaurant's actual table labels under **Tables and QR codes**. Add one pilot table first. Test with a separate guest phone and cashier browser, print a bilingual ticket on the restaurant printer (80 mm recommended), and record a test payment. The print dialog uses the cashier's configured printer and paper size.
6. Review the catalog with the restaurant before opening orders. The seed uses the supplied RedChili preview's item data, SAR prices and photos. Verify price, nutrition and image reuse with the restaurant. The kitchen printout is for food preparation. Issue any required customer tax invoice through the restaurant's POS.

To regenerate the SQL seed from `catalog.json`, run `node scripts/seed.mjs`.
