# BEAM Design Language: Decision-Maker Intelligence

Version 1.0, 29 September 2026. Companion to `DMI_BRD_for_Claude_Code.md`.

---

## 0. How to use this file

This file is self-contained. Every value in sections 1 to 8 was extracted on 19 September 2026 from the live stylesheets of `beam.markivis.com/` and `beam.markivis.com/aeo-seo-studio`, where both pages share one palette and one type stack. Where a live value failed WCAG AA, the corrected value is recorded here and it replaces the live one.

The BEAM system was built for marketing pages. Decision-Maker Intelligence is an application, so it needs a few things the marketing site never had: an app shell, data tables, badges, drawers, a validation queue. Those additions are marked **[App extension]**. They are built only from BEAM tokens, and the few new tokens they need were contrast-checked to the same standard.

**Precedence.**

1. This file wins over anything else for visual decisions.
2. If you are inside the BEAM repository and its CSS differs from a token here, use this file's value and log the difference in `DECISIONS.md`.
3. If a screen needs something this file does not cover, build it from existing tokens and components, then add a short entry to `DECISIONS.md` describing the new pattern.

**Never:** introduce a new colour, font, radius or shadow value outside the token set; use Title Case; use an em dash; use lime as text on a light surface; set any sans text below 14 px or mono text below 12 px.

---

## 1. Principles

1. **Every component is theme-aware.** Components read tokens (`--text-secondary`), never literals (`#3A4254`). Dropped onto a dark band, a component stays legible without a class change. This is the single structural rule of the system.
2. **Violet has two jobs, and two tokens.** Use `--accent` when violet is the ink (text, icons, rules, links); it flips to a lighter violet on dark grounds. Use `--accent-fill` when violet is the surface (primary buttons, badges); it never changes. Mixing them up is the most common way to fail contrast.
3. **Lime is a fill, never text on light.** Lime marks positive, free or measured-good states as a background with `--text-on-lime` over it. On a dark band only, `--lime-bright` may be text.
4. **Mono means measurement.** Space Mono appears wherever the interface reports a figure, a date, a score, an ID or a label for data. It never carries an argument or a sentence.
5. **The dark band is an instrument, not a theme.** The site is one light world interrupted by a few inverted bands that mark assertions. In the app, the dark band appears at most once per screen, for the readout summary on Today (section 9.4).
6. **One accent wash per screen.** `--surface-accent-wash` flags the single most important panel or step. Two of them and neither means anything.
7. **Claims carry a number and an owner.** Interface copy states the figure and who it concerns: "3 actions due today", "Oldest item: 4 working days".
8. **Nothing below the floor.** No sans text under 14 px, no mono under 12 px, no hit area under 44 by 44 px, no focus outline removed.

---

## 2. Tokens

### 2.1 Fonts

