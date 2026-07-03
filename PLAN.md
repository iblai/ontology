# Registration & Enrollment Portal — UI Implementation Plan

**Audience:** junior developers implementing the portal UI.
**Source of truth for requirements:** `Registration_and_Enrollment_Portal_Requirements.pdf` (repo root). Section references below (e.g. "PDF §2.1") point into that document — read the section before building the page it drives.
**Visual source of truth:** the OS app at `../../os/main` — the portal must use the **same left sidebar and header** design.
**Design system / skills:** `../../vibe/main` (BRAND.md + `/iblai-vibe-*` Claude Code skills).

---

## 1. What we are building

A unified registration & enrollment portal for two school models on one codebase (PDF §1):

- **American Faith Academy (AFA)** — fully online school.
- **Ministry.com Network Schools** — independently branded hybrid schools, each with its own application link, logo, fees, programs, and agreements (PDF §4).

The portal covers the full pipeline: family applies → admin reviews & decides (interview workflow for network schools) → accepted family sets up payment plan → records populate the SIS → placement testing → course enrollment (PDF §2, §14).

### Roles (PDF §13)

| Role | Sees |
|---|---|
| Parent/Guardian | Apply, documents, signatures, fees, status, payment plans, family billing, child enrollment |
| Student | Placement tests, assigned courses, course access. **Never family financial info** (PDF §10) |
| AFA Administrator | AFA applications, notes, decisions, billing, placement, course enrollment |
| Network School Administrator | Their school's applications, interviews, decisions, local fees/plans, placement, enrollment |
| Central Ministry.com Administrator | System-wide config, all schools, permissions, reporting, SIS oversight |
| Finance Administrator | Tuition, fees, plans, late fees, credits, refunds, funding sources, invoices, reporting |

---

## 2. Decisions already made (do not re-litigate)

1. **Location:** new self-contained Next.js app in **`portal/`** in this repo. The rest of this repo is a Python backend (the ontology knowledge layer) — do not touch it. The compose `admin-dashboard` service is unrelated to this portal.
2. **Stack (match the OS repo):** Next.js **15.5.x** (App Router), React **19.1**, Tailwind **v4**, **shadcn/ui** (new-york), **lucide-react** icons, **react-hook-form + zod** for forms, **@tanstack/react-table** for the admin tables, **sonner** for toasts, **pnpm@10** (`packageManager` field). TypeScript strict.
3. **No backend exists for this product yet.** All data goes through **one typed mock API module** (`lib/api/`) that persists to `localStorage` and is seeded with fixture data. Function signatures are `async` and shaped like the future REST API so the swap later is mechanical. **No component may touch `localStorage` or seed data directly — everything goes through `lib/api`.**
4. **Auth is stubbed** with a dev role-switcher (see §7). Real ibl.ai SSO gets wired later via the `/iblai-vibe-auth` skill when platform credentials exist. Build every page against the `useSession()` hook so the swap is one file.
5. **School-config-driven forms, not a form builder.** AFA and Network School applications differ (PDF §3 vs §4). Model the differences as **two typed constant objects** in `lib/schools/` consumed by one shared wizard renderer. Do **not** build a database-driven form designer.
6. **Skipped on purpose** (integration points, marked in code with `// ponytail:` comments): real payment processor (Stripe), real SIS sync, real IBL AI placement engine, real email sending, real file storage, i18n (English only — no next-intl), Redux (plain React state + the api module). Each has a stub with a clearly named function in `lib/api/` so wiring later is localized.

---

## 3. Repo layout to create

```
portal/
  package.json                  # name: "enrollment-portal" (lowercase), pnpm@10
  next.config.ts
  tsconfig.json
  postcss.config.mjs
  components.json               # shadcn config (new-york, CSS variables)
  .env.example                  # empty for now; future NEXT_PUBLIC_* vars land here
  app/
    globals.css                 # theme — see §5
    layout.tsx                  # html/body + fonts + Toaster + SessionProvider
    page.tsx                    # redirect: role-aware → /parent, /student, /admin, or /login
    login/page.tsx              # dev role-switcher (see §7)
    apply/[school]/page.tsx     # PUBLIC application wizard (no shell) — §9.1
    apply/[school]/status/page.tsx  # post-submit confirmation w/ application ID
    (portal)/                   # everything below shares the OS-style shell
      layout.tsx                # SidebarProvider + AppSidebar + SidebarInset + NavBar
      parent/                   # §9.2
        page.tsx                # parent dashboard
        applications/[id]/page.tsx
        billing/page.tsx
        billing/plans/page.tsx
        documents/page.tsx
        notifications/page.tsx
      student/                  # §9.3
        page.tsx                # student dashboard
      admin/                    # §9.4–9.8
        page.tsx                # admissions pipeline dashboard
        applications/page.tsx   # table: search/sort/filter
        applications/[id]/page.tsx  # review workspace
        interviews/page.tsx
        billing/page.tsx        # finance: ledgers, invoices, holds
        billing/config/page.tsx # tuition/fees/plans per school
        placement/page.tsx
        courses/page.tsx        # course enrollment mgmt
        sis/page.tsx            # SIS records preview + dedupe flags
        schools/page.tsx        # central admin: per-school config
        communications/page.tsx # nice-to-have, M8
  components/
    ui/                         # shadcn components (generated + sidebar.tsx copied from OS)
    shell/                      # app-sidebar.tsx, nav-bar.tsx, nav-config.ts
    shared/                     # StatusBadge, Stepper, FileUploadStub, SignatureBlock,
                                # CurrencyText, EmptyState, ConfirmDialog, DataTable
  lib/
    types.ts                    # entire domain model — see §6
    api/                        # mock API — see §8
      index.ts                  # public surface (the only import components use)
      store.ts                  # localStorage read/write + seed bootstrap
      seed.ts                   # fixture data
    schools/
      afa.ts                    # AFA application config (PDF §3)
      grace-network.ts          # example network school (PDF §4)
      index.ts                  # registry: slug → SchoolConfig
    status.ts                   # status machine — see §6.1
    session.tsx                 # useSession() + SessionProvider + role guards
    utils.ts                    # cn() etc. (shadcn standard)
  e2e/                          # Playwright happy-path — see §11
  public/
    afa-logo.svg  grace-logo.svg  iblai-logo.png (copy from ../../os/main/public/)
```

