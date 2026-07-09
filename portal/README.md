# Enrollment Portal

Next.js 15 App Router · React 19 · Tailwind v4 · shadcn/ui (shell copied from
the OS app for visual parity) · next-intl (English catalog, locale-ready).

## Run

```bash
pnpm install --ignore-scripts
pnpm dev            # http://localhost:3000
```

No backend or env vars needed — **all data lives in a localStorage mock API**
(`lib/api/`), seeded with demo families in every pipeline state. Reset from
the login page ("Reset demo data").

## Sign in (dev role switcher)

`/login` offers seeded identities per role — parent (3 families in different
states), student, AFA admin, network-school admin, central admin, finance
admin. Real ibl.ai SSO is a planned swap via the `/iblai-vibe-auth` skill;
everything reads `useSession()` so the swap is contained in `lib/session.tsx`.

## Demo walkthrough

1. **Apply:** open `/apply/<school-name>` (or `/apply/<school-name2>` — different
   branding, questions, fees, interview workflow, all from
   `lib/schools/*.ts`). Multi-step wizard: family → students (repeatable,
   grades 3–12 get student questions) → agreements/signatures → review, mock
   fee payment, submit.
2. **Admin:** sign in as an admin → pipeline dashboard → applications table
   (search/filter/sort) → open the family: notes, interview (Grace), request
   info, status changes, accept with school-template preview.
3. **Parent:** decision notice, sign outstanding waivers, upload documents,
   choose a payment plan (invoices generate), pay invoices, see holds.
4. **Placement/courses:** admin bulk-assigns tests → student "takes" them
   from `/student` → admin reviews/overrides/confirms → assigns courses with
   start dates → student sees active/locked course tiles.
5. **Re-enroll:** enrolled family's dashboard → "Re-enroll for next year"
   (pre-filled draft, grades bumped, waivers renewed).

## Commands

```bash
pnpm dev / build / start
pnpm typecheck      # tsgo (TypeScript native preview)
pnpm lint           # oxlint
pnpm format         # oxfmt
pnpm check          # API workflow self-check (status machine, fee/interview
                    # gates, SIS side-effects, privacy projection) + i18n audit
```

## Where things live

| Path                                   | What                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `lib/types.ts`, `lib/status.ts`        | Domain model + status machine (gates enforced in the API layer)                  |
| `lib/api/`                             | Mock API — the only data access path; REST-shaped for the backend swap (PLAN §8) |
| `lib/schools/`                         | Per-school application config — drives the wizard                                |
| `components/shell/`                    | OS-parity sidebar + header                                                       |
| `components/apply/`                    | Config-driven application wizard                                                 |
| `app/(portal)/{parent,student,admin}/` | Role portals                                                                     |

## Integration points (stubbed, marked `ponytail:` in code)

Payments (Stripe), email/SMS, real SIS/ontology sync, IBL AI placement
delivery, file storage, ibl.ai SSO, school-config self-service editing,
dark mode.