Load all three families in one request with `display=swap`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap">
```

| Role | Family | Weights | Used for |
|---|---|---|---|
| Display | Bricolage Grotesque (optical size axis 12 to 96) | 700, 800 | Page titles, panel headings, scores. Never body text |
| Sans | Instrument Sans | 400, 500, 600 | All body text, labels, buttons, table cells, form inputs |
| Mono | Space Mono | 400, 700 | Eyebrows, figures, dates, counts, IDs, table column headers of data columns, keyboard hints, readout values |

Self-hosting the fonts is allowed (and preferable for the app's Content Security Policy) as long as the files are the same families and weights.

### 2.2 CSS custom properties

Paste this as the single source of truth. The light values are the default; the dark values apply inside any element with `data-theme="dark"` (used for the readout band, and for a full dark mode if one is ever added).

```css
:root {
  /* Surfaces */
  --surface-page: #F4F6FC;
  --surface-raised: #FFFFFF;
  --surface-sunken: #EDEFF7;
  --surface-accent-wash: #F1EAFF;
  --surface-lime-wash: #EFF7D4;

  /* Borders */
  --border-subtle: #E3E7F1;      /* decorative lines, card edges, dividers */
  --border-strong: #CBD1E0;      /* table rules, ghost button edges */
  --border-control: #858CA0;     /* [App extension] input and checkbox edges; 3.36:1 on raised, 3.11:1 on page */

  /* Text */
  --text-primary: #12151D;       /* 16.89:1 on page */
  --text-secondary: #3A4254;     /* 9.31:1 on page */
  --text-muted: #596073;         /* 5.81:1 on page; the lightest text allowed */
  --text-on-accent: #FFFFFF;     /* 6.37:1 on accent-fill */
  --text-on-lime: #22300A;       /* 9.02:1 on lime */

  /* Violet */
  --accent: #770FFF;             /* violet as ink: 5.90:1 on page, 6.37:1 on raised */
  --accent-fill: #770FFF;        /* violet as surface */
  --accent-fill-hover: #9F37FF;  /* fill only, never text */
  --accent-deep: #6A0BEB;        /* pressed state; darker logo-mark stop */

  /* Lime */
  --lime: #AEE028;               /* fill only */
  --lime-bright: #C8F135;        /* hover fill; text on dark grounds only */

  /* Signals */
  --signal-ok: #3C6B0C;          /* 6.36:1 on raised */
  --signal-warn: #A34A08;        /* 5.17:1 on sunken, 5.93:1 on raised */
  --signal-critical: #B42318;    /* [App extension] 6.57:1 on raised, 5.73:1 on sunken */
  --signal-warn-wash: #FDF1E3;   /* [App extension] warn text on it: 5.33:1 */
  --signal-critical-wash: #FDECEA; /* [App extension] critical text on it: 5.75:1 */

  /* Focus */
  --focus-ring: #770FFF;

  /* Type families */
  --font-display: 'Bricolage Grotesque', Georgia, serif;
  --font-sans: 'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
  --font-mono: 'Space Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* Type scale: fluid on display only; body sizes are fixed */
  --display-1: clamp(2.1rem, 5vw, 3.7rem);     /* 33.6 to 59.2 px, marketing hero only */
  --display-2: clamp(1.7rem, 3.4vw, 2.7rem);   /* 27.2 to 43.2 px */
  --display-3: clamp(1.35rem, 2.2vw, 1.7rem);  /* 21.6 to 27.2 px, app page titles */
  --heading-card: 1.125rem;  /* 18 px */
  --lede: 1.0625rem;         /* 17 px */
  --body: 1rem;              /* 16 px */
  --body-sm: 0.9375rem;      /* 15 px */
  --caption: 0.875rem;       /* 14 px, the sans floor */
  --eyebrow: 0.75rem;        /* 12 px mono, the mono floor */
  --meta: 0.8125rem;         /* 13 px mono */
  --button: 0.9375rem;       /* 15 px */

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 36px;
  --space-7: 56px;
  --space-8: 80px;

  /* Radius */
  --radius-sm: 6px;     /* chips, tags, inline code */
  --radius-md: 9px;     /* buttons, inputs, readout rows, table containers */
  --radius-lg: 14px;    /* cards and panels */
  --radius-xl: 20px;    /* hero panels, drawers' outer corner on desktop */
  --radius-pill: 999px; /* pills, badges, band chips */

  /* Elevation */
  --shadow-card: 0 1px 2px rgba(18,21,29,.04), 0 8px 24px -16px rgba(18,21,29,.18);
  --shadow-accent: 0 8px 22px -12px rgba(119,15,255,.75);  /* primary button only */
  --shadow-panel: 0 24px 60px -32px rgba(18,21,29,.35);    /* drawers, dialogs, popovers */

  /* Sizes */
  --wrap: 1120px;           /* marketing content width */
  --app-max: 1440px;        /* [App extension] app content max width */
  --gutter: 24px;
  --measure-lede: 62ch;
  --measure-title: 22ch;
  --tap-min: 44px;
  --topbar-h: 60px;         /* [App extension] */
  --sidebar-w: 232px;       /* [App extension] */
  --drawer-w: 560px;        /* [App extension] */

  /* Motion [App extension]: the site has only two animations; the app adds these durations and nothing else */
  --dur-fast: 120ms;
  --dur-base: 160ms;
  --ease: cubic-bezier(.2,.7,.2,1);

  color-scheme: light;
}

