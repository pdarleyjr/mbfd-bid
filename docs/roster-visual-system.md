# Compact administration and roster identity

The application header owns page help. Do not add a separate help row before page content. Annual context keeps the selected year, approval state and qualification date visible; revision and session details remain an expandable disclosure. Use Tailwind's spacing scale and wrapping flex layouts, preserving 44px controls and readable text. The dashboard and board use 12–16px section gaps instead of stacked hero spacing.

## One palette, reusable variants

`packages/shared/src/constants/design-tokens.ts` is the palette source. The existing Tailwind plugin generates CSS variables and utilities from it. `components/admin/RosterIdentity.tsx` provides CVA variants, shift badges and unit badges shared by current staffing, upcoming/official boards, historical documents and current rosters.

- A: muted emerald; B: steel blue; C: garnet; D/Days: bronze.
- Engine: muted violet; Ladder: garnet; Rescue: olive; Float: copper; Marine: blue-green; Command: steel.
- Station headers use a neutral satin-gray surface. Color is concentrated in summary strips and apparatus headings/badges; data rows remain readable neutral surfaces.
- Identity colors are separate from warning/success/error tokens. They do not indicate readiness, vacancy, eligibility or a bid outcome. Text labels remain present in monochrome and high contrast modes.
- Unit colors are a presentation-only fallback based on recognized unit-label prefixes. Unknown/new units retain their exact labels and a neutral color. These helpers must never feed rule evaluation, assignment, source identity or grouping.

To extend the palette, add foreground/surface tokens, add the corresponding CVA variant, and include the pair in `design-token-contrast.test.ts` (4.5:1 minimum for normal text). Use complete utility classes so Tailwind can discover every variant. Do not introduce per-page hex values, dynamic class-name fragments or a second theming dependency.

Browser acceptance covers 1857×970, 1486×776, 646×698 and phone widths, including the first roster's vertical position, page navigation, all four shifts, help, navigation collapse and full document bounds. Bounded scrolling preserves long records; no content is clipped to meet a screenshot target.

References: [Tailwind 3 theme configuration](https://v3.tailwindcss.com/docs/theme) and [CVA variants](https://cva.style/getting-started/variants/). These extend the installed stack; no framework or dependency upgrade is required.
