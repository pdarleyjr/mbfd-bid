# Final 2026 release status

Assessment date: 2026-09-19. **Release blocked by unresolved source decisions and
source-to-runtime mappings.** The implementation is a candidate; this document
does not certify a final configured Bid or production acceptance.

## Source and repository identity

The governing files are under `Downloads/OneDrive_2026-09-19/Bid App folder`.
The [source manifest](final-2026-source-manifest.json) records their exact hashes.
Authority is final PDF, then final master topology, then consistent numeric
calculation evidence, then dated assignment observations. The calculation
workbook is not authoritative where its formulas contradict the PDF.

Work continued in the existing isolated worktree
`D:/CodexWorktrees/mbfd-bid-unified-adaptive-20260912`, preserving its starting
changes and the original checkout. Starting candidate commit:
`e584f91687d09e0e63edff1088a0dddc345d13fc`; tree:
`ecbbae3e9090d4b61f5b31016c05e0ae03249fae`. Starting main commit:
`ec4087a2166cffdfa8f4c96cb66d0db5ddc8ca0c`; tree:
`ef056f6f38e8a27324d37a562402a2a914a6ba45`.
PR #129 remains the release-candidate stream. There is no merged release identity
or deployment tree parity for these changes.

## Implemented candidate

- Shared profile edits compile on Save, with optional impact review and retained
  historical Restore behavior.
- Stage-specific ordering, ordered qualification fallback, simultaneous A-Day
  scopes, interchangeable station/float capacity, and reviewed existing membership
  distributions use explicit frozen configuration.
- Changed awards use canonical eligibility, contact/disposition evidence and
  consistent constraints. Marine minimum-qualified-only forcing is the user's
  explicit decision; it does not resolve other role ambiguities.
- Term evidence separates cumulative service, consecutive cycles and dated
  incumbent protection. A voluntary departure requires explicit operator-recorded
  member confirmation and evidence. Force cannot use that voluntary right.
- Canonical Department transitions preserve origin closures, use accepted award
  evidence, and atomically recheck source assignments including finite sources
  that require no closure. They do not infer a backfill opportunity.
- Managed Live creation pins the version and Department context, preserves retry
  identity and does not start a Bid. Managed Mock starts through the existing
  session control and uses the canonical operator console. Older automatic/manual
  simulators reject configurations requiring these canonical capabilities; a full
  automatic canonical simulator is not implemented.
- Results explicitly selects a run and reads canonical awards; History supports
  canonical actions and chronological pagination. The administrator guide and
  generated 61-page PDF describe the implemented controls.
- Department navigation composes rapid member selections with the submitted
  date/search filters so a second click cannot restore stale URL filters.

The [coverage matrix](final-2026-coverage-matrix.md) distinguishes mechanisms,
source configuration, synthetic tests and live proof for each policy group.

## Decisions and evidence still needed

1. Confirm the proposed calculation-workbook seniority ordinals: Rank Seniority
   for time in grade and Straight Seniority for department service. Existing
   master RSC values are not equivalent; promotion dates are absent. No automatic
   alias or invented date is permitted.
2. Resolve Air Tech forcing, the DE A-Day limit's exact membership scope, and
   whether SWAT redistributes the existing six memberships or recruits from a
   wider qualified pool. The Marine answer does not decide these questions.
3. Review every final source position's staffing identity. The final master has
   228 positions (A74/B73/C73/D8); the captured production template has 242.
   Only 177 IDs overlap, and shared strings include 67 unit changes and 29 rank
   changes. Existing assignments cannot be rebound merely by matching labels.
   Investigator's final-master Combat3 versus policy Ladder3 exception also needs
   an explicit binding. The private proposal deliberately leaves runtime IDs
   unresolved. No final topology was installed.
4. Supply or certify missing qualification equivalences, current validity,
   division-service and tenure facts, and unresolved preference weights. Optional
   Marine points cannot substitute for minima; main Air Tech requires both
   certificates; Captain5 requires Paramedic and cumulative service; Investigator
   requires both named minima. Synthetic golden tests prove those distinctions,
   not actual member qualifications.
5. Resolve the specialized-shift Timeline and current Chief supplemental Marine
   requirements. SOG200.17 was located. Article5 was not located, so unprovided
   discretionary authority is not automated. See the bounded
   [external-reference search](final-2026-external-references.md).

These gaps prevent a complete final-policy Mock, saved final configuration and
production release. Unaffected mechanisms were implemented and tested rather
than treating the missing references as a blanket development stop.

## Recovery and production boundary

Read-only production checks found migrations through 0058, three existing Mock
sessions and no Real sessions. A private D1 export was restored locally;
migrations 0059–0063 preserved all 20,662 rows across 75 original tables and every
original column value. SQLite quick-check passed and foreign-key violations were
zero before and after. Private exports, personnel mappings, source extractions
and detailed evidence remain ignored by Git.

This local rehearsal is not a fresh deployment backup or Time Travel recovery
proof. Before any production migration, repeat the authorized fresh export,
receipt/hash, bookmark and exact-source recovery gates. No remote migration,
final Current Bid publication, deployment, Real Bid command, real personnel test
change, history reset/deletion or Portal writeback activation occurred in this
reconciliation. Production acceptance remains unperformed.
