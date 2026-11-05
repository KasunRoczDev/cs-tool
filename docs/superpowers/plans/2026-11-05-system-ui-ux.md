# System UI/UX Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the shared dashboard UI into a calm, premium operations console while preserving all existing routes, permissions, data behavior, and theme switching.

**Architecture:** Keep the existing Next.js/React dashboard and global CSS approach. Concentrate system changes in `dashboard/app/globals.css`, keep navigation behavior in the existing `Shell`, add a small dependency-free SVG icon component, and use the overview page as the reference surface for the refreshed visual language.

**Tech Stack:** Next.js 14, React 18, plain CSS, JSX, existing npm scripts (`lint`, `build`). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-system-ui-ux-design.md`

## Global Constraints

- Preserve existing routes, permissions, API calls, live socket updates, theme switching, passkey nudge, alert count, and logout behavior.
- Work within the existing Next.js/React dashboard and current styling approach.
- No framework migration or new UI dependency unless an existing dependency already supports the need.
- Do not rewrite unrelated modified files in the dirty worktree.
- Verify the changed dashboard at desktop and narrow viewport sizes after implementation.

## Review Focus

- Narrow viewport navigation: the sidebar must remain usable without forcing horizontal page scroll; verify with the responsive layout checks in Task 2.
- Nested routes: a child route such as `/billing/report` must keep its parent navigation item visibly active; verify with the active-route test in Task 2.
- Keyboard users: navigation, filters, buttons, and dismiss controls need visible focus states; verify with the accessibility checks in Tasks 1–3.
- Long and empty data: long server names, no servers, and no filter matches must remain legible and composed; verify with the overview states in Task 3.
- Theme parity: the same surfaces and states must remain readable in both light and dark modes; verify with the two-theme smoke checks in Task 4.

### Task 1: Establish shared visual tokens and interaction primitives

**Files:**
- Modify: `dashboard/app/globals.css`

**Interfaces:**
- Produces: shared CSS tokens and utility classes consumed by `Shell.jsx` and the overview page, including `.nav-icon`, `.mobile-nav-toggle`, `.mobile-nav-backdrop`, `.overview-*`, `.icon-button`, `.focus-ring`, and responsive layout rules.

- [ ] **Step 1: Replace the existing root palette and typography defaults**

  Update `:root`, `[data-theme="dark"]`, and `[data-theme="light"]` with a restrained cool-neutral palette, semantic text/surface tokens, consistent radius and shadow tokens, and tabular-number support. Keep the existing variable names (`--bg`, `--panel`, `--panel-2`, `--border`, `--text`, `--muted`, `--accent`, `--ok`, `--warn`, `--crit`) so existing pages continue to render.

- [ ] **Step 2: Normalize global controls and focus behavior**

  Update `button`, `input`, `select`, links, and shared button variants to use consistent height, radius, transition, hover, pressed, disabled, and `:focus-visible` behavior. Add a `prefers-reduced-motion` override for the shared transitions.

- [ ] **Step 3: Add shared shell and overview layout styles**

  Add the class rules needed by later tasks: sticky/scrollable sidebar behavior, compact navigation rhythm, responsive content padding, page header hierarchy, metric tile alignment, filter controls, product group surfaces, table overflow, icon buttons, empty states, and mobile navigation overlay states. Avoid editing page-specific behavior in this task.

- [ ] **Step 4: Run the dashboard lint check**

  Run: `npm run lint` from `dashboard`

  Expected: the command completes without new lint errors.

### Task 2: Refresh the shared shell and navigation

**Files:**
- Create: `dashboard/components/Icon.jsx`
- Modify: `dashboard/components/Shell.jsx`

**Interfaces:**
- Consumes: CSS tokens and shell classes from Task 1.
- Produces: `Icon({ name, size })` as a dependency-free, decorative inline SVG component; `Shell` retains its current `{ children }` interface and all existing auth/socket behavior.

- [ ] **Step 1: Add the dependency-free icon component**

  Create `Icon.jsx` with an accessible SVG wrapper (`aria-hidden="true"`, `focusable="false"`) and a small named path map for the navigation concepts already present in `Shell`: overview, monitoring, products, apps, topology, performance, security, alerts, notifications, billing, releases, repositories, deployments, environments, setup, users, access, profile, settings, and admin tools. Keep the icon stroke/fill treatment consistent and do not add a package.

- [ ] **Step 2: Convert the navigation model from emoji labels to structured items**

  In `Shell.jsx`, change each nav item from a rendered emoji-prefixed label to `{ href, label, icon }` data. Preserve every existing href, role-gated item, group, and alert count. Keep the brand text but give it a semantic shield/monitor mark through the new icon component.

- [ ] **Step 3: Add correct active-route semantics**

  Add a local active-route check that treats `/` as exact and treats non-root items as active for their nested paths. Render `aria-current="page"` on the active link and preserve the existing alert badge on `/alerts`.

- [ ] **Step 4: Add responsive navigation behavior**

  Add `mobileNavOpen` state, a compact mobile toggle, a dismissible backdrop, and close-on-navigation behavior. Keep the desktop sidebar visible at the existing desktop breakpoint; on narrow widths, turn it into an off-canvas panel without changing route navigation or role filtering. Ensure the toggle and dismiss control have labels and focus states.

- [ ] **Step 5: Move the passkey nudge styling to named classes**

  Replace the passkey nudge's inline layout styles with semantic classes from `globals.css`, preserving its copy, link target, dismissal key, and behavior.

- [ ] **Step 6: Run the dashboard lint check**

  Run: `npm run lint` from `dashboard`

  Expected: the command completes without new lint errors.

### Task 3: Make the overview page the reference surface

**Files:**
- Modify: `dashboard/app/(app)/page.jsx`

**Interfaces:**
- Consumes: shared tokens and overview classes from Task 1, and `Icon` only if a small action icon is needed.
- Produces: the same `OverviewPage` data flow and callbacks with class-based presentation for headers, KPI tiles, filters, product groups, server tables, and empty states.

- [ ] **Step 1: Normalize the page header and primary action**

  Replace the page header's generic markup with the shared page-head classes, a readable title/subtitle hierarchy, and the existing add-server action styled as the primary action. Keep `RegisterServer` opening behavior unchanged.

- [ ] **Step 2: Refresh the KPI grid**

  Convert the metric-card inline layout decisions to named classes. Keep all eight metrics and their existing values/colors, but align number baselines, use tabular figures, reduce redundant borders, and make the grid responsive without forced equal-height content.

- [ ] **Step 3: Improve environment filtering**

  Convert the filter row to a labeled filter toolbar with explicit selected state, keyboard-visible focus, and responsive wrapping. Keep the same environment options and filtering behavior.

- [ ] **Step 4: Improve grouped server panels and table readability**

  Convert product group wrappers, collapsible headers, edit controls, table overflow, and status cells to named classes. Preserve grouping, collapse state, inline editors, live metric values, server links, and last-seen formatting. Keep long names from breaking the layout by using sensible overflow behavior.

- [ ] **Step 5: Compose a better empty state**

  Replace the plain no-match message with a concise empty-state panel that distinguishes “no servers configured” from “no servers match the filter” using the existing `rows` and `envFilter` state. Do not introduce a new API call or product claim.

- [ ] **Step 6: Run the dashboard lint check**

  Run: `npm run lint` from `dashboard`

  Expected: the command completes without new lint errors.

### Task 4: Verify build, themes, and rendered responsive behavior

**Files:**
- Modify: only files from Tasks 1–3 if verification reveals a defect.

- [ ] **Step 1: Run the production build**

  Run: `npm run build` from `dashboard`

  Expected: Next.js completes the production build without compilation errors.

- [ ] **Step 2: Run the Impeccable detector over changed UI targets**

  Run: `C:\Users\user\.codex\plugins\cache\impeccable\impeccable\4.8.0\skills\impeccable\scripts\impeccable.cmd detect --json dashboard/app/globals.css dashboard/components/Shell.jsx dashboard/components/Icon.jsx dashboard/app/(app)/page.jsx`

  Expected: review findings, then resolve any actionable detector issues that conflict with the spec before final handoff.

- [ ] **Step 3: Inspect the rendered dashboard at desktop and narrow widths**

  Start the dashboard with `npm run dev` from `dashboard`, inspect the overview route at a desktop width and a narrow mobile width, and verify: no horizontal page overflow; sidebar/content balance; active nested navigation; readable KPI/table content; usable mobile drawer; focus visibility; and composed empty/filter states.

- [ ] **Step 4: Smoke-test both themes and preserved behaviors**

  Toggle light/dark theme and verify readable contrast for navigation, surfaces, tables, status colors, buttons, inputs, and empty states. Confirm the alert badge, role-gated links, passkey nudge dismissal, route navigation, and logout behavior remain functional.

- [ ] **Step 5: Review the diff for scope safety**

  Run: `git diff -- dashboard/app/globals.css dashboard/components/Shell.jsx dashboard/components/Icon.jsx dashboard/app/(app)/page.jsx docs/superpowers/specs/2026-11-05-system-ui-ux-design.md docs/superpowers/plans/2026-11-05-system-ui-ux.md`

  Expected: only the approved UI/UX refresh and its design/plan documents appear in the diff; unrelated pre-existing worktree changes remain untouched.