---

## 4. Milestones

Work top to bottom; M2 unblocks everything else. Each milestone ends with `pnpm typecheck && pnpm lint && pnpm build` green and the listed acceptance checks done in the browser.

| # | Milestone | Depends on | Size |
|---|---|---|---|
| M0 | Scaffold + theme | — | S |
| M1 | App shell: sidebar + header (OS parity) | M0 | M |
| M2 | Domain model + mock API + seed + session/roles | M0 | M |
| M3 | Public application wizard (AFA + network config) | M1, M2 | L |
| M4 | Admin admissions: pipeline table + review workspace + decisions + interviews | M2, M3 | L |
| M5 | Parent portal: dashboard, application detail, decision notices, enrollment steps | M3, M4 | M |
| M6 | Billing: fee config, payment plans, family ledger, invoices, finance admin | M4 | L |
| M7 | Placement testing + course enrollment + student dashboard | M4 | M |
| M8 | Re-enrollment, communications log, notifications, polish + e2e | M5–M7 | M |

Two people can parallelize after M2: one on M3→M5 (family-facing), one on M4→M6/M7 (admin-facing).

---

### M0 — Scaffold + theme

1. From repo root: `mkdir portal && cd portal`, then scaffold **inside** it:
   ```bash
   pnpm create next-app@15.5.18 . --ts --eslint --tailwind --app --no-src-dir --import-alias "@/*" --yes
   pnpm install --ignore-scripts        # vibe policy: always --ignore-scripts
   npx shadcn@latest init -y            # style: new-york, base color: neutral, CSS variables
   npx shadcn@latest add button card input label select textarea checkbox radio-group \
     dialog dropdown-menu sheet tooltip separator badge table tabs accordion sonner \
     form popover calendar command avatar skeleton alert alert-dialog progress
   pnpm add lucide-react react-hook-form zod @hookform/resolvers @tanstack/react-table date-fns
   ```
2. Copy from the OS repo (visual parity comes from using their exact primitives):
   - `../../os/main/components/ui/sidebar.tsx` → `portal/components/ui/sidebar.tsx` (shadcn Sidebar; constants: expanded `16rem`, icon rail `4rem`, mobile sheet `18rem`, cookie `sidebar_state`, keyboard shortcut `b`)
   - `../../os/main/hooks/use-mobile.ts` (or wherever `useIsMobile` lives — grep for it) → `portal/hooks/use-mobile.ts`
   - `../../os/main/public/iblai-logo.png` → `portal/public/`
3. Theme in `app/globals.css`: shadcn OKLCH variables, mapped to the ibl.ai brand per `../../vibe/main/BRAND.md`:
   - `--primary: oklch(0.492 0.194 259.3)` (ibl blue `#0058cc`), `--radius: 0.625rem`
   - status colors: success `#10b981`, warning `#f59e0b`, error `#ef4444`, info `#3b82f6`
   - font: Open Sans via `next/font` exactly like `../../os/main/app/layout.tsx` (`openSans.variable` on `<body>`, `antialiased`)
   - light mode only for now (`// ponytail: dark mode deferred — add .dark block when asked`)
4. Root `app/layout.tsx`: fonts + `<Toaster />` (sonner) + `SessionProvider` (M2 delivers it; stub until then).

**Accept:** `pnpm dev` renders a page at `localhost:3000`; shadcn `bg-primary` button renders **ibl blue**, not black.

---

### M1 — App shell (same sidebar + header as OS)

Reference implementation (read these files, copy the structure and class strings):

| What | OS file |
|---|---|
| Layout composition | `../../os/main/app/platform/_components/app-layout.tsx` |
| Sidebar | `../../os/main/app/platform/[tenantKey]/[mentorId]/_components/app-sidebar/index.tsx` |
| Sidebar footer | `.../app-sidebar/app-sidebar-footer.tsx` |
| Header | `../../os/main/app/platform/[tenantKey]/[mentorId]/_components/nav-bar/index.tsx` |
| Nav item config shape | `../../os/main/hooks/user-navigate.ts` (lines ~491–646) |

Build in `components/shell/`:

1. **`(portal)/layout.tsx`** — composition (matches OS `app-layout.tsx`):
   ```tsx
   <SidebarProvider defaultOpen={defaultOpen /* from sidebar_state cookie */}>
     <AppSidebar />
     <SidebarInset asChild className="flex h-dvh flex-col overflow-hidden">
       <div>
         <NavBar />
         <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
       </div>
     </SidebarInset>
   </SidebarProvider>
   ```
2. **`app-sidebar.tsx`** — `<Sidebar collapsible="icon" variant="sidebar">`, container `flex flex-col border-r border-[#e9e9ea]`, inner `bg-[#fafafa]`:
   - **Header:** wrapper `shrink-0 px-[10px] py-[10px]`; school/portal logo `h-[51px] w-auto object-contain`; collapse button `inline-flex size-7 rounded-md text-[#7d7e82] hover:bg-[#f0f0f0]`.
   - **Body:** `<nav className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">` with `space-y-0.5` groups. Nav item: `flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] font-normal text-gray-700`; icon `h-5 w-5 shrink-0`; label `min-w-0 flex-1 truncate`. **Active item:** `bg-[#cfe8fa]/40 hover:bg-[#cfe8fa]/50` (match by pathname; `exact` flag for index routes).
   - **Footer:** `shrink-0 border-t border-[#e2e8f0] px-2 py-3`; items `flex h-9 items-center gap-2 rounded-md px-2 text-[14px] text-[#5f5f61] hover:bg-[#f4f4f4]` — Notifications (Bell), Settings (Settings), and the user avatar row.
   - Collapsed rail: icons only, centered (`flex flex-col items-center gap-1`); width comes from the copied sidebar.tsx (`4rem`).
   - Mobile: the copied shadcn sidebar already renders a `<Sheet>` drawer; the header hamburger calls `toggleSidebar()`.
