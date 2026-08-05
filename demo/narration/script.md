# Narration script

Spoken script in story order. `scenes.json` is the machine-readable source of the
same content; if the two disagree, `scenes.json` is canonical and this file is
the thing to fix.

## Specification

**Target: 230–270 spoken words. Master duration ceiling: 170 seconds.**

The earlier target of 150–170 words was wrong, and wrong in a direction that
would have hurt the cut. This script is **264 words over 162 seconds**, which is
**98 words per minute** — slow enough to leave real room for pauses and for the
viewer to read what is on screen. A 150–170 word narration stretched over the
same 2:42 would run near 60 wpm, which does not read as measured, it reads as
padding around a video that has run out of things to say.

The ceiling is a ceiling, not a target: 162 seconds leaves 8 seconds of headroom
for breath and trims without a re-record.

## Pacing, and the two scenes to watch

Average pacing is comfortable; per-scene pacing is not uniform, and the average
hides that.

| Scene | Words | Seconds | wpm |
| -- | --: | --: | --: |
| 1 — Silent zero | 31 | 12 | 155 |
| 2 — Why the failure exists | 30 | 13 | 139 |
| 3 — DataHub establishes the asset context | 28 | 20 | 84 |
| 4 — Resolve to exact repository source | 34 | 25 | 82 |
| 5 — The joined plan changes | 37 | 28 | 79 |
| 6 — Evidence discipline | 27 | 20 | 81 |
| 7 — Durable DataHub writeback | 26 | 22 | 71 |
| 8 — Reproducibility and OSS proof | 35 | 15 | 140 |
| 9 — Close | 16 | 7 | 137 |
| **Total** | **264** | **162** | **98** |

Scenes 3 through 7 sit at 71–84 wpm, which is the register this material wants.
Scenes 1, 2, 8 and 9 run 137–155 wpm.

For 1 and 2 that is deliberate: the opening is a problem statement and it should
feel quick.

**Scene 8 is the one to watch.** 35 words in 15 seconds is the tightest in the
script, and it carries the provenance disclosure, which is the sentence that must
not sound rushed or swallowed. If a take runs long, take the time from scene 3 or
4 rather than compressing 8.

Scene 9 was extended from 5 seconds to 7 for the same reason. At 5 seconds the
closing line was 192 wpm, which is a throwaway; the close is the claim.

---

## Scene 1 — Silent zero (0:00–0:12)

> Move the same dbt project into a monorepo and the naive join can fall from five
> matches to zero without throwing an error. Nothing crashed. Zero looked like a
> valid answer.

## Scene 2 — Why the failure exists (0:12–0:25)

> DataHub carries a dbt path relative to the dbt project. Git and coding agents
> need a path relative to the repository root. Same file, different coordinates.
> The handoff silently breaks.

## Scene 3 — DataHub establishes the asset context (0:25–0:45)

> Tally starts with DataHub: the canonical dataset identity, declared lineage,
> schema, ownership, and governance context. DataHub establishes which asset
> matters and which upstream and downstream dependencies are recorded.

## Scene 4 — Resolve to exact repository source (0:45–1:10)

> Tally follows the DataHub-carried dbt path, restores the missing project
> prefix, and resolves the exact repository source at a pinned revision. It
> preserves the limits too. Missing evidence stays named. Unknown never becomes
> empty.

## Scene 5 — The joined plan changes (1:10–1:38)

> With DataHub alone, the agent correctly refuses because the repository source
> is unavailable. Joined context supplies the exact path and revision. Across ten
> controlled pairs, the revision appeared in zero DataHub-only plans and all ten
> joined-context plans.

## Scene 6 — Evidence discipline (1:38–1:58)

> Tally keeps a successful read separate from a complete answer. It records what
> was observed, what resolved, which checks ran, and which conclusions remain
> explicitly not established.

## Scene 7 — Durable DataHub writeback (1:58–2:20)

> Tally writes a narrow evidence tier back to DataHub, then reads the intended
> state again. A mutation is not called successful until the after-state is
> observed.

## Scene 8 — Reproducibility and OSS proof (2:20–2:35)

> The evidence is preserved in a public Apache-2.0 repository with checksums,
> fixtures, assertions, and a judge path to verify it. I created and maintain
> workspace.json. Tally is the DataHub application I built for this hackathon.

## Scene 9 — Close (2:35–2:42)

> DataHub identifies the asset. Tally resolves it to code, changes the plan, and
> attaches the evidence.

---

## Lines this script must not drift back into

Three claims were removed in review, and each is the appealing version of
something true, which is why they are worth naming rather than just deleting.
Each is asserted absent from the spoken text by
`test/docs/narration-script.test.ts` — against `scenes.json` rather than this
file, so naming a banned phrase here does not trip the guard that forbids it.

**"workspace.json adds revision-bound repository relationships."** It does not.
The bound event carries `partners: []` and `relationships: null`. What
`workspace.json` supplies is the exact repository-relative source and the pinned
revision. Scene 5 says that instead. The same claim has come back in four
wordings across the cockpit and the README, and is guarded there by
`test/docs/readme-claims.test.ts` and here by `test/docs/narration-script.test.ts`.

**"Data blast radius."** Too broad. The evidence model distinguishes *observed*
lineage from *complete* impact, and every event in this repository carries a
completeness state saying which one it has. A phrase that collapses the two
undoes the distinction scene 6 exists to make.

**"Includes a judge path that reproduces the evidence."** Overstated. A judge can
**verify the preserved evidence** — checksums, fixtures, assertions — and that is
what scene 8 now says. Reproducing the whole judge-facing Transfermarkt
environment from a clean clone is not yet a supported path:
`scripts/reproduce-hac-152-live.sh` needs a live GMS and a Qwen endpoint. Saying
"reproduces" would claim the one thing a judge would most want to test and would
most quickly find missing.

## Claims in this script, and where they are checked

| Scene | Claim | Source |
| -- | -- | -- |
| 1 | five matches to zero, no error | `docs/claims.md` — TALLY-CLAIM-001, 002, 004 |
| 2 | dbt-project-relative versus repository-root-relative | `docs/claims.md`, `evaluation/dbt-node-coverage.md` |
| 4 | exact source at a pinned revision | `test/fixtures/golden/change-impact-event.nested.json` |
| 5 | zero of ten versus ten of ten | `evaluation/hac-150/aggregate.json` — TALLY-CLAIM-009 |
| 6 | read separate from completeness | `docs/evidence.md` |
| 7 | not successful until the after-state is observed | `writeback.bothStatesRead`, `writeback.succeeded` |
| 8 | Apache-2.0, checksums, fixtures, assertions | `LICENSE`, `evaluation/hac-152/SHA256SUMS`, `JUDGING.md` |
| 8 | provenance disclosure | `HACKATHON_PROVENANCE.md`, `docs/provenance.md` |
