# Obsolete Bid deployment retirement — 2026-10-01

The user retired the obsolete staging deployment. Production remains at `https://bid.mbfdhub.com`, its API at `https://api.bid.mbfdhub.com`, and its Hub authorization endpoint at `https://www.mbfdhub.com/auth/bid/authorize`.

This repository removes the obsolete deployment workflow, Wrangler environment, Web build environment file, package commands, local-admin/bootstrap and JWT-rotation helpers, UI banner, obsolete setup/runbook instructions and automatic backup schedule. The stage-dependent one-time production bootstrap CLI had no workflow or restore caller and was removed; its tested pure planner and SQL-generation library remain.

Production Worker environment bytes are unchanged from source `bbe99aed22e89e2473dc19904cda9b6c3da528c1`; the retained block SHA-256 is `cce0a7cc357450c43cd83023ed47fb0ad538c4b4cb9910b96f58c7ce54931b96`. The Web production environment, domains, API target and resource names remain identical. Production KV, D1, Durable Object class/migration, R2 buckets, Hub federation, PIN and five-minute command authentication remain in place. Portal writeback stays disabled, without a production queue producer or consumer.

CI builds the production OpenNext artifact without deployment, runs a Worker smoke test against an explicit loopback-only configuration with fake resource IDs and reserved synthetic Hub endpoints, and runs unit, canonical, actual Workers runtime and browser checks. Browser authentication redirect fixtures never contact a real Hub. They do not certify real production sign-in.

The five legacy HTTP-shell launchers use `wrangler.launcher-test.toml`, which deliberately has no D1 binding, matching their existing synthetic subjects without directory rows. The complete local development/smoke configuration retains isolated D1; actual D1 identity, persistence and eviction coverage uses the dedicated Workers-runtime configuration. Production authentication is unchanged, and all launcher health, signed-identity and Durable Object assertions remain in place.

Production backups remain explicitly dispatched. Removing the retired environment's schedule does not start scheduled production writes. Recovery retains an explicitly named disposable target, verified backup key, migration and integrity checks. Production deployment stays manual, pinned to a complete immutable SHA and guarded by the existing D1 migration ledger and Worker-first health check.

The separately authorized cloud retirement completed on 2026-10-01. It removed the two obsolete Workers and custom domains, their Durable Object namespace, D1 database, KV namespace, two queues, three dedicated R2 buckets containing 96 objects, the old Pages project and the GitHub staging environment. Both retired DNS names resolve as NXDOMAIN. Production Worker settings and deployment records were identical before and after deletion, and production API health remained successful. Generic historical buckets were retained because exclusive obsolete-environment ownership was not established. Private deletion and production comparison receipts remain outside the repository.

The repository does not itself perform remote deletion. Frozen source evidence, historical year archives, migrations, frozen v11 and Peter's personal Mock are not altered by these repository changes. The business operation of staging a reviewed data import remains part of the production workflow; it is unrelated to the retired deployment environment.

The D1 backup workflow was temporarily disabled while its obsolete scheduled scope was retired. After this repository change is merged, re-enable that workflow before dispatching the next explicitly authorized production backup; it now supports manual production backups only.

Historical release receipts are summarized in [the archive](archives/pre-retirement-release-receipts.md). They are historical evidence, not operating instructions or current production acceptance.