3. **`nav-config.ts`** — nav items per role, same shape as OS:
   ```ts
   type NavItem = { id: string; label: string; icon: LucideIcon; href: string;
                    exact?: boolean; roles: Role[] };
   ```
   - **Parent:** Dashboard `/parent`, Applications, Billing, Documents, Notifications.
   - **Student:** Dashboard `/student` (that's all — PDF §10).
   - **Admins:** Dashboard `/admin`, Applications, Interviews (network-school + central only), Billing, Placement, Courses, SIS Records, Schools (central only), Communications. Finance admin sees only Dashboard + Billing.
   Filter by `useSession().role`. Icons: `LayoutDashboard, FileText, CalendarCheck, CreditCard, ClipboardCheck, BookOpen, Database, School, Mail, Bell, Settings`.
4. **`nav-bar.tsx`** — header, OS classes verbatim: `z-10 flex h-16 shrink-0 items-center border-b border-[#D0E0FF] bg-white pr-4`. Contents: mobile hamburger (`ml-4`, `Menu` icon, hidden on desktop), page title (left), spacer, then right side: school switcher dropdown (central admin only), notification bell with unread-count badge, profile dropdown (`text-sm font-medium text-[#646464]`, avatar + name + `ChevronDown h-4 w-4 text-gray-500`) with items Profile / Switch role (dev) / Sign out.

**Accept:** shell side-by-side with the OS app looks the same (widths 256px/64px, `#fafafa` sidebar, `#e9e9ea` border, light-blue `#cfe8fa` active state, 64px white header with `#D0E0FF` border). Collapse persists via cookie across reloads; keyboard `b` toggles; mobile (<768px) shows the sheet drawer.

---

### M2 — Domain model, mock API, seed, session

Deliver `lib/types.ts` (§6), `lib/status.ts` (§6.1), `lib/api/` (§8), `lib/schools/` (§10), `lib/session.tsx` (§7), and seed data:

**Seed (`lib/api/seed.ts`):** 2 schools (AFA + Grace Network School), ~10 families / ~18 students spread across every status, fees paid/unpaid/waived, one interview pending, two accepted families with payment plans (one monthly, one paid-in-full), placement tests in every placement status, 2 enrolled students with courses, an internal note + status history on several applications, sample notifications, one financial hold. Every admin screen must have something to show from day one.

**Accept:** a `lib/api/__demo__.ts` (or small vitest file) exercises: create draft → submit (fee-gated) → status transitions log history → accept → SIS records created → decline creates **no** SIS record (PDF §2.5). Run it with `pnpm tsx` or vitest — it must pass.

---

### M3 — Public application wizard (`/apply/[school]`) — PDF §2.1, §3, §4, §5, §6

The most important screen in the product. One wizard component, driven entirely by `SchoolConfig`. No shell — instead a minimal branded header: school logo + name + "2026–2027 Enrollment" (school-configurable `programYear`), school `accentColor` on the progress stepper and primary buttons.

**Steps** (stepper across the top; back/next; every step autosaves the draft):

1. **Welcome / account** — school intro text; enter parent email + student count; "Resume a saved application?" (looks up drafts by email). Creates a `Draft` application (PDF: "Allow families to save a draft and return later").
2. **Family** — parent/guardian 1 (required) + parent/guardian 2 (optional, collapsible), home address; **AFA:** referral questions; **both:** faith/background essays (from `config.familyQuestions`). Exact field lists live in `SchoolConfig` — transcribe them from PDF §3 (AFA) / §4 (network) verbatim.
3. **Students** — repeatable cards ("Add another student"): legal name, (network: preferred name), email (**required for grades 3–12**, AFA), DOB → **age auto-calculated and displayed**, gender, grade level entering (K–12 select), program selection (AFA: Full Academic / SOAR Essentials / Individual Course + course picker; network: Academic / Enrichment / Guided Study), support-information textarea, academic background question set (from config). **Grades 3–12 only:** the student-response question set (from config) — hidden entirely for K–2 (PDF §3 "should not display for students entering kindergarten through second grade").
4. **Agreements & signatures** — acknowledgment checkboxes from `config.agreements`, each with its linked document (Statement of Faith, Honor Code, handbook — `href` to school site); network schools add Medical Release fields (emergency contact, physician, insurance — PDF §4) and Photo/Media Release **Yes/No radio**; signature block(s): full name + typed electronic signature + auto date (primary parent always; co-parent/student rows when `config.signatures` requires). Record handbook `version` acknowledged (PDF §6).
5. **Review & fee** — read-only summary of every section with "Edit" links back to steps; fee panel: amount from config (`perFamily` or `perStudent × n`, late fee if past `lateFeeAfter`), refundability label; **Pay & Submit** button → mock payment dialog (card form, any input succeeds; `// ponytail: mock processor — swap for Stripe`) → `api.submitApplication()`.
6. **Confirmation** (`/apply/[school]/status`) — application ID (e.g. `AFA-2026-0042`), per-student summary, "what happens next" copy, link to the parent portal.

**Validation:** zod schema per step; a step cannot advance with invalid required fields; the wizard cannot submit unless every required item is complete (PDF §2.1 acceptance criteria). Field-level errors inline under inputs.

**Accept:** can submit a 2-student AFA application end-to-end; draft survives a page reload at every step; K–2 student shows no student-response questions; submission blocked until agreements checked, signature entered, fee paid; unique application ID displayed; the two school slugs render different branding, fields, programs, and fees from config alone.

---

### M4 — Admin admissions — PDF §2.2, §2.3, §8

**`/admin` (pipeline dashboard):** stat cards per status (counts: started, submitted, incomplete, under review, interview required, accepted, declined, waitlisted, enrolled) — each card links to the filtered table; "needs attention" list (missing items, interviews due).

**`/admin/applications`:** tanstack table of **student applications** (one row per student; family groupable): columns ID, student, grade, parent, school/program, submitted date, fee status, status badge, missing-items icons (docs/waivers/signature/fee — tooltip per PDF §8). Search (parent/student name), filters (status, school, grade, program), sortable columns (PDF §2.2). School admins see only their school; central admin sees all + school filter.

**`/admin/applications/[id]` (review workspace):** the whole family application:
- Header: family name, application ID, status badge, **status-change dropdown** (only legal transitions per §6.1, each prompts optional note), "Request missing information" action (records a request + notification to parent, sets `Incomplete`).
- Tabs: **Household** (parents, address, family essays) · **Students** (per-student accordion: all answers, program, per-student status override — PDF §2.2 "family or individual student level") · **Documents & Agreements** (uploads list, waivers/acknowledgments with checked state + handbook version, signatures, fee payment state + admin **waive fee** action) · **Interview** (network schools: mark Interview Required, private interview notes, outcome buttons: Proceed to acceptance / Request more info / Decline / Waitlist — PDF §2.3; acceptance blocked while an interview requirement is open unless admin waives it) · **Notes** (internal notes: author + timestamp; banner: "Internal — never visible to families") · **History** (every status change: date, time, user — PDF §2.2 acceptance criteria).
- **Decision actions:** Accept / Decline / Waitlist (per student or whole family) → confirmation dialog previewing the school-specific template (from `config.decisionTemplates`, `{{studentName}}` etc. interpolated) → records decision, sends portal notification, logs template + timestamp (PDF §2.4), creates SIS records on accept (PDF §2.5).

**`/admin/interviews`:** queue of applications in `Interview Required` — family, school, requested date, notes link, outcome shortcuts.

**`/admin/sis`:** table of SIS parent/student records created on acceptance; sibling links under one family/billing account; **duplicate flags** (same name+DOB heuristic) with "merge / keep both" stub actions; banner stating declined/waitlisted students are never created here (PDF §2.5).

**Accept:** full happy path in browser: submitted app → under review → add internal note (invisible in any parent view — check) → require interview (network school) → record outcome → accept → decision notice visible to parent + SIS records appear + history shows every hop with user/timestamp.

---### M5 — Parent portal — PDF §2.4, §10

**`/parent` (dashboard):** one card per child: name, school, grade, program, status badge, progress checklist (application → decision → enrollment → placement → enrolled), next-action button (Resume draft / View decision / Choose payment plan / View courses). Family-level banner for unread decisions or requests for information.

**`/parent/applications/[id]`:** read-only application view (no internal notes, no interview notes — verify by role in the mock API, not just UI hiding); status + history (public-safe entries only); missing-items checklist with **document upload** (FileUploadStub: name+size recorded), outstanding waivers to sign, unpaid fee "Pay now"; **decision notice** panel (rendered template, sent date) when decided (PDF §2.4).

**Enrollment steps (accepted students):** on the dashboard card — checklist: sign remaining enrollment agreements → choose payment plan (M6) → then status auto-moves `Enrollment In Progress` → `Enrolled` when placement/course steps complete (M7).

**`/parent/documents`:** all family uploads + signed agreements + handbook links & acknowledged versions (PDF §6, §10).

**`/parent/notifications`:** list (decision sent, info requested, invoice due, placement assigned); bell in header shows unread count.

**Accept:** parent of the seeded 2-student family sees both children, opens the acceptance notice, uploads a document, signs an outstanding waiver, and **cannot see** internal/interview notes even via the API layer.

---

### M6 — Billing & finance — PDF §5, §7

**`/admin/billing/config`** (finance + school admins): per school — application/registration fee (amount, per family|student, refundable|nonrefundable|creditable, late fee + date), **tuition matrix** (by grade band × program × year), one-time/recurring fee catalog (curriculum, supply, facility, lunch, field trip, activity, technology, other — PDF §7), payment-plan options (pay-in-full, 2×, quarterly, monthly + due dates).

**`/parent/billing/plans`** (accepted families): consolidated family view — per-student tuition+fees breakdown, family total, plan options with computed schedules (annual obligation, per-installment amount, due dates — PDF §7.1), financial-policies acknowledgment checkbox **required before activating**, confirm → plan active + invoices generated.

**`/parent/billing`:** family balance, upcoming installment, invoice list (status: paid/due/overdue), payment history (amount, date, method, funding source), sibling charges in one account (PDF §14), "Make a payment" → mock processor dialog.

**`/admin/billing`** (finance admin home): family accounts table (balance, plan, overdue flag, hold flag) → family ledger detail: every charge/payment/credit line with funding source (parent-paid, ESA, SGO, scholarship, grant, third-party, credit — PDF §7); actions: add charge, record **offline payment**, apply discount/scholarship/credit, waive/refund/credit a fee (reason required), apply late fee, **place/release financial hold**, send invoice/reminder (logged, not actually emailed). Every adjustment logs admin name + date + amount (PDF §7 "All financial adjustments must be logged").

**Accept:** accepted seed family selects monthly plan → invoices appear; finance admin waives a fee, applies an ESA-funded payment, places a hold (banner appears on the parent dashboard); every adjustment shows in an audit list with name/date/amount.

---

### M7 — Placement testing + course enrollment + student dashboard — PDF §9, §10

**`/admin/placement`:** table of accepted/enrolling students × (Math, Language Arts): status chips `Not Assigned → Assigned → Started → Completed → Reviewed → Placement Confirmed`; assign individually or **bulk** (checkbox rows → "Assign placement tests"); completed rows show mock IBL AI result: recommended course + starting point ("Math 6, Unit 3") with admin **override** (course/start-point selects) and **Confirm placement** (writes to SIS record + enrollment record — PDF §9.1). Math and LA placements are independent.

**`/admin/courses`:** enrollment manager — per student: placement-suggested courses preselected + grade-level courses/electives catalog (static list in seed), start date picker (immediate or future), bulk assign, changes allowed post-start (PDF §9.2).

**`/student`:** student dashboard (PDF §10) — assigned placement tests ("Start test" advances the mock status; `// ponytail: fake test runner — integration point for IBL AI assessments`), placement completion status, course tiles (name, start date, active vs "Available on {date}" lock state), school announcements (from school config). **No financial data anywhere on this route group.**

**Parent mirror:** placement status + course list per child appears on the parent application detail (PDF §9.2 acceptance: "Parents see each child's course enrollment").

**Accept:** admin bulk-assigns tests to 3 students → student starts/completes one → admin reviews recommendation, overrides start point, confirms → course appears with future start date locked on the student dashboard; parent sees it too; `Enrolled` status reached → pipeline dashboard counts update.

---

### M8 — Re-enrollment, communications, polish — PDF §11, §12

- **Re-enrollment (`/apply/[school]?reenroll=<familyId>`):** wizard pre-populated from SIS records; only contact/medical/emergency editable + renewed waivers + payment plan selection; can add a new sibling (blank student card); school config gets `reenrollmentWindow {opens, deadline}` shown as a banner (PDF §11).
- **Communications (`/admin/communications` + a "Message family" button on the review workspace):** template picker (the 10 triggers listed in PDF §12), rendered preview, "send" = append to a per-family communication log (visible in review workspace). No real email.
- **Polish pass:** run the `/iblai-vibe-design` skill audit against BRAND.md; empty states, loading skeletons, error toasts everywhere; responsive check at 375px/768px/1280px.
- **E2E (§11 below) + `README.md`** in `portal/` (run, seed-reset instructions, role switcher, integration points list).

---

## 5. Theme reference (globals.css)

shadcn OKLCH variables with ibl.ai values (BRAND.md):

| Variable | Value |
|---|---|
| `--primary` | `oklch(0.492 0.194 259.3)` (#0058cc) |
| `--primary-foreground` | `oklch(0.985 0 0)` |
| `--background` / `--card` | `oklch(1 0 0)` |
| `--border` / `--input` | `oklch(0.922 0 0)` (≈#e5e7eb) |
| `--radius` | `0.625rem` |
| `--sidebar` | `oklch(0.985 0 0)` (visual target is the OS `#fafafa`) |

Hardcoded OS-parity hexes used directly in shell classes (they're hardcoded in the OS app too): sidebar bg `#fafafa`, sidebar border `#e9e9ea`, active nav `#cfe8fa/40`, footer text `#5f5f61`, header border `#D0E0FF`, muted text `#646464`. Brand gradient for hero/CTA moments only: `linear-gradient(135deg, #00b0ef, #0058cc)`. School `accentColor` is applied **only** on the public apply route.

---

## 6. Domain model (`lib/types.ts`) — write exactly this, extend only when a page needs it

```ts
export type Role = 'parent' | 'student' | 'afa_admin' | 'network_admin'
                 | 'central_admin' | 'finance_admin';

export type ApplicationStatus =                    // PDF §2.2 — all 11
  'draft' | 'submitted' | 'incomplete' | 'under_review' | 'interview_required'
  | 'accepted' | 'declined' | 'waitlisted' | 'enrollment_in_progress'
  | 'enrolled' | 'withdrawn';

export type PlacementStatus =                      // PDF §9.1
  'not_assigned' | 'assigned' | 'started' | 'completed' | 'reviewed' | 'confirmed';

export interface Guardian {
  firstName: string; lastName: string; relationship: string;
  email: string; phone: string; secondaryPhone?: string;
  address: { street: string; city: string; state: string; zip: string };
}

export interface Signature { signerName: string; signature: string; signedAt: string; }

export interface Acknowledgment {                   // one checkbox in step 4
  id: string; label: string; documentUrl?: string; checked: boolean;
  handbookVersion?: string;                         // PDF §6
}

export interface UploadedDocument {
  id: string; name: string; sizeBytes: number; uploadedAt: string; studentId?: string;
}

export interface MedicalRelease {                   // network schools, PDF §4
  emergencyContactName: string; emergencyContactPhone: string;
  emergencyContactRelationship: string; physician?: string;
  insuranceProvider?: string; policyNumber?: string;
  treatmentAuthorized: boolean; effectiveFrom: string; effectiveTo: string;
}

export interface StudentApplication {
  id: string; applicationId: string;
  status: ApplicationStatus;                        // per-student status, PDF §2.2
  legalFirstName: string; legalLastName: string; preferredName?: string;
  email?: string;                                   // required grades 3–12 (AFA)
  dateOfBirth: string; gender: string; gradeLevel: string;  // 'K'..'12'
  program: string;                                  // id from SchoolConfig.programs
  individualCourse?: string;                        // AFA "Individual Course" only
  supportInfo: string;
  academicBackground: Record<string, string>;       // questionId → answer
  studentResponses?: Record<string, string>;        // grades 3–12 only
  photoMediaRelease?: boolean;                      // network schools
  placement: { math: PlacementRecord; languageArts: PlacementRecord };
  courseEnrollments: CourseEnrollment[];
}

export interface PlacementRecord {
  status: PlacementStatus;
  recommendedCourse?: string; recommendedStartPoint?: string;
  finalCourse?: string; finalStartPoint?: string;   // after review/override
  updatedAt?: string;
}

export interface CourseEnrollment {
  courseId: string; courseName: string; startDate: string; active: boolean;
}

export interface Application {                      // one per FAMILY
  id: string;                                       // e.g. 'AFA-2026-0042'
  schoolSlug: string; programYear: string;
  status: ApplicationStatus;                        // family-level rollup
  guardians: Guardian[];                            // 1–2
  familyAnswers: Record<string, string>;            // referral/faith/background
  students: StudentApplication[];
  acknowledgments: Acknowledgment[];
  signatures: Signature[];
  medicalRelease?: MedicalRelease;
  documents: UploadedDocument[];
  fee: { amountCents: number; basis: 'family' | 'student';
         status: 'unpaid' | 'paid' | 'waived';
         paidAt?: string; method?: string;
         refundability: 'refundable' | 'nonrefundable' | 'creditable' };
  interview?: { required: boolean; notes: InternalNote[];   // notes NEVER serialized to parents
                outcome?: 'proceed' | 'request_info' | 'decline' | 'waitlist';
                completedAt?: string; waivedBy?: string };
  internalNotes: InternalNote[];                    // NEVER serialized to parents
  history: StatusChange[];
  decisionNotices: DecisionNotice[];
  submittedAt?: string; createdAt: string; isReenrollment?: boolean;
}

export interface InternalNote { id: string; author: string; body: string; createdAt: string; }

export interface StatusChange {                     // PDF §2.2: date, time, user
  from: ApplicationStatus; to: ApplicationStatus; by: string; at: string;
  note?: string; studentId?: string;                // set when per-student
}

export interface DecisionNotice {
  studentIds: string[]; kind: 'acceptance' | 'declination' | 'waitlist';
  body: string; sentAt: string;                     // PDF §2.4
}

// ---- Billing (PDF §5, §7) ----
export type ChargeType = 'application_fee' | 'registration_fee' | 'tuition'
  | 'curriculum' | 'supply' | 'facility' | 'lunch' | 'field_trip' | 'activity'
  | 'technology' | 'late_fee' | 'other';
export type FundingSource = 'parent' | 'esa' | 'sgo' | 'scholarship' | 'grant'
  | 'third_party' | 'credit';
export type PaymentPlanKind = 'full' | 'two_payments' | 'quarterly' | 'monthly';

export interface FamilyAccount {
  id: string; applicationId: string; schoolSlug: string; familyName: string;
  plan?: { kind: PaymentPlanKind; acknowledgedPoliciesAt: string;
           installments: { dueDate: string; amountCents: number; invoiceId?: string }[] };
  ledger: LedgerEntry[];                            // charges, payments, credits — the audit log
  hold?: { placedBy: string; placedAt: string; reason: string };
}

export interface LedgerEntry {
  id: string; at: string; by: string;               // admin name or 'parent'
  kind: 'charge' | 'payment' | 'credit' | 'refund' | 'waiver' | 'adjustment';
  chargeType?: ChargeType; fundingSource?: FundingSource;
  studentId?: string;                               // student-level detail, PDF §7
  amountCents: number; memo?: string;
}

export interface Invoice {
  id: string; accountId: string; dueDate: string; amountCents: number;
  status: 'due' | 'paid' | 'overdue'; paidAt?: string;
}

// ---- SIS (PDF §2.5) ----
export interface SisRecord {
  id: string; kind: 'guardian' | 'student'; familyId: string;
  sourceApplicationId: string; fields: Record<string, string>;
  duplicateOfId?: string;                           // dedupe flag
}

export interface AppNotification {
  id: string; userId: string; title: string; body: string;
  href?: string; readAt?: string; createdAt: string;
}
```

### 6.1 Status machine (`lib/status.ts`) — enforce in the API layer, drive dropdowns from it

```ts
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft:                  ['submitted', 'withdrawn'],
  submitted:              ['under_review', 'incomplete', 'withdrawn'],
  incomplete:             ['submitted', 'under_review', 'withdrawn'],
  under_review:           ['interview_required', 'accepted', 'declined', 'waitlisted', 'incomplete', 'withdrawn'],
  interview_required:     ['under_review', 'accepted', 'declined', 'waitlisted', 'withdrawn'],
  accepted:               ['enrollment_in_progress', 'withdrawn', 'waitlisted'],
  waitlisted:             ['accepted', 'declined', 'withdrawn'],   // PDF §2.4: waitlist → accepted before SIS
  declined:               [],
  enrollment_in_progress: ['enrolled', 'withdrawn'],
  enrolled:               ['withdrawn'],
  withdrawn:              [],
};
```

Rules enforced in `api.changeStatus()`:
- `draft → submitted` requires: required acknowledgments checked, required signatures present, fee `paid` or `waived` (PDF §2.1, §5.1).
- `interview_required → accepted` requires interview `outcome === 'proceed'` **or** an explicit waive (records `waivedBy`) (PDF §2.3).
- `→ accepted` creates/updates SIS records + a `FamilyAccount`; `declined`/`waitlisted` never do (PDF §2.5).
- Every transition appends a `StatusChange` with `by` from the session (PDF §2.2).

---

## 7. Session & permissions (`lib/session.tsx`)

- `SessionProvider` holds `{ user: { id, name, email, role, schoolSlug?, familyId?, studentId? } | null }` in localStorage.
- `/login` = dev role-switcher: 6 cards (one per role) using seeded identities. `// ponytail: dev auth — replace with /iblai-vibe-auth SSO when platform creds exist`.
- Guards: `(portal)/layout.tsx` redirects to `/login` when no session; each route group checks role (`/admin/*` admin roles only, etc.). School admins are scoped by `schoolSlug` **inside `lib/api` query functions**, not in components.
- **Privacy invariant (PDF §2.2, §2.3, §10):** `api.getApplicationForFamily()` returns a `FamilyApplicationView` with `internalNotes`, `interview.notes`, and admin-only history notes **stripped**; student-facing calls strip all billing. UI hiding alone is not acceptable.

## 8. Mock API surface (`lib/api/index.ts`)

All functions `async`, return deep copies, persist via `store.ts` (`localStorage` key `enrollment-portal-db-v1`, bootstrapped from `seed.ts`; "Reset demo data" button on `/login`). Future backend column shows the intended mapping — keep signatures compatible.

| Function | Future endpoint |
|---|---|
| `getSchool(slug)` / `listSchools()` | `GET /schools[/:slug]` |
| `createDraft(schoolSlug, email)` / `getDraftsByEmail(email)` | `POST /applications` / `GET /applications?email=` |
| `updateDraft(id, patch)` (autosave) | `PATCH /applications/:id` |
| `payFee(id, mockCard)` / `waiveFee(id, reason)` | `POST /applications/:id/fee/{pay,waive}` |
| `submitApplication(id)` | `POST /applications/:id/submit` |
| `listApplications(filter)` (role/school-scoped) | `GET /applications?…` |
| `getApplication(id)` / `getApplicationForFamily(id)` | `GET /applications/:id` (role-projected) |
| `changeStatus(id, to, {studentId?, note?})` | `POST /applications/:id/status` |
| `addInternalNote(id, body)` / `requestInformation(id, items)` | `POST /applications/:id/{notes,info-requests}` |
| `setInterview(id, patch)` / `recordInterviewOutcome(id, outcome)` | `POST /applications/:id/interview` |
| `recordDecision(id, studentIds, kind)` | `POST /applications/:id/decision` |
| `uploadDocument(id, meta)` / `signWaiver(id, ackId, signature)` | `POST /applications/:id/{documents,signatures}` |
| `listSisRecords()` / `resolveDuplicate(id, action)` | `GET /sis/records` … |
| `getFamilyAccount(familyId)` / `listAccounts(filter)` | `GET /billing/accounts…` |
| `selectPaymentPlan(accountId, kind)` / `makePayment(accountId, invoiceId, source)` | `POST /billing/…` |
| `addLedgerEntry(accountId, entry)` (charge/credit/refund/waiver/offline payment) | `POST /billing/accounts/:id/ledger` |
| `setHold(accountId, on, reason)` | `POST /billing/accounts/:id/hold` |
| `assignPlacement(studentIds, subjects)` / `advancePlacement(studentId, subject)` / `confirmPlacement(studentId, subject, final)` | `POST /placement/…` |
| `assignCourses(studentId, courses)` | `POST /enrollments` |
| `listNotifications(userId)` / `markRead(id)` | `GET /notifications` |
| `sendCommunication(applicationId, templateId)` / `listCommunications(applicationId)` | `POST /communications` |
| `startReenrollment(familyId)` (prefilled draft from SIS) | `POST /applications/reenroll` |

## 9. School config (`lib/schools/`) — PDF §3, §4

```ts
export interface SchoolConfig {
  slug: string; name: string; logo: string; accentColor: string;
  model: 'afa' | 'network'; programYear: string;   // '2026-2027'
  intro: string; announcements: string[];
  programs: { id: string; label: string; description?: string;
              requiresCourseSelection?: boolean }[];
  familyQuestions: Question[];                      // referral + faith/background
  academicBackgroundQuestions: Question[];
  studentResponseQuestions: Question[];             // grades 3–12 only
  agreements: { id: string; label: string; documentUrl?: string; required: boolean }[];
  signatures: { primaryParent: true; coParent: boolean; student: boolean };
  requiresMedicalRelease: boolean;                  // network: true
  requiresPhotoMediaRelease: boolean;               // network: true
  interviewRequiredByDefault: boolean;              // network: true (PDF §2.3)
  fee: { amountCents: number; basis: 'family' | 'student';
         refundability: 'refundable' | 'nonrefundable' | 'creditable';
         lateFeeCents?: number; lateFeeAfter?: string };
  handbook: { url: string; version: string };
  decisionTemplates: Record<'acceptance' | 'declination' | 'waitlist', string>;
  tuition: { gradeBand: string; programId: string; annualCents: number }[];
  planKinds: PaymentPlanKind[];
  reenrollmentWindow?: { opens: string; deadline: string };
}

export type Question = { id: string; label: string; kind: 'text' | 'textarea' | 'select' | 'yesno';
                         options?: string[]; required?: boolean };
```

`afa.ts` and `grace-network.ts`: transcribe the field/question lists **word-for-word** from PDF §3 and §4 (they are the actual copy the school approved — don't paraphrase). `/admin/schools` (central admin) renders the configs read-only with an edit form for fees/dates/templates (writes to the mock store override; `// ponytail: config editing persists to localStorage only`).

---

## 10. Shared components (`components/shared/`)

| Component | Notes |
|---|---|
| `StatusBadge` | one map: status → label + `bg-*/text-*` (submitted=info, accepted=success, declined=error, waitlisted=warning, enrolled=success, withdrawn=muted, etc.) |
| `Stepper` | wizard progress; accent-colorable |
| `DataTable` | thin wrapper over tanstack table + shadcn Table: sorting, filter row, pagination, row-selection (for bulk actions) |
| `SignatureBlock` | name input + typed-signature input (italic serif render) + auto date |
| `FileUploadStub` | `<input type="file">`, records name+size only |
| `MoneyText` / `CurrencyInput` | cents → `$1,234.00`; input parses to cents |
| `EmptyState`, `ConfirmDialog`, `PageHeader` | trivial; build once, reuse everywhere |

Everything else comes from shadcn — check `npx shadcn@latest add` before writing any new primitive.

## 11. Testing & verification

- Every milestone: `pnpm typecheck && pnpm lint && pnpm build` green.
- `lib/` logic check (M2): status-machine + fee-gating + privacy-projection assertions (small vitest file — no fixtures beyond seed).
- Playwright e2e (M8, `portal/e2e/`): one journey — apply (2 students) → submit → admin: note + interview + accept → parent: sees notice, picks monthly plan → admin: assign placement → student: complete test → admin: confirm + assign course → student sees course tile. Plus one privacy probe: parent view contains no internal-note text.
- Before demoing, run the `/iblai-vibe-ops-test` skill; UI polish via `/iblai-vibe-design`.

## 12. Explicitly out of scope (do not build)

Real payments, real emails/SMS, real SIS/ontology sync, real IBL AI placement delivery, file storage, SSO (stub only), dark mode, i18n, mobile apps, DB-driven form builder, reporting/exports beyond the tables shown. Each stub is marked `// ponytail:` at the integration point.

## 13. Open questions for product (defaults chosen so work is never blocked)

1. Exact fee amounts & tuition tables per school — **default: placeholder amounts in config, clearly fake ($150 family app fee, $4,500/yr tuition).**
2. Real school branding for a pilot network school — **default: fictional "Grace Network School".**
3. Should waitlist→accepted require re-running the fee? — **default: no.**
4. Placement test delivery mechanism (link-out vs embedded) — **default: link-out stub.**
5. SSO tenant + role mapping for the six roles — needed before `/iblai-vibe-auth` (M9+).
