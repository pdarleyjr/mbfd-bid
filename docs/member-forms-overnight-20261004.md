# Member forms and overnight continuity

Pausing a bid saves the active phase, bidder, selections, A-Day progress and remaining advisory turn time. After the saved confirmation, the administrator may close the page. Reopen the same bid from Current Bid or the Mock session list, then choose Resume bid. Freeze remains a separate terminal action. Notes are optional.

The implementation uses the existing canonical D1 command state and durable command receipts. No migration or authentication change is required. New pauses persist their timestamp; resume excludes the paused interval from the turn clock. Older paused sessions without this timestamp receive a fresh advisory clock on their first resume. Concurrent retries either replay the accepted receipt or return a typed stale-sequence result. Pause and resume do not reevaluate or reorder recorded A-Day allocations.

Click the selected member's name to open Overview, Credentials and Bid form. Overview retains the previous bid evidence and current staffing assignment. Credentials refreshes personnel evidence when the panel opens and distinguishes that evidence from the bid session's saved eligibility. Bid form displays the submitted position and A-Day preferences without creating awards. Private phone numbers and source details are collapsed by default and restricted to administrators.

## Reviewed sources

- `2026 Bid Forms.xlsx`: SHA-256 `a0cc230d39f1ea9fdd8a5ee588e73af5a1f41f9546cb58c93b78254624f90aae`; 165 submitted forms and 57 explicit non-submissions. The 372 formula cells are quoted text constants; none execute calculations.
- Three incorrect source employee IDs are linked using exact full name and rank in the authoritative directory, independently checked against MASTER Personnel and the canonical directory. The original values and reviewed correction remain visible. Other records never use guessed or fuzzy identities.
- `2026 Station 2 Air Tech Rank Seniority v3.pdf`: 160 distinct firefighter reference rows, generated October 2, 2026 at 2:19 PM. Repeated page headers are excluded. Seven score changes explain the ordering differences from the older cached annual workbook.

Submitted unit choices are requests rather than exact seat IDs. The Air Tech PDF is a published point/order reference; a row's presence does not establish certification, currency or eligibility. Neither documentary source mutates personnel credentials, qualifications, frozen policies, bid order or selections.

## Source publication

The source archive is stored privately in the existing exports R2 bucket. No submission or contact data is committed to Git. The member API requires admin access, disables response caching and verifies the archive hash. For a selected bid, it resolves identity against that bid's frozen member projection and year; missing saved identity produces an explicit error instead of using a mutable directory fallback.

`scripts/extract-bid-form-source.py` creates a private packet from unchanged source files and separately approved identity corrections. `scripts/build-bid-form-receipt.mts` validates and normalizes the packet, rejects duplicate/overlapping identities and creates a private receipt without network writes. First publication creates the year's source; subsequent API publication requires the current archive hash and an R2 conditional write. Immutable hash-addressed revisions preserve both versions before the current pointer changes. Identical retries reuse the existing publication.

## Validation boundaries

Focused reducer and canonical-service tests reconstruct paused Mock and Real sessions after a two-day interval, retain all operational state, test A-Day phase continuity and concurrent retries. Member-panel tests cover asynchronous switching, identity mismatch, source availability, retry, keyboard tabs and focus return. Browser tests cover the shared Mock/Real panel at desktop and phone widths. Production acceptance uses the same dedicated acceptance Mock only; it does not create a Real bid or modify personnel credentials.

Current in-app instructions and the generated offline HTML manual include these controls. The dated historical PDF remains preserved.

Technical guidance reviewed: [Cloudflare Durable Object persistence](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), [WAI modal dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), and [WAI tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
