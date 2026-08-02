# Tally architecture — shared motion specification

The single source of timing for every animated presentation of
[`assets/exports/tally-architecture/tally-architecture.svg`](../assets/exports/tally-architecture/tally-architecture.svg).

Two surfaces consume this document, and neither derives from the other:

| Consumer | Surface | Implementation |
| --- | --- | --- |
| HAC-297 | This repository's README | GIF captured from a local harness |
| HAC-298 | `workspacejson.dev/showcase/tally` | Inline SVG animated at runtime |

Both read this file. Neither reads the other's output. A GIF captured from the
deployed showcase would invert HAC-296's dependency direction — the parent that
supplies the asset would end up blocked on the child that consumes it.

## What motion may and may not do

Motion controls **reading order only**. Every claim, relationship, and
conclusion in the animated presentation is already present in the static SVG. If
a beat below appears to introduce information, the beat is wrong, not the SVG.

Prohibited: ambient particles, perpetual pulsing, motion on elements unrelated to
the current beat, flashing, and transitions fast enough to be unreadable. The
complete architecture holds on screen long enough for inspection before the
sequence restarts.

## Element contract

Every beat targets a stable hook in the SVG. These hooks are non-visual — adding
them was verified pixel-identical against the pre-hook file at 1600×900 @2x.

| Hook | Element |
| --- | --- |
| `#source-datahub` / `[data-source="datahub"]` | DataHub context card |
| `#source-repository` / `[data-source="repository"]` | Repository snapshot card |
| `#coord-datahub` / `#coord-repository` | The two path strings whose disagreement *is* the mismatch |
| `#flow-datahub`, `#flow-repository` / `[data-flow="source"]` | Source connectors into the pipeline |
| `#pipeline-frame`, `#pipeline-header`, `#stage-field` | Pipeline shell |
| `#pipeline-spine` / `[data-flow="spine"]` | Dashed rail through the six stage dots |
| `#stage-read` … `#stage-observe` / `[data-stage]` | The six stages, in document order |
| `#guardrail-band` / `[data-guardrail]` | Mismatch / refusal band |
| `#flow-cockpit` / `[data-flow="event"]`, `#event-pill` | Typed event connector and pill |
| `#cockpit` | Change Impact Cockpit card |
| `#flow-writeback` / `[data-flow="writeback"]`, `#writeback-label`, `#writeback` | Writeback connector, label, and DataHub card |
| `#plan-comparison` | Controlled plan comparison lane |
| `#legend`, `#stage-separators` | Footer legend, stage separators |

`[data-stage]` is ordered; `stagger()` over the six is safe.

## ⚠️ Open ruling — blocks both consumers

**HAC-296 specifies two incompatible beat orders.**

> "…deliver typed evidence to the Cockpit, **observe writeback**, then hold the
> complete system before looping."

> "Reveal the asymmetry first, guarded join second, **observed DataHub return
> third, and Cockpit outputs last**."

The first puts Cockpit before writeback. The second puts writeback before
Cockpit. The timeline below implements **Order A** (Cockpit → writeback)
provisionally, because it is stated in the same sentence as the 12–15s target and
is therefore the more specific instruction.

To adopt **Order B**, swap beats 5 and 6 as whole blocks — their durations are
deliberately equal (2.2s each), so the total and the hold are unaffected. No
other beat moves.

Amend HAC-296 to remove the losing sentence once ruled. Do not leave both in the
issue and let each consumer pick.

## Timeline

Total **14.0s**, inside HAC-296's 12–15s target.

