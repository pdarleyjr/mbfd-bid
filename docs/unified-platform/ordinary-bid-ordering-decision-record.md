# Ordinary Bid ordering: final 2026 reconciliation

## Governing semantics

The final July 2026 Bid Process PDF, page 8, Bid Selection Process 4 and
footnote 4, supersedes the earlier draft descriptions for this configuration.
Ordinary station stages proceed Captain, Lieutenant, Firefighter. Firefighters
use Department seniority; other ranks use time in grade. Reverse seniority
reverses the applicable domain. Specialty preference scoring remains separate
from the ordinary stage comparator.

## Data authority still required

The final calculation workbook contains separate Rank Seniority and Straight
Seniority ordinal channels. Their names are plausible matches to the governing
domains, but are not themselves authorization to overwrite personnel facts.
The master roster's RscSeniorityIn values differ from these channels. A raw RSC
field must not be relabeled Department seniority. Promotion dates were not
established in the reviewed source package.

A user clarification remains pending on treating the final calculation
workbook's two channels as source-certified ordinals for the corresponding
domains. Missing identities, missing values, duplicates and unresolved ties must
block affected ordering. No hire or promotion dates may be manufactured.

## Implemented boundary

Version-2 ordering authority supports an explicit comparator for every configured
stage and binds it to the resolved annual-policy source decision. A missing stage
or disagreement with that resolution blocks preparation. Historical version-1
snapshots retain their original comparator and representation. Historical RSC-first
software behavior is not authority for a new final-source configuration.

The comparator semantics are therefore resolved by the final PDF. Source-to-field
mapping and the actual personnel import remain separate, unfinished gates.