[data-theme="dark"] {
  --surface-page: #14161F;
  --surface-raised: #1D2130;
  --surface-sunken: #12141C;
  --surface-accent-wash: #2A1D47;
  --surface-lime-wash: #26300F;
  --border-subtle: #2E3446;
  --border-strong: #3E465C;
  --border-control: #727A96;     /* 3.76:1 on raised dark */
  --text-primary: #FFFFFF;
  --text-secondary: #CBD1E0;
  --text-muted: #9AA1B8;
  --accent: #B36BFF;             /* 5.55:1 on page dark; raw #770FFF is 2.83:1 here and never used as ink */
  --signal-ok: #C8F135;
  --signal-warn: #F2C94C;
  --signal-critical: #FF8A7A;    /* 6.99:1 on raised dark */
  --signal-warn-wash: #3A2A0E;
  --signal-critical-wash: #3A1714;
  --focus-ring: #C18CFF;         /* 7.27:1 on dark */
  color-scheme: dark;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
```

### 2.3 Type styles

| Style | Family | Size token | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|---|
| display-1 | Display | `--display-1` | 800 | 1.05 | -0.03em | Not used in the app |
| display-2 | Display | `--display-2` | 800 | 1.05 | -0.02em | Empty-state headline on first run only |
| display-3 | Display | `--display-3` | 800 | 1.1 | -0.02em | Page titles |
| heading-card | Display | `--heading-card` | 700 | 1.25 | -0.01em | Panel and card headings, drawer titles |
| lede | Sans | `--lede` | 400 | 1.6 | 0 | One-line page description under a title |
| body | Sans | `--body` | 400 | 1.6 | 0 | Default text, form inputs |
| body-sm | Sans | `--body-sm` | 400 | 1.55 | 0 | Table cells, card body, list rows |
| caption | Sans | `--caption` | 400 or 500 | 1.5 | 0 | Helper text, secondary cell lines, timestamps in prose |
| button | Sans | `--button` | 600 | 1 | 0 | Buttons |
| eyebrow | Mono | `--eyebrow` | 700 | 1.2 | 0.16em, uppercase | Panel labels that state the argument (section 8.5) |
| meta | Mono | `--meta` | 400 | 1.45 | 0.02em | Dates, IDs, source types, keyboard hints |
| figure | Mono | `--meta` | 700 | 1.2 | 0 | Counts, scores beside labels, ages |

Rules: headings use `text-wrap: balance`. All numbers in tables and readouts use `font-variant-numeric: tabular-nums`. Body line length stays under 80 characters (`max-width: var(--measure-lede)` for prose blocks).

### 2.4 Breakpoints

Four, named. Use nothing else.

| Name | Query | What changes in the app |
|---|---|---|
| `sm` | `max-width: 560px` | Single column; buttons in a button row go full width; card padding `--space-4`; tables switch to stacked row cards |
| `md` | `max-width: 760px` | Drawers become full screen; two-column layouts collapse; the queue detail pane opens as a full-screen view |
| `lg` | `max-width: 960px` | Sidebar collapses into a 44 by 44 burger that opens a navigation drawer; three-column panel grids go to two |
| `xl` | `min-width: 1200px` | Content caps at `--app-max`; nothing else grows |

Zero horizontal scroll at 320, 360, 390, 414, 768, 1024 and 1440 px is a requirement. Wide tables scroll inside their own container, never the page.

---

## 3. Brand lockup

### 3.1 The BEAM mark

A rounded square with a violet gradient, a white Bricolage "B", and a lime underscore bar. It is drawn in CSS, not a file.

```html
<a class="brand" href="/" aria-label="BEAM by Markivis home">
  <span class="brand__mark" aria-hidden="true"><b>B</b></span>
  <span class="brand__word">BEAM</span>
  <span class="brand__sub">Decision-Maker Intelligence</span>
</a>
```

```css
.brand { display: flex; align-items: center; gap: 11px; min-height: var(--tap-min); color: var(--text-primary); text-decoration: none; }
.brand__mark {
  position: relative; flex: none; width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(150deg, var(--accent-fill-hover), var(--accent-deep));
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px -4px rgba(119,15,255,.5);
}
.brand__mark b { font-family: var(--font-display); font-weight: 800; font-size: 16px; color: #FFFFFF; }
.brand__mark::after {
  content: ""; position: absolute; left: 6px; right: 6px; bottom: 5px; height: 2.5px;
  border-radius: 2px; background: var(--lime-bright);
}
.brand__word { font-family: var(--font-display); font-weight: 800; font-size: 19px; letter-spacing: -0.01em; }
.brand__sub {
  font-family: var(--font-mono); font-size: var(--eyebrow); letter-spacing: .04em; color: var(--text-muted);
  margin-left: 3px; padding-left: 9px; border-left: 1px solid var(--border-strong);
}
@media (max-width: 560px) { .brand__sub { display: none; } }
```

The live site sets the sub-label at 10.5 px; this system raises it to the 12 px mono floor.

### 3.2 The Markivis wordmark

Markivis holds a separate wordmark SVG for decks and proposals. It is not the BEAM mark and the two are never substituted for each other. Inside the app, Markivis appears only as the text "BEAM by Markivis" in the footer of the user menu and on sign-in, in `--text-muted` caption.

---

## 4. Colour in use

### 4.1 Allowed text colours

`--text-primary`, `--text-secondary`, `--text-muted`, `--accent` (links and emphasis ink), `--signal-ok`, `--signal-warn`, `--signal-critical`, `--text-on-accent` (on violet fills only), `--text-on-lime` (on lime fills only). Nothing else, and nothing lighter than `--text-muted`.

### 4.2 Semantic mapping for the app [App extension]

| Meaning | Treatment |
|---|---|
| Priority 1 | Pill: `--accent-fill` ground, `--text-on-accent`, label "P1" in mono 700 |
| Priority 2 | Pill: transparent, 1.5 px `--accent` border, `--accent` text, "P2" |
| Priority 3 | Pill: transparent, 1 px `--border-strong` border, `--text-muted` text, "P3" |
| Confidence high | Mono `figure` in `--signal-ok`, with the word "High" (never colour alone) |
| Confidence medium | Mono `figure` in `--text-secondary`, "Medium" |
| Confidence low | Mono `figure` in `--signal-warn`, "Low" |
| Band: strong | Pill: `--accent-fill` ground, `--text-on-accent`, "Strong" |
| Band: warm | Pill: `--surface-accent-wash` ground, `--accent` text (5.45:1), "Warm" |
| Band: cooling | Pill: `--surface-sunken` ground, `--text-secondary` text, "Cooling" |
| Band: cold | Pill: `--surface-sunken` ground, 1 px `--border-strong`, `--text-muted`, "Cold" |
| Band: none | Pill: transparent, 1 px dashed `--border-strong`, `--text-muted`, "None" |
| Confirmed, sent, done | `--signal-ok` text with a check glyph and the word |
| Needs attention, overdue, conflict | `--signal-warn` text on `--signal-warn-wash` pill |
| Blocked (off-limits, consent, suppressed) | `--signal-critical` text on `--signal-critical-wash` pill, with the reason in words |
| Auto-confirmed | Mono meta "AUTO" in `--text-muted` beside the status |
| Mock data | Pill in the top bar: `--lime` ground, `--text-on-lime`, "Mock data" |

A band pill using `--surface-accent-wash` does not count against the one-wash-per-screen rule, which applies to panels, not pills.

### 4.3 Charts

BEAM has one chart: a lime bar on a `--border-subtle` track, with no axis. The app keeps that vocabulary.

- **Bars and progress:** `--lime` fill on a `--border-subtle` track, 8 px tall, `--radius-pill`. The value sits beside the bar in mono `figure`. Use for path strength, score, queue load against capacity.
- **Comparisons (this month versus last):** two bars per row, current in `--lime`, previous in `--border-strong`, labelled in words.
- **Funnel (signals to mandates):** horizontal bars left-aligned, each as long as its count relative to the first stage, with count and stage name in text beside each. No pie or donut charts anywhere.
- Charts always have a text equivalent (a visually hidden table or the visible labels).

---

## 5. Shape, elevation and spacing

- Cards and panels: `--radius-lg`. Controls: `--radius-md`. Pills and badges: `--radius-pill`. Chips: `--radius-sm`.
- On light grounds, cards take `--shadow-card`. On the dark band, no shadow: depth comes from `--surface-raised` against `--surface-page` plus `--border-subtle`.
- Drawers, dialogs and popovers take `--shadow-panel`.
- Spacing uses the `--space-*` ramp only. Card padding `--space-5` (desktop) and `--space-4` (`sm`). Gap between panels `--space-5`. Gap between sections of a page `--space-6`.

---

## 6. Iconography

The BEAM site ships no icon set. Its "icons" are three typographic devices, and they stay:

- **The eyebrow rule:** a 22 by 2 px `--accent` bar before every eyebrow, with a 10 px gap.
- **The mono arrow** `→`, set in Space Mono inside buttons and text links that move the user forward ("Open queue →"). Never an SVG chevron or emoji for this purpose.
- **The step dot:** a 14 px `--accent-fill` disc with a 3 px ring in the current `--surface-page`.

**[App extension] Functional icons.** An application needs icons for navigation and dense controls. Use the Lucide icon set only, at 18 px, stroke width 1.75, colour `currentColor`. Every icon sits beside a text label, except icon-only buttons, which carry an `aria-label` and a tooltip with the same words. No decorative icons, no icons in headings, no coloured icon circles.

---

## 7. App shell [App extension]

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [B] BEAM | Decision-Maker Intelligence   [ Search people and companies ]  (Mock data) (User) │  top bar 60 px
├──────────────┬────────────────────────────────────────────────────────────┤
│ Today        │  Page title (display-3)                         [Primary] │
│ Actions   3  │  One-line lede in text-secondary                          │
│ Queue    12  │                                                           │
│ People       │  ┌───────────── panel ─────────────┐ ┌──── panel ─────┐   │
│ Companies    │  │                                 │ │                │   │
│ Signals      │  └─────────────────────────────────┘ └────────────────┘   │
│ Paths        │                                                           │
│ Coverage     │                                                           │
│              │                                                           │
│ Settings     │                                                           │
└──────────────┴────────────────────────────────────────────────────────────┘
  sidebar 232 px        content: max 1440 px, gutter 24 px
```

- **Page ground:** `--surface-page`.
- **Top bar:** `--surface-raised`, 1 px `--border-subtle` bottom border, height `--topbar-h`, sticky with `top: env(safe-area-inset-top, 0px)`. Left: brand lockup. Centre: global search (max 480 px). Right: mock badge (when relevant), workspace switcher (when the user has more than one workspace), user menu.
- **Sidebar:** `--surface-page`, 1 px `--border-subtle` right border, width `--sidebar-w`. Items are 44 px tall, `body-sm` 500 in `--text-secondary`, with an 18 px icon. The active item is `--text-primary` 600 on `--surface-raised` with `--radius-md`, and a 3 by 18 px `--accent` bar at its left edge (the eyebrow rule turned vertical). Counts sit right-aligned in mono `figure`; an overdue count uses `--signal-warn`. Settings sits at the bottom, separated by `--space-5`.
- **Below `lg`:** the sidebar is replaced by a 44 by 44 burger at the left of the top bar, opening the same navigation in a left drawer. Use `dvh`, not `vh`, for the drawer height.
- **Content area:** padding `--space-6` top, `--gutter` sides (use `max(var(--gutter), env(safe-area-inset-left))` on the left and the matching right inset).
- **Page header:** title in `display-3`, optional lede in `lede` / `--text-secondary` / `max-width: var(--measure-lede)`, primary actions right-aligned on the same row above `md`, below the lede at `md` and smaller.

---

## 8. BEAM components

These six exist on the live site. The specifications below are the consolidated, token-based versions.

### 8.1 Button

Three variants, all at least 44 px tall, all working on light and dark grounds without a class change.

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  min-height: var(--tap-min); padding: 12px 22px; border-radius: var(--radius-md);
  font: 600 var(--button)/1 var(--font-sans); border: 1.5px solid transparent; cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), background-color var(--dur-base) var(--ease);
  white-space: nowrap; text-decoration: none;
}
.btn:hover { transform: translateY(-1px); }
.btn:focus-visible { outline: 2.5px solid var(--focus-ring); outline-offset: 3px; }
.btn .arrow { font-family: var(--font-mono); }