| Beat | Window | Duration | Targets | Motion | Easing |
| ---: | --- | ---: | --- | --- | --- |
| 0 | 0.0–0.6s | 0.6s | `#pipeline-frame`, `#pipeline-header`, `#stage-field`, `#legend` | Present at 100% from frame 1. No entrance. | — |
| 1 | 0.6–3.0s | 2.4s | `[data-source]` | Cards fade and rise (`opacity 0→1`, `y 14→0`), `stagger(0.5)`, DataHub first | `easeOut` |
| 2 | 3.0–5.0s | 2.0s | `#coord-datahub`, `#coord-repository` | Both path strings hold at emphasis (`opacity 0.55→1`) for a 1.2s dwell. This is the asymmetry: one string carries the `dbt/` prefix and the other does not. | `easeInOut` |
| 3 | 5.0–7.4s | 2.4s | `[data-flow="source"]`, then `#pipeline-spine`, then `[data-stage]` | Connectors draw (`pathLength 0→1`, 0.7s), spine draws (0.5s), then six stages resolve `opacity 0.3→1` on `stagger(0.2)` | `easeOut` |
| 4 | 7.4–8.8s | 1.4s | `#guardrail-band` | Band settles `opacity 0.4→1` once, holds. **One pass. It must not pulse** — a perpetually blinking refusal reads as an alarm state rather than a guarantee. | `easeOut` |
| 5 | 8.8–11.0s | 2.2s | `#flow-cockpit` → `#event-pill` → `#cockpit` | Event connector draws (0.6s), pill appears (0.5s), Cockpit card fades and rises (1.1s) | `easeOut` |
| 6 | 11.0–13.2s | 2.2s | `#flow-writeback` → `#writeback-label` → `#writeback` | Writeback connector draws (0.8s), label appears (0.4s), DataHub card fades and rises (1.0s) | `easeOut` |
| 7 | 13.2–14.0s | 0.8s | `#plan-comparison` | Lane fades to full. It arrives **last and separately**, because it is a controlled comparison rather than an observed fact, and nothing should suggest it is part of the deterministic path. | `easeOut` |
| Hold | 14.0–17.0s | 3.0s | — | Complete diagram, fully static, no residual motion | — |

Beats 5 and 6 are the swap pair for the ruling above.

The 3.0s hold is not padding — it is the only window in which a reader can
inspect the finished system, and HAC-296 gates on it explicitly.

### Loop

Loop the whole 17.0s cycle, restarting from beat 1 with beat 0's elements
persistent. Never fade the complete diagram out to restart; cut on the frame
boundary after the hold.

## Reduced motion

**Measured, 2026-08-02, headless Chromium, logged out:** `prefers-reduced-motion:
reduce` does **not** reach an SVG embedded through `<img>`, on GitHub or in an
isolated local page. A control page using the same CSS pattern went static under
the same emulation, so the preference and the detector both work — the preference
simply does not cross into the image's isolated document.

Consequences, per surface:

| Surface | Reduced motion | Consequence |
| --- | --- | --- |
| README GIF | **Not honorable.** A GIF autoplays for everyone. | State the limitation; do not claim the asset respects the preference. |
| README animated SVG via `<img>` | **Not honorable.** Verified above. | A `@media (prefers-reduced-motion: reduce)` block inside the SVG is delivered intact and never matches. |
| Showcase inline SVG | **Honorable.** The SVG is part of the host document. | Required: `MotionConfig reducedMotion="user"` or a `matchMedia` guard. Reduced-motion readers get the complete static SVG. |

The static SVG carries the full conclusion at every frame boundary, so a reader
who never sees motion loses reading *order*, not information. That is the
mitigation for the two surfaces that cannot honor the preference, and it is the
reason motion is restricted to sequencing.

## Capture (README GIF)

Capture from a local harness in this repository against the inline SVG — not from
the deployed showcase.

- Record one full cycle plus the hold: 17.0s.
- 12 fps. The sequence has no fast motion; 12 fps is sufficient and roughly
  halves the frame count against 24.
- Capture at the SVG's native 1600×900, downscale on export.
- Two-pass palette: `palettegen` then `paletteuse`, `max_colors=96`. The artwork
  is flat vector with a small palette.
- **Measure the result against HAC-296's 5 MB ceiling before committing.** If it
  exceeds, reduce the export width before reducing frame rate — legibility of the
  stage labels is the binding constraint, and HAC-296 requires any legibility
  tradeoff to be recorded.
- `-loop 0` for infinite loop, matching the hold-then-restart cycle above.

## Verification

- Every `[data-stage]`, `[data-flow]`, `[data-source]`, `[data-coordinate]`, and
  `[data-guardrail]` hook resolves in both consumers.
- Total runtime lands within 12–15s excluding the hold.
- The final frame is pixel-identical to the static SVG.
- No element animates outside its beat window.
- The GIF's first frame is coherent on its own — it is what a reader sees before
  the image loads fully, and what some clients show in place of animation.
- Cold read against HAC-296's five questions: what DataHub contributes, what the
  repository contributes, what Tally joins, what returns to DataHub, where the
  result and proof appear.
