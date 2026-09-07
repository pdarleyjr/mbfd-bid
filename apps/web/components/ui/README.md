# MBFD shadcn components

Canonical interactive base: Base UI 1.8.0 (MIT), React 19 peer support. Manual existing-project integration uses shadcn component composition with Tailwind 3 semantic styles. Native form and table components intentionally preserve HTML events, refs, browser validation, FormData and TanStack Table v8 behavior. No domain rules belong here. Links use buttonVariants on real anchors. Default buttons are secondary; use primary for consequential intended actions, destructive for destructive operations.

Sources reviewed September 7, 2026:

- https://ui.shadcn.com/docs/installation/next — existing project setup
- https://ui.shadcn.com/docs/monorepo — app-local aliases and component placement
- https://ui.shadcn.com/docs/components-json — manual configuration
- https://ui.shadcn.com/docs/tailwind-v4 — existing Tailwind 3 compatibility
- https://ui.shadcn.com/docs/changelog — current base and package changes
- https://ui.shadcn.com/docs/changelog/2026-07-react-aria — Base UI default; Radix and Aria options
- https://github.com/shadcn-ui/cn#gotchas — Tailwind 3 must retain tailwind-merge v2
- https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/bases/base/ui — upstream component composition
- https://base-ui.com/react/components/dialog — modal focus, initialFocus, finalFocus, Portal
- https://base-ui.com/react/components/collapsible — controlled disclosure
- https://ui.shadcn.com/docs/components/base/native-select — native/mobile selection
- https://ui.shadcn.com/docs/components/base/data-table — recipe, not a replacement engine

The complete official catalogue was reviewed, including sidebar, cards, actions, badges, alerts, overlays, menus, tabs, selects, combobox/command, form controls, calendar/date picker, tables/pagination, scrolling/resizing, disclosure, breadcrumbs, skeleton/spinner/progress, empty/item and typography. Install only components actually needed by features. Existing native dates, details and selects remain appropriate. Drawer gestures, global search, extra menus, calendar dependencies and a new table major version add no required capability here.

Current upstream styles use Tailwind 4 shortcuts and cn placeholders. Do not overwrite these wrappers with an unreviewed CLI preset. `components.json` records the canonical base; inspect CLI dry-run/diff before future additions. React Aria has no demonstrated additional requirement in this application, and the previously unused Radix Slot dependency is removed. Shared COLORS.ui is the sole semantic palette, exposed as RGB CSS variables by the existing Tailwind plugin. Tailwind 4/new cn package migration is deferred to its own build/browser qualification.