.btn--primary { background: var(--accent-fill); color: var(--text-on-accent); box-shadow: var(--shadow-accent); }
.btn--primary:hover { background: var(--accent-fill-hover); }
.btn--primary:active { background: var(--accent-deep); }

.btn--lime { background: var(--lime); color: var(--text-on-lime); }
.btn--lime:hover { background: var(--lime-bright); }

.btn--ghost { background: transparent; color: var(--accent); border-color: var(--border-strong); }
.btn--ghost:hover { border-color: var(--accent); background: var(--surface-raised); }

.btn[disabled], .btn[aria-disabled="true"] { opacity: .5; cursor: not-allowed; transform: none; box-shadow: none; }

@media (max-width: 560px) { .btn-row .btn { width: 100%; } }
```

- **Primary:** the single most important action on the screen ("Approve and send", "Confirm change"). One per view.
- **Lime:** the free or positive, no-commitment action. In the app, used only for "Run a sample import" and "Try with demo data" on first-run screens. Never for destructive or sending actions.
- **Ghost:** every secondary action.
- **[App extension] Danger:** `.btn--danger` is a ghost button with `--signal-critical` text and border, for "Erase person", "Revoke connection". Always behind a confirmation dialog.
- **[App extension] Compact:** inside tables and toolbars, `.btn--compact` uses `padding: 8px 14px` and `font-size: var(--caption)` but keeps a 44 px hit area through a transparent `::before` or container padding.
- **Loading:** keep the label, add `aria-busy="true"`, replace the arrow with a 14 px spinner (static dots when reduced motion is on). Do not change the button's width.

### 8.2 Card

```css
.card {
  background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
  padding: var(--space-5); box-shadow: var(--shadow-card); color: var(--text-primary);
}
[data-theme="dark"] .card { box-shadow: none; }
.card--accent { background: var(--surface-accent-wash); border-color: transparent; box-shadow: none; }  /* one per screen */
.card--feature { background: var(--accent-fill); color: var(--text-on-accent); border-color: transparent; }
@media (max-width: 560px) { .card { padding: var(--space-4); } }
```

Cards in a grid stretch to the tallest cell. Never set a fixed height and truncate.

### 8.3 Field

- **Label:** Space Mono 12 px, `0.06em` tracking, uppercase, `--text-muted`. The required asterisk is `--accent`.
- **Input:** 16 px minimum (below 16 px iOS Safari zooms on focus). `--surface-page` ground, 1 px `--border-control` [App extension, replaces `--border-strong` for inputs so the control edge meets 3:1], `--radius-md`, 12 px padding, `--text-primary`.
- **Focus:** 2.5 px `--focus-ring` outline, 3 px offset. Never removed.
- **Validation:** inline on blur; `aria-invalid` and `aria-describedby` wired; error text at 14 px in `--signal-critical` [App extension; the site used `--signal-warn`], always in words.
- **Layout:** two fields per row above 560 px, one below. Submit full width below 560 px.
- `autocomplete` and `inputmode` on every field.
- **Selects and comboboxes:** same box as inputs. Use a searchable combobox for any list longer than six options (companies, people).
- **Checkboxes and radios:** 20 px box, `--border-control` edge, checked state `--accent-fill` with a white tick; the whole label row is the 44 px hit area.

### 8.4 Readout

The measurement display: a score, a bar, and key and value rows. It is the one place the mono face carries real information.

- **Rows:** `--surface-sunken` ground, `--radius-md`, padding `9px 12px`, grid `1fr auto`; key in `--text-muted` at 14 px sans; value in Space Mono at 13 px; state colours `--signal-ok`, `--signal-warn`, `--signal-critical`, always with a word.
- **Score:** the figure in Bricolage 800 at `--display-3` or larger, the denominator ("/ 100") in `--text-muted` mono beside it. The bar below is `--lime` on a `--border-subtle` track.
- **Honesty:** any example or mock readout carries the line "Example readout" (in the app: the "Mock data" badge covers this).
- Use on: the Person page score block, the Today readout band, source health in Settings.

### 8.5 Section header

Eyebrow, title and lede.

- **Eyebrow:** Space Mono 700, 12 px, `0.16em` tracking, uppercase, `--accent`, preceded by the 22 by 2 px `--accent` rule with a 10 px gap. It labels the argument, not the section.
- **Title:** Bricolage 800, `line-height` 1.05, `-0.02em`, `text-wrap: balance`, `max-width: var(--measure-title)`.
- **Lede:** `--text-secondary`, 17 px, `max-width: var(--measure-lede)`.

**In the app [App extension]:** page headers use title and lede only, without an eyebrow. Eyebrows appear on Today's panels, where each states what it asks of the user: "NEEDS YOUR APPROVAL", "CHANGED THIS WEEK", "MEETINGS TOMORROW", "GOING QUIET", "WAITING FOR REVIEW". Read top to bottom, they form the day's agenda.

### 8.6 Step

The numbered process step with a rail and dots.

- Number in `--accent` (never `--accent-fill`), mono. Rail in `--border-strong`. Dot: 14 px `--accent-fill` with a 3 px ring in `--surface-page`, so it knocks out on any ground. Body in `--text-secondary` at 15 px.
- Five equal columns above 960 px with a horizontal rail; below, the rail turns vertical at `left: 6px` and the dots sit at `left: 0`.

**In the app [App extension]:** the vertical form is the **timeline**: the roles history on the Person page (one dot per role, ended roles with a hollow dot of `--border-strong`), the interaction history, and the signal history. The horizontal form is used only for the action status flow in the action drawer (Drafted, Awaiting approval, Approved, Sent, Outcome), with the current step's dot filled and later steps hollow.

---

## 9. App components [App extension]

All are built from the tokens and components above.

### 9.1 Panel

A card with a header row: eyebrow (Today only) or `heading-card` title on the left; count in mono `figure` and a ghost compact "View all →" on the right. Body below with `--space-4` gap. Empty panels show one line of `--text-muted` caption and, where useful, one ghost action.

### 9.2 Data table

- Container: `--surface-raised`, 1 px `--border-subtle`, `--radius-lg`, `overflow-x: auto` inside the container only.
- Header row: `--surface-sunken`, height 40 px, labels in sans 600 at `--caption`, `--text-secondary`, sentence case. Sortable headers are buttons with `aria-sort`; the sort glyph is a mono `↑` or `↓`.
- Body rows: minimum height 52 px, `body-sm`, 1 px `--border-subtle` between rows, no zebra striping. Hover: `--surface-sunken`. The whole row is a link to the record when it has one, with visible focus.
- Primary cell: name in `--text-primary` 600, second line in `--text-muted` caption (for example role and company).
- Numbers, dates and ages: mono `meta`, tabular, right-aligned.
- Selection: checkbox column 44 px wide; selected rows get a 3 px `--accent` inset bar on the left edge and `--surface-sunken` ground.
- Sticky header on scroll. Pagination: 50 rows, with "Showing 1 to 50 of 1,240" in mono meta and ghost compact Previous and Next.
- **Below `sm`:** rows become stacked cards (primary cell on top, two or three key fields below as label and value), no horizontal scroll.

### 9.3 Pills, badges and chips

- **Pill:** height 24 px, padding `0 10px`, `--radius-pill`, `--caption` 600 sans, or mono 700 12 px for P1 to P3. Semantics in section 4.2.
- **Flag chips** (Placed, Off-limits, Do not contact, Off list): `--radius-sm`, 1 px `--border-strong`, `--text-secondary`; Off-limits and Do not contact use the blocked treatment.
- **Filter chips:** ghost style with a remove button (44 px hit area) and the active value in `--text-primary`; "Clear all" as a text link in `--accent`.

### 9.4 Readout band (Today)

The only dark band in the app. A full-width strip at the top of Today with `data-theme="dark"` applied: `--surface-page` (dark) ground, `--radius-lg`, padding `--space-5`. It holds four readout figures side by side (two per row below `md`): Actions due today, Drafts awaiting approval, Items in the queue, Oldest item age. Each figure is Bricolage 800 at `--display-3` in `--text-primary`, with its label in `--text-muted` caption below. A figure that breaches its target (overdue actions, queue age over 3 working days) shows `--lime-bright` text "Over target" beside it. No shadow on the band.

### 9.5 Validation queue

- Desktop: two panes. Left list (400 px): each row shows the priority pill, headline (two lines maximum), subject name, source type and age in mono meta. Selected row: `--surface-raised` with the 3 px `--accent` left bar. Right pane: the detail.
- Detail pane, top to bottom: headline in `heading-card`; subject with link; evidence quote in a `--surface-sunken` block with a 2 px `--border-strong` left rule and `--text-secondary` italic; sources as a list (title as link, outlet, published date in mono meta, source type pill); confidence and lane; proposed record changes as a before and after table; decision bar pinned to the bottom of the pane with "Confirm change" (primary), "Reject" (ghost, opens reason menu), "More research" (ghost), "Park" (ghost text link).
- Keyboard hints shown as mono `meta` keycaps (`--surface-sunken`, 1 px `--border-strong`, `--radius-sm`) beside each control: C, R, M, P, J, K.
- Below `md`: the list is the screen; selecting an item opens the detail full screen with a back control.

### 9.6 Action card and action drawer

- In lists: a card with priority pill, person name and new role, headline, band pill, due date (mono meta; overdue in the warn treatment), and a ghost compact "Open →".
- The drawer (right side, `--drawer-w`, full screen below `md`, `--shadow-panel`, `--surface-raised`): header with name, role, band and flags; the horizontal status steps (section 8.6); "Why it matters" and "Our position" as readout rows; "Best path" with its strength bar (section 4.3) and one-sentence explanation; the draft editor; the decision bar pinned at the bottom.
- **Draft editor:** subject and body fields at 16 px, a word count in mono meta against the style guide limit, a "Redraft" ghost button with an optional instruction field, and the AI rationale in `--text-muted` caption above the editor ("Why this angle: ...").
- Blocked states replace the draft editor with a blocked pill and one sentence saying why and what to do ("Record a lawful basis in Consent to draft this message.").
- The drawer traps focus while open, closes on Escape, and returns focus to the row that opened it.

### 9.7 Person header and score block

- Header: name in `display-3`, primary role and company in `lede`, pills for band and contact types, flag chips, and action buttons (Log interaction, Create action) right-aligned.
- Score block (a readout): score figure and "/ 100", band pill, bar, then five readout rows for Recency, Frequency, Reciprocity, Depth and Tenure with the raw value in words ("Last two-way touch: 41 days ago").

### 9.8 Tabs

Text tabs in sans 500 `--text-secondary`, 44 px tall; the active tab is `--text-primary` 600 with a 2 px `--accent` underline. Tabs scroll horizontally inside their own row below `sm`. Implement with the ARIA tabs pattern and arrow-key navigation.

### 9.9 Dialogs, toasts and popovers

- **Dialog:** `--surface-raised`, `--radius-xl`, `--shadow-panel`, max width 520 px, title in `heading-card`, body in `body`, actions right-aligned (primary last). Destructive dialogs name the thing and the consequence: "Erase Jordan Example? This removes every record about them and cannot be undone."
- **Toast:** bottom left (bottom full width below `sm`), `--surface-raised`, `--shadow-panel`, `--radius-md`, one line in `body-sm`, optional "Undo" text link. Auto-dismiss after 6 seconds, paused on hover and focus. Announced through an `aria-live="polite"` region. Toast words match the action: "Sent to Jordan Example", "Change confirmed", "Rejected: wrong person".
- **Popover and tooltip:** `--surface-raised`, `--shadow-panel`, `--radius-md`, caption text. Tooltips appear on hover and focus and never hold the only copy of important information.

### 9.10 Empty, loading and error states

- **Empty:** one sentence in `body` saying what will appear and one action if the user can cause it: "No people yet. Import your target list or add a person." with "Import target list" (primary) and "Add person" (ghost). No illustrations.
- **Loading:** skeleton blocks in `--surface-sunken` with `--radius-sm`, matching the final layout; a gentle opacity pulse, off under reduced motion. Never a full-page spinner for more than one second.
- **Error:** what happened and how to fix it, in the interface's voice, with a retry where it helps: "Couldn't load signals. Check your connection and try again." Adapter errors in Settings show the provider's message in mono meta below the plain explanation.

### 9.11 Coverage grid

A table of companies against seats. Each cell is a 44 px minimum button showing the person's surname and a band treatment as the cell ground (strong: `--accent-fill` with `--text-on-accent`; warm: `--surface-accent-wash`; cooling and cold: `--surface-sunken`; none: `--surface-raised`); empty seats show "No one mapped" in `--text-muted` caption with a dashed `--border-strong` edge. A legend above the grid lists the bands in words. The first column is sticky.

### 9.12 Path row

Connector avatar-free row: the path in words ("You → Jane Example → Target"), with the mono arrow; the connection type pill; the strength bar (section 4.3) with its value; the owner in `--text-muted` caption; a ghost compact "Draft introduction request →".

---

## 10. Motion

- Only two motion patterns exist: button hover lift (`translateY(-1px)`), and state changes that answer a user's action (drawer slide in 160 ms, dialog fade and scale from 0.98 in 160 ms, row removal after a queue decision fading out in 120 ms).
- No entrance animations on page load, no scroll-triggered reveals, no shimmer.
- Everything respects `prefers-reduced-motion`.

---

## 11. Accessibility

- WCAG 2.1 AA across every screen. The contrast figures in section 2.2 are the evidence; do not introduce a pair that is not listed there without checking it.
- Focus: 2.5 px `--focus-ring` outline, 3 px offset, on every interactive element. Never removed.
- Hit areas: 44 by 44 px minimum, with 8 px between adjacent targets.
- Colour is never the only carrier of meaning: every state has a word.
- Keyboard: every flow can be completed with the keyboard. Queue shortcuts never fire while focus is in an input.
- Landmarks: `header`, `nav`, `main`; one `h1` per page (the page title); headings nest in order.
- Live regions for toasts and for queue decisions ("Change confirmed. Next item: ...").
- Forms: visible labels (never placeholder-only), `autocomplete`, errors linked with `aria-describedby`.

---

## 12. Voice and microcopy

BEAM's voice on the site is already right and carries into the app:

- **Claims carry a number and an owner.** "4 actions due today", not "Several actions need attention".
- **Short, declarative sentences.** "Confirmed. Jordan Example is now CFO at Example Holdings."
- **No hedging and no superlatives.** Never "leading", "best-in-class", "cutting-edge", "powerful", "seamless".
- **Sentence case** for every heading, button, tab, column header and menu item. Title Case is not used anywhere.
- **Buttons say what happens,** and the confirmation repeats the verb: "Approve and send" then "Sent to Jordan Example".
- **Errors never apologise and are never vague.** They say what failed and what to do.
- **US English** in the interface (the market and first client are US-based). Dates in lists as `Sep 29, 2026`; ages in working days where a service level applies.
- **No em dashes.** Use a colon, comma or full stop.

Standard labels (use these words everywhere):

| Concept | Label |
|---|---|
| Confirm a signal | Confirm change |
| Reject a signal | Reject |
| Send for more research | More research |
| Park | Park |
| Approve a draft and send it | Approve and send |
| Save without sending | Save draft |
| Close an action without sending | Mark done |
| Close an action with a reason | Dismiss |
| Relationship strength labels | Strong, Warm, Cooling, Cold, None |
| Priority labels | P1, P2, P3 |
| Queue lanes | Review, Weekly batch, More research, Parked, Spot checks, Conflicts and duplicates |

---

## 13. Do and do not

| Do | Do not |
|---|---|
| Read tokens in every component | Hardcode a hex value in a component |
| Use `--accent` for violet text on any ground | Use `#770FFF` as text on a dark ground (2.83:1) |
| Use lime as a fill with `--text-on-lime` | Use lime as text on a light surface (1.44:1) |
| Put figures, dates and IDs in Space Mono | Set sentences or arguments in mono |
| Keep one accent-wash panel per screen | Tint several panels violet for emphasis |
| Use the dark band once, on Today | Build dark sidebars or dark top bars |
| State every status in words | Rely on colour alone |
| Stretch cards to the tallest in a row | Fix card heights and truncate content |
| Keep 44 px hit areas with padding | Shrink controls in dense tables |
| Use the mono arrow in forward links and buttons | Use SVG chevrons or emoji for that purpose |
| Use Lucide icons beside labels | Use decorative icons or coloured icon circles |

---

## 14. Checklist for every new screen

- [ ] Page title in `display-3`; lede under 62 characters per line
- [ ] Every colour, size, radius and shadow comes from a token
- [ ] Works at 320 px with no horizontal page scroll; tables scroll in their container or stack
- [ ] Loading, empty, error and permission-denied states designed and written
- [ ] Every interactive element has a visible focus ring and a 44 px hit area
- [ ] axe reports zero serious or critical issues
- [ ] At most one primary button and one accent-wash panel
- [ ] Sentence case throughout; no em dashes; US English
- [ ] Numbers tabular and in mono where they are measurements
- [ ] Mock data badge visible when any adapter is in mock mode
