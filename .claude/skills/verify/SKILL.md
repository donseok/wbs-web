---
name: verify
description: How to verify wbs-web changes at runtime in this sandbox (no live browser to localhost)
---

# Verifying wbs-web changes

The Claude-in-Chrome browser cannot reach `localhost` from this sandbox, and most
routes require a real Supabase session (middleware redirects to `/login` otherwise),
so `curl`-ing protected pages only proves the server boots — it can't show you
authenticated page content.

## Recipe

1. `npm run build` — full compile + type check + static generation.
2. `npm run lint`
3. For client components (`'use client'`), drive the REAL component tree with
   `createRoot` + `act` in a jsdom test, using the project's real providers
   (e.g. `LocaleProvider` from `@/components/providers/LocaleProvider`, not a
   mocked `t()`) so i18n key-wiring bugs surface. Vitest only picks up files
   under `tests/**/*.test.{ts,tsx}` (see `vitest.config`) — write your
   verification file there (e.g. `tests/ui/_scratch-*.test.tsx`) and delete it
   after running; don't rely solely on an author-written test in the diff,
   since that's the author's own evidence, not independent verification.
   See `tests/ui/header-chrome-breadcrumb.test.tsx` for the harness pattern
   (mock `next/navigation`, `next/link`, data-fetching server actions;
   `@vitest-environment jsdom` per file).
4. `npm run dev`, then `curl -D -` a couple of routes as a boot sanity check —
   confirms no runtime crash and that middleware/auth redirects behave as
   expected. Won't show authenticated content without a real session cookie.
5. `npm test` (full suite) as a regression check once you've independently
   driven the actual change.

## Gotchas

- jsdom's `offsetParent` is always `null` — visibility-filtered focusable
  queries fall back to container elements; assert "focus landed inside X",
  not "focus on specific button".
- `'use client'` components still SSR — Next.js renders their initial HTML
  server-side (no `ssr: false` dynamic import here), so curl output would
  reflect them correctly *if* the route weren't auth-gated.
