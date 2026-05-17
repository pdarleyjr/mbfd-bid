<!-- Thanks for opening a PR! Fill in everything below. -->

## What does this PR do?

<!-- One paragraph. Why does this change exist? What's the user-visible effect? -->

## Plan task

<!-- Reference the plan + task this implements, e.g. "Plan 01 / Task 7 — PIN gate" -->

Plan: …
Task: …

## Type of change

- [ ] feat (new functionality)
- [ ] fix (bug fix — link the issue/incident)
- [ ] refactor (no behavior change)
- [ ] perf (measurable perf improvement)
- [ ] docs
- [ ] test
- [ ] chore (tooling/deps)
- [ ] ci

## Testing

<!-- How did you verify this works? -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] E2E test covers the user-visible flow
- [ ] Manual verification on desktop
- [ ] Manual verification on mobile (Pixel 7 / iPhone)
- [ ] `prefers-reduced-motion` respected
- [ ] Touch targets ≥ 44px on mobile

## Coverage

<!-- Paste the coverage summary from CI (or note "no source change") -->

```
Lines:    XX% / 80% target
Branches: XX% / 80% target
```

## Design system check

- [ ] No `gray-*` cold neutrals (use `stone-*`)
- [ ] No reds other than `red-700` / `red-600` / `red-50`
- [ ] All numerics use `tabular-nums`
- [ ] No bouncy easing; transitions use `ease-out-quart` or `ease-in-out-quart`
- [ ] No `@apply` directives in CSS

## Security check

- [ ] No secrets in this diff (grep for `cfat_`, `ghp_`, `sk-`, `Bearer ` in committed files)
- [ ] Server-side authorization on every new endpoint
- [ ] Step-up auth on every admin write
- [ ] Idempotency key on every state-changing endpoint
- [ ] Zod-validates every external input

## Screenshots / recordings

<!-- For UI changes, attach a before + after image or short video. -->

## Linked issues

<!-- "Closes #123" or "Refs #456" -->

## Reviewer notes

<!-- Anything specific the reviewer should focus on or skip -->
