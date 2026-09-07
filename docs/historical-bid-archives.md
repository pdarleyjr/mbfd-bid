# Historical bid archives

Bid Board → Previous Bid can display documentary results from years before the application recorded canonical completions. Select a historical year or verified application completion in **Previous bid source**. An archive is not a live session, annual configuration, or award-transition input.

## Import and review

An authenticated administrator can open **Import historical bid results**, select a JSON archive, review each shift, and publish it. File selection only prepares a browser preview. Publication uses the existing authenticated, CSRF-protected admin proxy. Archives must describe a past year and fit within 1 MB. `HistoricalBidSchema` defines the format; integration and browser tests contain synthetic examples.

Keep personnel data, source images, and generated archives outside the public Git repository. The application stores the selected archive in the existing private exports bucket under `historical-bids/v1/<year>.json`, with publisher, publication time, and SHA-256. Initial publication cannot replace a year. Reads verify content integrity and year. There is no delete operation.

To correct a source transcription, select the corrected archive and supply an **Amendment reason**. The preview retains the reviewed current checksum. Publication preserves the old and new receipts under immutable `historical-bids/v1/revisions/<year>/` keys before conditionally updating the selected-year object. A concurrent change is rejected; exact retries are idempotent. The selected receipt records its predecessor, reason, administrator and timestamp. Earlier selected revisions remain downloadable through **Historical archive provenance**. Unselected prepared receipts may remain after a conflicting update; they do not change the selected archive. Amendments use only R2 and never mutate current staffing or annual preparation.

Sources have filenames and SHA-256 hashes. Rows retain original position codes, station/group, unit, role, name, group/day, status, and source location. Preserve blank fields, withdrawn rows, and documented inconsistencies. Optional employee references must cite explicit source identifiers; never infer them from names or use them to create live member links.

## Historical Days and today's supplement

D / Days shows documented historical awards first. **Current official Days positions · supplement** separately reads the effective-dated current roster, including approved civilian and vacant posts. It excludes historical A/B/C award recipients by explicit employee identifier, active temporary overlays, Light Duty/Special Assignment locations, unapproved positions, and occupied records without employee identifiers.

The supplement is dated, refreshes independently, and is explicitly not a historical award. If historical A/B/C identifiers are incomplete, it remains unavailable rather than guessing name matches. Historical names and roles remain frozen despite subsequent assignment or rank changes.

## Preservation boundary

Imports write only private archive objects. They do not modify D1, create sessions, update identity, reconcile staffing, change eligibility/rules, or alter annual plans. Canonical completion resolution and current/upcoming board queries retain their existing paths. No new bindings, secrets, migrations, or infrastructure changes are required.

Historical topology comes from the selected documents. Rescue Float Pool codes do not identify an operating station. Labels such as `Post St.6` remain under their source station/unit without changing today's Station 6 or a future plan.

Integration tests cover authorization, bounded input, immutability, concurrent publication, stored-content integrity, exact-ID exclusions, and database preservation. Browser tests cover responsive views, review-before-publication, CSRF forwarding, and separation from upcoming plans using synthetic data.
