# Cold-read kit — HAC-228

Internal. This coordinates our work; it does not let a judge verify a claim, so
it is not a judge-facing surface. It is tracked rather than left on one machine,
because material that exists in one place is material already half-lost.

The point of the kit is **lead time**. When a reader is available, the session
should cost thirty minutes, not a setup afternoon.

## Two reads, and they are not the same thing

**Informal — run as soon as HAC-218 lands.** One person, no ceremony, not the
formal witness. A cold read does not need polish; it needs something legible
enough to be *misunderstood*. Findings from this inform HAC-220's polish pass
instead of arriving after it.

**Formal — HAC-228's actual witness, after HAC-220.** Two genuinely cold readers.
By then this is confirmation rather than discovery, and a bad result is a copy
fix rather than a rework.

Running only the formal one puts discovery at the end of `218 → 226 → 220 → 228`,
four serial hops before a step that needs an outside person. That is how a
finding lands after the video and becomes a limitation instead of a fix.

## Setup

Verified working 2026-07-29, most recently on the HAC-218 first-frame branch.
Before PR #51 no non-placeholder build was possible at all, so this command is
new.

```bash
COCKPIT_SOURCE_MODE=fixture npm run dev
```

`fixture` mode is required. A placeholder build shows invented values and would
make the reader's answers meaningless — they would be reacting to
`<dataset identity unavailable>`, not to evidence. The build refuses
`COCKPIT_SOURCE_MODE=placeholder` for production, selection never returns the
provisional adapter outside placeholder mode, and the view model refuses a
non-placeholder model carrying placeholder values. Three guards, but check the
first frame anyway — if you see angle-bracket tokens, stop and fix the build
rather than running the session.

The artifact bundled by default is HAC-152's judge run,
`evaluation/hac-152/live-qwen-judge-run-bundle.json`: a validated change-impact
event **plus** the DataHub-only/joined plan comparison derived from it.

It is bound as one artifact rather than as two chosen files. The comparison
carries the digest of the event it came from, and `validateBundle` refuses the
pair if they disagree, so an event picked independently could only ever produce a
comparison the view has to report as unavailable. Setting `COCKPIT_EVENT` still
works and still renders that event; it simply carries no comparison, and the
change-plan view states that in a sentence rather than showing an empty list.

The bundle's event is a later producer run than
`test/fixtures/golden/change-impact-event.nested.json` and states **three** gaps
rather than two, so the first frame reads `3 stated gap(s)`. Same subject, same
corpus.

**Viewport: 1440 × 900.** Fixed, because HAC-218's Playwright route is asserted
at 1440×900 and 1280×800, and a reader on an arbitrary window size is testing a
layout nobody ships. Record it anyway — a session run at another size is still
usable evidence as long as the size is known.

**Route: Impact, first frame.** Do not scroll before the five seconds are up.

## Reader selection

- Has never seen this project, this cockpit, or the README.
- Not told what Tally does before the first frame.
- Technical enough to know what a data catalog and a git repository are. This is
  not a general-public comprehension test; a judge will have that context.

## Protocol

1. Open the route. Do not narrate. Do not say the product name.
2. Show the first frame for **five seconds**, then look away from the screen or
   cover it.
3. Ask the three questions **verbatim**, in this order. Do not paraphrase, do not
   prompt, do not fill silence.
4. Write down what they say, including hesitation and wrong answers, in their
   words rather than yours.
5. Only after all three, let them explore freely and note what they do first.

### The three questions

Verbatim from HAC-228's Required-witness section:

1. **What does DataHub supply?**
2. **What does workspace.json add?**
3. **What is the next action?**

### What counts

A **finding** is any answer that is wrong, absent, or arrived at after the five
seconds. Hesitation is a finding. "I think maybe…" is a finding.

A reader who answers all three correctly and quickly is a pass for that reader,
and two of those is what HAC-228 needs. One is not.

**Do not coach mid-session.** A reader who has been helped is no longer cold, and
you cannot get them back.

## Recording sheet

Copy this per reader into `evaluation/hac-228/observations/`. Record before
discussing the session with anyone, including the reader.

```yaml
reader: <initials or pseudonym — not a full name>
priorExposure: none | describe exactly what they had seen
date: <YYYY-MM-DD>
time: <HH:MM local, with timezone>
kind: informal | formal
viewport: 1440x900
route: impact
sourceMode: fixture
buildRevision: <git rev-parse HEAD>
artifact: evaluation/hac-152/live-qwen-judge-run-bundle.json

q1_datahub_supplies:
  answer: "<their words>"
  withinFiveSeconds: yes | no
  correct: yes | partial | no
q2_workspacejson_adds:
  answer: "<their words>"
  withinFiveSeconds: yes | no
  correct: yes | partial | no
q3_next_action:
  answer: "<their words>"
  withinFiveSeconds: yes | no
  correct: yes | partial | no

misunderstandings:
  - "<what they believed that is not true, in their words>"
firstFreeAction: "<what they clicked or looked at first, after the questions>"
observerNotes: "<hesitation, backtracking, anything the fields above lose>"
```

## Recording the ruling

HAC-228 completes on **two** recorded observations plus a ruling. A failure is an
actionable post-polish finding, not a reason to rewrite history — record the
finding, then decide what changes.

Do not infer results from implementation or screenshots. That is stated in the
issue and is the whole reason a human is required: everything else in this
project can be checked by a machine, and comprehension cannot.

## The part this kit cannot solve

**Two people, thirty minutes, who have never seen this project.** The kit removes
the setup cost. It does not find the readers, and that is the only link in the
chain no engineering speed moves — it fails silently, because nobody notices a
missing reader until the moment one is needed.

Against an Aug 8 video, Aug 5–6 is the practical window. Ask early; it is cheap
now and expensive on Aug 4.
