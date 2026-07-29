# Demo production packet — internal

Production working material for the judge demo: script, scene targets, voice
settings, pronunciation guidance, and the rendered output. Modeled on the
production-packet discipline from a prior hackathon submission — story order
first, evidence-labeled runs, transcript/captions frozen alongside the audio, no
hidden cuts.

## Internal, but tracked

**This is internal material, not a judge-facing surface.** The dividing line for
this repository is verification, not polish: anything that lets a judge check a
claim is judge-facing — receipts, manifests, digests, `docs/claims.md`, the
reproduce scripts, the stated limitations. Anything that only coordinates our own
work is internal. A shooting script is the second kind. It is redundant with the
video for anyone who watches it, and it diverges from the video the moment either
changes, so it carries drift liability and no verification value.

That is why `docs/demo-script.md` was removed rather than maintained in two
places — see HAC-268 entry 3.

**Internal does not mean untracked.** The source in this directory is committed:
it is small, it is authored by hand, and material that lives on one machine is
material already half-lost. Only generated output is gitignored:

```
/demo/output/            final rendered video
/demo/narration/output/  generated audio + manifests
```

Both are regenerable from the tracked source, and the final cut ships to Devpost
and YouTube rather than to this repository.

## Structure

```
demo/
  README.md              — this file
  script.md              — the shooting script (scenes, timings, capture plan)
  narration/
    script.md            — spoken script in story order (currently a stub)
    scenes.json          — canonical machine-readable scene source
    pronunciations.json  — safe spoken substitutions
    voice.example.json   — checked-in provisional voice config
    output/              — generated audio + manifests (gitignored)
  output/                — final rendered video (gitignored)
```

**Not yet built:** `narration/generate.mjs`, `narration/concatenate.mjs` and
`narration/generate-captions.mjs`. An earlier revision of this file listed them
as though they existed. They are HAC-154's to write; note that a `.mjs` under
`demo/` is linted by nothing, so `test/policy/file-placement.test.ts` will fail
it until `demo/` is added to a coverage config — deliberately, since the whole
point of that rule is that an uncovered directory cannot hide.

## Quality bar

- No hidden cuts that imply unsupported functionality.
- Use actual product copy and evidence — narration drawn from real UI text.
- Terminal/browser capture stays readable at normal playback size.
- Remove secrets, personal paths, unrelated tabs, notifications.
- Audio must be clean and captions accurate (sentence-level, from measured
  audio timing, not pre-recording targets).
