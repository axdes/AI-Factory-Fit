# AI FactoryFit

> Installs an AI factory fitted to the codebase it measured, not one brought with it.

Arrive at an unfamiliar codebase, measure what it already decided, and leave
behind a gate that holds it to that — so an agent can build on it without
inventing anything.

Nothing here brings rules with it. The conventions come from the repository's own
code, the components from its own library, the style from what the client has
already shipped. What this brings is the process and the checks.

```
  client's site ──► style ──► tokens        what it looks like
  their repo    ──► scan                    how they write code
                ──► defects                 what is broken, with a standard behind it
                ──► deep                    API, screens, architecture, state, forms, i18n
                ──► security                dependencies, secrets, dangerous constructs
                ──► ai-audit                what an agent can read, and what stops it
                         │
        practices ───────┼──► compare       measurement outranks the catalogue
        techniques ──────┼──► fit           what applies HERE, with cost
                         ▼
                      install               the gate, ratcheted, only what was agreed
                         ▼
  requirement ──► draft ──► spec ──► build ──► score ──► evidence ──► measure
```

## Start here

```sh
npm install
node scripts/ds.mjs assess <repo> --exclude vendor
```

One command runs the measurement chain and prints what a client reads on day one:
the situation, how the repository writes code, what is broken with the standard
behind each number, and which techniques apply to this project. Nothing is written
to the repository.

```sh
ds report <project>                              the same, as a document to send
ds fit <project> --select a,b --reject c:reason  record what was agreed
ds install <repo> --profile reference --plan --apply  build exactly that
```

## The reference profile, and the one that is not here

`profiles/reference` is a first-party profile with all three tiers written, published
as the worked example: facts extracted from [radix-ui/themes](https://github.com/radix-ui/themes)
(MIT) — components and what they render, the closed value sets from the sibling
`*.props.tsx` files, and the token layer from `styles/tokens/*.css` — with level,
surface, description and three twin pairs authored on top. All of it re-derivable from
public code.

`profiles/own`, which most of this repository's measurements were taken against, is
not published: it was extracted from a design system that is not ours to distribute.
The test blocks that measure against it stand down when it is absent and say so —
`231` of `275` tests run without it. Point them at `reference`, or at your own library,
to run the rest. No substitute is committed in its place, because rewriting those
assertions to match a profile assembled today would turn a suite that records real
findings into one that records nothing.

## The arrival sequence, and where a person decides

`Start here` is the first morning: measure, report, agree, install. This is the rest
of it — building the factory itself — and it is written down because forty-four
commands with no stated order is a tool nobody can carry onto a site.

Timed end to end on `documenso/apps/remix`: a 358-component registry, 801 call sites,
**ten seconds**. The time is not the point. The point is which steps are seconds and
which are somebody's afternoon, because only the first kind can be run in front of a
client.

```sh
# 1 · measure — 7s.  Nothing is written to their repository.
ds assess <repo> --exclude node_modules

# 2 · the registry — 1s.  Whichever adapter opens their components.
ds adapt:react <components-dir> --out <id>      # or adapt:sfc, adapt:css

# 3 · the role map — 1s to propose, an afternoon to accept.
ds bind <id> --repo <repo>                      # lands in bindings/<id>.json.proposed

# 4 · what they actually write — 1s.
ds vocabulary <repo> --profile <id>

# 5 · the gate — 1s to plan, one command to write.
ds install <repo> --profile <id>                # --apply to write

# 6 · read back what was just written.
ds audit:output <slot>
```

**Three places a person decides, and no amount of measurement removes them.**

*The role map.* Step 3 proposes; every entry carries `proposedBecause`. Accepting it
means moving the file, refusing means deleting it — nothing reads it where it lands.
A binding says this component is the right answer for this role, and that is a claim
about their product, not about their code.

*The judgment tier.* `ds policy <id> --repo <repo>` lays out the order to write it in,
ordered by how often the codebase writes each component, with what it writes shown
underneath. The enumeration of values is extracted; what a component is FOR is not,
and nothing in this repository will ever write that line. On a 323-component profile
this is 646 assignments and it has never been done.

*What the client agreed.* `ds fit` records selections and refusals with reasons. An
artifact outside that record is not installed.

**The one thing that turns work into evidence.** Every time somebody states a need in
their own words and a person picks the component for it, that is a labelled case:

```sh
ds draft "<their words>" --profile <id> --out draft.json
# a person corrects draft.json into final.json
ds eval:choice --record draft.json final.json --profile <id>
```

This runs *after* step 3 is accepted, not instead of it. `ds draft` turns words into
roles and roles into components through the binding, so with nothing adopted it
produces an empty draft and there is nothing to correct — which is what happened the
first time this sequence was followed as written. The proposal lands in **their**
repository at `<repo>/.ds/proposals/bindings.json` and is adopted into **this** one at
`bindings/<id>.json`; the two are in different places and the command prints both.

Five distinct needs and `ds eval:choice` starts answering whether the judgment tier
is worth what it costs. Until then it refuses, and says so. That question cannot be
answered from this repository — `bind` and `draft-spec` score identically with all 93
descriptions removed, which is pinned as a proven negative — so it can only be
answered on a site.

## What ends up in their repository

```
.ds/CONVENTIONS.md      the contract, generated from their code
.ds/conventions.json    machine-readable, read by the gate
.ds/decisions.json      what the team decided — outranks the measurement, never regenerated
.ds/baseline.json       today's violations, accepted as debt
.ds/profile/            the component registry, so the gate is self-contained
scripts/gate/           conventions · score · examples · architecture · visual · runner
.dependency-cruiser.cjs architecture rules the team extends
.githooks/pre-commit    the gate on commit
```

Green on the day it lands. Only a regression turns it red.

## Three tiers, and why they are separate

Every profile splits by how extractable its content is, because that sets the
price of adopting a library:

| Tier | Content | Where it comes from |
|---|---|---|
| **Facts** | components, props, closed unions, tokens | extracted; 100%, no judgment |
| **Policy** | atomic level, surface, status | assigned once per library |
| **Judgment** | which component to pick, confusable pairs | authored; nobody ships it |

Measured across three libraries: MUI publishes **one** usable description in the
types of 127 components; Ant publishes **none** in 64. The line that decides which
component gets picked is the one no library provides. That is a day per library,
reusable across every client on that stack.

```
own    82 components ·  219 tokens · 183 union values · 82 descriptions
mui   120 components ·  160 tokens · 404 union values · 120 descriptions (authored)
antd   56 components ·  536 tokens · 386 union values ·  56 descriptions (authored)
```

One agreed screen spec validates against all three.

## Three files, three owners

After `install`, the repository holds three things that answer to different
authorities. Confusing them is how an update either never ships or silently
discards what a team agreed:

- `conventions.json` — **measured**. An artifact; regenerated freely.
- `decisions.json` — **decided**. The team's file. Outranks the measurement and is
  never written by the tool.
- `baseline.json` — **forgiven**. Carried across updates, minus debt since paid.

## Three levels of checking, each asking something different

```
ds test      are the detectors right          55 tests, mostly about false positives
ds eval      does the ruleset discriminate    4 tasks, 9 breaks, 100% caught
ds redteam   would we notice a broken check   40 mutants, 100% killed by the intended check
```

The corpus is adversarial towards the checks, not the code. A surviving mutant is
a hole in the ruleset, never a mutant to delete — and the corpus found one that
thirty-two unit tests had not.

A fourth level is other people's code. `ds survey` runs the chain over many
repositories at once, and the comparison catches what no fixture does: see below.

## What is delegated, and what is not

Delegated, because these are solved better elsewhere:

| Concern | Tool |
|---|---|
| accessibility | **oxlint** jsx-a11y — thirty rules against four hand-written patterns |
| CSS parsing | **PostCSS** — sees inside `@media`, ignores comments, keeps multi-line values |
| module graph | **dependency-cruiser** — resolves tsconfig aliases; configured per project |
| image diffing | **pixelmatch + pngjs** |
| protocol | **@modelcontextprotocol/sdk** |
| dead code · duplication · tokens | knip · jscpd · Style Dictionary / DTCG |

Kept, because nothing else does it: measuring conventions as distributions with
recency; checking invented props and out-of-union values against a registry; a
technique catalogue whose rings are **derived from recorded evidence**; a practice
catalogue where every entry carries a primary source and cannot override a
measured convention unless it is a published standard.

## The rule this was built under

Every detector's first version over-reports, and most of its errors are green
where nothing was checked:

- contrast pairs formed from token names invented 29 failures on a system whose
  own gate passes cleanly
- CLDR plural suffixes counted as 16 missing English translations in a correct file
- a skipped check reported as `PASS`; an unavailable comparison as `0 changed`
- 1176 of 1180 rounded up to `100%`
- a missing import swallowed by a `catch` and reported as "the tool is not installed"

Each is now a regression test, most asserting the **negative** direction — that a
detector stays quiet about something correct. A detector that finds real problems
and also invents them is worse than none: the invented findings teach a team to
stop reading the report.

## Verified against eleven repositories, not one

`node scripts/survey.mjs <dir> --targets <tsv>` runs the chain over many projects
and prints the results side by side. That is the point: a zero is convincing
alone and obviously broken next to a column where the same detector found 135.
Eleven public repositories — Documenso, shadcn/ui, memos, Docusaurus, TanStack
Query, Formbricks, Outline, tldraw, Excalidraw, and deliberately vue-vben-admin
and SvelteKit — surfaced seven defects the single-project runs had not:

| What it reported | What was true |
|---|---|
| `0 accessibility findings` on Outline | the project's own `.oxlintrc.json` replaced the rule set and switched jsx-a11y off — **70 findings** |
| `0 accessibility findings` on tldraw | oxlint rejected the project's config and linted nothing — **29 findings** |
| `0%` system share, all screens hand-written | only `import { X } from` was read, and only from paths matching a folder-name list — a screen with four components and one `div` read as 0% |
| `5` screens in Outline | screens live in `scenes/`, on nobody's list; resolving the **route table** finds 16 |
| `1834` import cycles in Excalidraw | 1834 *routes* through the same knots; **346 of 1090 modules** is the number a team acts on |
| `0%` of source files tested in Documenso | a monorepo package measured in isolation; the suite is in `packages/app-tests` |
| `dependency-cruiser is not installed` | it was; Docusaurus's tsconfig extends a package that was not, and a `JSON.parse` failure was reported as a missing tool |

The worst was none of those. Run against SvelteKit, the assessment printed
`0 accessibility findings · 0 screens · states handled loading 0% · error 0% ·
empty 0%` over a repository containing no React at all. Every number was
arithmetically true and all of them were false, because a zero in a report means
*looked and found none*. The framework is now established before anything is
measured, and passes that read JSX say **NOT APPLICABLE** rather than nothing.

Three more surfaced only once a project's dependencies were actually installed,
which the survey never did:

- **`0 skills`** for shadcn/ui, tldraw and Documenso. Skills ship in three
  layouts — `.claude/skills/`, `.agents/skills/`, and `skills/` at the root — and
  only one was read. It is the `SKILL.md` that makes a directory a skill, not the
  folder it sits in. shadcn 0→2, Documenso 0→6, tldraw 0→23.
- **Two projects filed under one name.** `memos/web` and `formbricks/apps/web`
  both wrote to `scans/web` and silently overwrote each other, so one client's
  numbers could be read under another client's name. Nothing about that output
  looks wrong, which makes it the worst failure here. The slot is now the
  repository plus the path inside it.
- **Six mechanisms belonging to somebody else.** With no repository above the
  target, the toolchain audit climbed four levels into a directory holding ten
  unrelated clones and credited the project with their tooling. A workspace now
  claims a package only when its own globs cover it.

## The loop, closed on a project nobody here wrote

Installed into **memos** — a React/Tailwind app with biome, vitest and its own
shadcn-derived component library — then asked for a screen:

```
ds assess     518 files, 4 of 22 mechanisms, 17 screens, 72 a11y findings
ds fit        6 techniques agreed, 1 declined with a reason
ds install    19 files created, 0 existing files changed
ds adapt:react 59 components extracted from src/components/ui, 16 with closed unions
ds build      a screen, its styles and its test
```

The generated screen passes **memos' own** `tsc`, **memos' own** `biome`, and is
collected by **memos' own** `vitest`. Getting there cost seven more defects, each
of the same family: the shell was used and never imported because memos exports
it by default; the test went where the convention said rather than where the
runner collects; the output was rejected by their formatter until theirs was the
one that ran; the profile's own import path was overwritten by an alias into a
module that does not exist; and `deep` crashed outright on TypeScript 7, whose
CommonJS entry exposes `version` and nothing else.

## What is actually measured

Not styles and accessibility. Conventions as distributions; the toolchain;
contrast, dead tokens, accessibility, hardcoded values and duplication; component
APIs, screen composition and state branches; **architecture** — import cycles,
cross-feature reach, orphans, fan-in, through dependency-cruiser; server state,
forms, i18n, resilience, types, test discipline; **security**; and what an agent
working here can read.

Every count in every artifact is a number
over a denominator, and the denominators were being computed and thrown away. On a
fixture holding one Python file, `ds assess` printed six zeros — contrast, dead
tokens, hardcoded values, duplicate modules, secrets, dangerous patterns — all
true, none of them about that repository, every one of them read as good news.
Both passes print the denominator one line above the zeros (`0 owned file(s)`,
`0 file(s) read`) and dropped it before the JSON, which is the only thing the HTML
report, the evidence pack and the summary read. Sixteen of twenty-four recorded
scans had compared zero colour pairs — Tailwind and CSS-in-JS write no rule setting
both a colour and a background — and all sixteen reported `0 contrast failures`,
green. The denominator travels with the count now, and one module decides whether
a number may be shown.

The same law, one level up: a share needs something to be a share of. On hono the
scan reported `props declaration — type Props 100%` from one file, and
`ds install --apply` wrote it into `.ds/conventions.json` under `enforce` with
`source: "whole repository"`. The gate would have failed every future file
declaring props any other way — a rule this tool invented and handed back as the
client's own decision. Distributions under five observations are now undecided by
absence rather than agreement, and every enforced rule carries the count behind it.
On four real repositories the floor removes between zero and one rule and leaves
seven to ten standing.

Where screen patterns come from, and where they do not. The question a project with
no interfaces asks first is "what should this screen look like", and the obvious way
to answer it is to measure real products and keep the shapes that repeat. Across
eight of them — outline, plane, formbricks, twenty, documenso, AFFiNE, immich,
vue-vben-admin, in React, Vue and Svelte — the shapes do not repeat. Thirty-six frame
names in the first four products and not one appears in a second: every product
invents its own frame and its own name for it. There is no catalogue of screen
archetypes to be lifted from other people's code.

Measuring that needed the screens themselves read properly first, and three things
were in the way. documenso keeps a full route tree under `app/routes/`, and the test
for Next's app router looked for an `app/` segment — so every Remix file went down
the Next branch, where the `page.tsx` rule rejected all of it: 131 screens reported
as none. Every pure React project printed `NOT APPLICABLE — this pass reads JSX, Vue
and Svelte, and this project is react` over its composition, naming react as the
reason react could not be read, while the JSON beside it held the full analysis. And
a screen with no frame was filed as a shape that could not be read, which is the
opposite claim from the one worth making: 61 of documenso's screens build their own
page out of raw elements, and that — not the archetype distribution — is the finding
a consultant arriving there needs.

So composition now reports a partition: screens rendering into a shell, screens
building their own page out of raw elements, route modules that render nothing,
layouts whose whole body is an `<Outlet />`, and anything left over named as a hole
rather than absorbed. That last counter earned its place within the hour — moving
`Outlet` into the plumbing list left every pass-through layout with no category at
all, and the counter is what showed it.

Two denominators had to be separated to get there. `archetypes()` dropped every
screen with no frame before counting, then answered "do screens here write their own
layout" from what was left — so on five screens where three build their own page and
declare a layout, the three were dropped, the share came back 0 of 2, and the
generator wrote no layout in a project where the majority write one. The detector
count and the count of everything handed in are now different fields.

The first number needed splitting too. "Renders into a shell" counted `<TableRow>`,
`<Link>` and `<SpinnerBox>` alongside real page frames, so documenso read as 53
framed screens when 14 of them render into something that declares a place to put
anything. A frame is a component that declares a slot, which is checkable rather
than a matter of the name, and the report now says both numbers on one line and
lists the two groups apart. Beside it, what each screen rests on: a route table, the framework's
own filesystem router, or a filename — of which only the last is a guess, and across
the corpus it accounts for none of them.

One level down there is. A frame declares the places a screen may fill, and those
names recur across products sharing no code, no framework and no team: of 352
distinct region names across 658 frames, 86% are local to one product, and the fifty
that are not include `title` in all eight, `header` and `label` in seven, `action`,
`actions`, `description` and `icon` in six. `ds regions <name>=<path> …` measures it
and writes `catalogue/regions.json`, which is a fact about what those frames offer
and not a recommendation about what yours should.

That vocabulary is used in exactly one place: where the repository has nothing of
its own. `ds build:screen` on a project whose screens all build their own page out
of raw elements now says so — `screen archetype NONE — of 3 screen(s): 0 render into
a shell, 3 build their own page` — states that there is no shape to write the next
screen in, marks what it writes as a proposal rather than the repository's idiom,
and lists the measured places with their counts and a pointer to where they were
measured. It never overrides a shape found in the project.

Beside the screen it also writes the frame itself, to `.ds/proposals/` — outside the
source tree, so it is not built, not linted, and nothing imports it. The screen does
not use it: a frame the screen imported would make refusing the proposal a compile
error, and a proposal that cannot be refused is a decision. Adopting it is a move
into `src`; refusing it is a delete. The places it declares are the agreed spec's
zones, each annotated with how many independent products were measured offering one,
and the ones nothing outside the project corroborates are listed apart as the first
to question. Everything else about it — how it exports, whether a stylesheet sits
beside it, which Svelte or Angular idiom it uses — is this repository's own,
measured; a proposal written in a style the team does not use gets refused for the
wrong reason. The stylesheet is written too, because an import that dangles makes
the proposal stop compiling the moment somebody takes it up.

Angular, measured on real products instead of a fixture. PeerTube and ngx-admin
between them produced five defects in one afternoon, and three of them were the kind
that reaches a client's gate as an enforced rule.

PeerTube ships in dozens of languages: 237 of its 300 templates carry Angular's `i18n`
marker, and this reported `user-facing text — literal in template 100%, translated
0%`. The check wanted `i18n=` or `i18n[`, which that codebase writes three times, and
missed the bare attribute it writes 1,620 times. ngx-admin is on Angular 15 with 136
components, not one carrying a `standalone` flag and sixteen NgModules declaring them
— reported as `standalone by default 100%`, the exact opposite, because an absent flag
means opposite things on either side of Angular 19 and nothing read the version. It is
read now, from the nearest package.json, the way the Svelte emitter reads its own; and
where no version can be read the absence is evidence of nothing and the file leaves
the distribution. Underneath both sat a regex that ended at `\n\s*}`, requiring the
decorator's closing brace on a line of its own: a project writing `@Component({ ... })`
on one line was not measured wrongly, it was not measured at all.

The larger one was not Angular's. JSX files pass through a screen test and single-file
components did not, so every `.vue`, `.svelte` and `.component.ts` was pushed as a
screen — all 331 of PeerTube's components, with the pass then reporting "27% system
share, 160 screens mostly hand-written" about a design system while calling them
screens. Every Vue and Svelte project measured had the same. They go through the same
test now: 27 screens, 20 of them from the route table. Reaching that also needed `.ts`
in the resolver's candidate list, which held every extension except the one an Angular
component is written in — so `component: HomeComponent` resolved to nothing and the
screens that were found came from a folder happening to be called `pages`.

A route in the frameworks that are not React. On vue-vben-admin all 27 screens fell
through to the filename guess, and the line that says so — `found by: file name 27 (a
guess, not a route)` — is what surfaced it. Four forms React never writes were in the
way: a route module is `const routes: RouteRecordRaw[] = [...]`, so `routes:` is
followed by a type rather than a bracket; the component is attached as
`component: () => import('…')`; the specifier uses the `#/` alias, because `@` belongs
to the scope in a pnpm workspace; and the resolver looked for its target among
`.tsx`/`.jsx` files alone, so a `.vue` path could not be found in a map that could not
contain it. A fifth was this tool's own: single-file screens were handed
`foundBy: 'naming'` flatly, so even a resolved route would have reported as a guess.
Eleven of the 27 now rest on the route table, and the sixteen that still rest on a
filename say so.

The policy tier does not come from the code, and finding that out was the work. A
component's atomic level looked like a fact about the composition graph — renders
nothing from the registry means atom, renders atoms means molecule — and against the
82 levels written by hand here that rule scored 35, with 34 of its 47 errors being
over-estimates. One pair says why: `Button` renders Icon, IconButton and Spinner and
is an atom; `Card` renders Badge, Button and MetaItem and is an organism. Identical
graphs, opposite answers, because the level says what a thing IS and a button with a
spinner in it is still a button. In-degree is no better — atoms run 0..34 incoming,
molecules 0..19, organisms 0..6, medians 1, 0 and 0.

So 646 assignments on a 323-component profile stay somebody's afternoon, and
`ds policy` makes that afternoon finishable instead of pretending to do it. Every
measured fact about a component on one line so nobody opens the source; rows ordered
by how many others render it, so the answers that decide the most come first and the
tail that decides nothing comes last; and the surface proposed from the level once
the level is given, using the correlation measured in a profile that has both rather
than a rule of thumb — atom→card 24 of 26, organism→region 15 of 18, and molecule
refused outright at 21 card against 17 region, because a majority is not an answer.
Where the extractor read only stylesheets there is no in-degree at all, and the sheet
says which weaker signal ordered it instead: a list that looks ordered and is not is
worse than an unordered one.

The check for a library duplicating itself had never run. It needs two independent
signals, because prop-name overlap alone is noise — two components with three props
each agree by accident — and the second is what a component renders. No profile
carried that field: `probe-own` never wrote it, so all 82 components of the
first-party system were incomparable and the pass returned an empty list, which every
reader takes for "no duplicates". It now follows the `sourcePath` the registry already
records, 59 of 82 became comparable, and the answer is a real zero. Along the way the
one answered pair in that profile — `Meter ~ ProgressBar` — was misread for the second
time: ProgressBar renders Meter and inherits four of its props, which is what a
wrapper looks like to a similarity score. One component rendering another is a fact
rather than a threshold, and it settles the question before any score is computed.

Accessibility was checked on React and nowhere else. Every Vue, Svelte and Angular
project reported NOT RUN — honestly, and with no way forward — while the same tool
cites WCAG 2.2 and the ARIA authoring practices as the two standards it holds a project
to. Three of four frameworks were held to nothing.

Svelte needs no plugin: its compiler emits `a11y_*` warnings itself and is installed in
every Svelte project by definition. Three lines of careless markup produce four of them.
Delegating to the compiler already there is the same move as handing the dependency
audit to the project's own package manager, and the report now credits the tool that
actually looked rather than saying "oxlint jsx-a11y" about a count oxlint never
produced. Vue and Angular have no equivalent in the box, so the refusal names the
plugin that would read them — `eslint-plugin-vuejs-accessibility` and
`@angular-eslint/template` — rather than implying nothing exists.

The survey had never been run. Pointed at six repositories side by side it reported 885
screens for SvelteKit's `packages/kit` — 779 of them `+page.svelte` files under
`test/`, every one a route by the filesystem rule and none of them a screen the package
ships. `isTest` catches a file NAMED `.test.` or `.spec.`, which is how JSX projects
mark them; a framework's own fixtures are not named that way at all. Excluding the test
trees takes that package to 0 screens, which is what it ships. And react-query's column
read 126 advisories over a 65-file package — an honest count of the whole TanStack
workspace, disclosed in security.json and nowhere the table could show it. The caveat
now names the scope beside the number.

That is what a survey is for: a number that is plausible alone becomes obviously wrong
next to five others.

Ninety-one per cent of the slowest pass was one quadratic loop. Finding near-duplicate
modules compared every file with every other: on a 9,010-file project that is four
million set intersections, sixteen of the pass's eighteen seconds, to report a few
hundred pairs. The fix is a bound derived rather than tuned — a Jaccard of 0.5 requires
`|a∩b| >= t(|a|+|b|)/(1+t)`, and since the intersection cannot exceed the smaller set,
two files whose shingle counts differ by more than a factor of two cannot reach the
threshold however much they share. Sorted by size, the inner loop stops at the first
file too large instead of running to the end. Measured on the same project: 45.1s and
289 pairs before, 12.7s and the same 289 after, and a full `ds assess` down from 45s to
35s. The bound is pinned by a test that checks the derivation rather than the number —
over a grid of set pairs, every pair it drops is one no threshold could have kept.

There is no catalogue of screen layouts, and the third attempt at building one
explained the first two. Measured across four real products, the share of screens
whose own file contains any flex, grid or `space-y` at all: outline 0 of 16, formbricks
13 of 84, plane 32 of 74, documenso 82 of 131. On outline it is never there — a screen
fills a frame and hands it children, and the arrangement lives in the frame and in the
components composed into it, a level below anything the screen file says.

So a catalogue of screen layouts cannot be measured from screens, which is the earlier
finding seen from the other side: no frame name appears in more than one product
because the frame is where the layout lives, and every product writes its own. The two
attempts before that one each over-reported in its own way — reading every flex in a
file returns the nesting rather than the shape, and `templates-table.tsx` is not a list
screen for rendering a table. What remains is what the tool already does: measure this
project's frame and write into it, and where there is none, propose one from the
agreed spec's zones with the measured region vocabulary beside it.

The one check that sees what a person sees had never run. `gate/visual.mjs` is written
into every client and was invoked by nothing — not in the commit hook, not in CI. A
check that exists, works, and never runs is the same as no check, and worse, because
the file in the repository says otherwise. Exercised end to end for the first time on
a live app: baselines captured, a clean run at zero changed, a badge recoloured and
caught at 1,538 pixels with a difference image written, then restored and clean again.

Two things that run found. With playwright installed and pixelmatch missing, an
`--update` captured three screenshots and reported "3 route(s), 0 changed" — a
consultant sets the baselines, reads that, and believes visual checking is running,
while the next run cannot compare and the setup step said nothing. Every dependency is
checked before anything is written now. And with no server to point at it excuses
itself as SKIPPED rather than reporting every route unreachable, which reads as a
failure of the change rather than of the setup. It sits in CI and not in the commit
hook, because a hook cannot assume a running app.

The client's own visual language, all the way into the file. `ds style <url>` reads a
live site into a token layer — sixty-seven values on one real site, thirteen of them
under the name the site itself gave them — and nothing downstream read it. Two passes
write these layers in different shapes, flat for a screenshot and DTCG groups for a
site, and the reader only understood the first: `ds name:tokens` answered "no colours"
on a layer holding twenty-four. So a client with no design system in code got a screen
of the right shape, from their own components, and grey.

One reader now takes either shape, and the client's own names survive it — joining the
group path in produced `--named-brand-primary` for a property the client calls
`brand-primary`, which is the one name in the file that must not be touched. Where the
project declares a spacing role itself, that is the answer and nothing overrides it;
where it declares none, the role is borrowed from the layer and the layer is written
beside the proposal, because a `var()` naming a property nobody declares is dropped by
the browser without a word. All three roles, not one: borrowing the gap alone gave a
screen with a gap, no padding and a state paragraph in default black while forty-five
dimensions sat in the file next to it. A muted foreground is borrowed only where the
client named one — picking the third-darkest colour and calling it muted is the kind of
guess a team rejects on sight. And provenance is per role, because a project can
declare its own gap and none of the rest, and a flag on the whole object made the
proposal say its measured gap came from somewhere else.

Where the visual language comes from when the project has none. `ds style <url>`
reads a live site, `ds style:image <shot.png>` a screenshot, and both stop at a token
layer of `colour-1 … colour-4` — deliberately, because `#1A73E8` is a colour and
calling it `--colour-primary` is a claim about intent that no picture carries. That
was also where the design path stopped: nothing can be bound to a role, nothing can
be written into a stylesheet, and a client is handed a list of hexes.

Four of those names are not judgment, and `ds name:tokens` proposes them with the
arithmetic attached: the ground is where the reader found it — at the edges of the
picture, not whichever colour covers most of it — the text is whatever contrasts with
that ground most, the accent is the most saturated colour that is neither, and a
surface is one within a few units of the ground still covering a large share, which
is the white card on an off-white page. On a dark screenshot the same four rules
return `#111318`, `#f2f4f8`, `#f59e0b` and `#1c1f26` with no special case, because
contrast is not darkness. Everything else is refused out loud: nothing in a picture
says green means success rather than a brand that happens to be green, one screenshot
is not a ramp, and no picture holds a font name.

Two things had to be fixed to get there, both the same defect as everywhere else.
The reader established which colour was the page ground, printed it to the terminal
and dropped it before writing the file — so a naming step had to guess the ground
back from share, which on a dense page is the card. It is recorded now, and where it
is absent the naming refuses rather than guesses. And every empty scale in
`ds style` printed `—` whether nothing was declared or things were declared and none
reached the frequency bar: on a page plainly carrying four colours, three font sizes
and two gaps, three of five sections read as a site with no palette, no typography
and no spacing. Each now says which of the two, with the counts.

Both passes had almost no tests before this — `style-from-image` none at all, and
`style-from-site` one that grepped its own source for a regex. They are served from a
local fixture now, in a separate process: a server in the test's own process cannot
answer anything, because the runner blocks the event loop it would need, and the
symptom was an empty palette that read as a detector bug.

The stylesheet it writes makes one visual decision, and only because it is not one:
a gap set from the spacing token this repository already reaches for most often.
Where none is declared it writes nothing and says where to get one — a `var()`
naming a custom property the project does not declare is dropped silently by the
browser, which is worse than a gap that was never set.

Two silences do not get a proposal. A project that already has a frame has a shape
to copy. A project whose screens render nothing has not decided to go without a
frame — the pass failed to read them, and proposing on the strength of that would
dress a reading failure as a finding.

Getting there needed three wrong answers thrown away first, each found by reading the
output rather than the code. Calling every attribute a region produced
`WorkflowRunsTable(error+isError+isLoading+onRetry+runs)` — a data table read as a
shape. Narrowing to markup-valued attributes lost `title={t("Archive")}`, the most
common region there is. Both were guesses about somebody else's component, and the
component declares it already: a prop typed `ReactNode`, a Vue or Svelte `<slot
name>`, an Angular `<ng-content select>`. Underneath all three sat a plain bug —
`[^>]*` reading an opening tag ended inside `icon={<ArchiveIcon />}`, so outline's
thirty-six `<Scene>` calls resolved four filled ones.

The whole chain, on a real repository. Measured on memos: `ds assess` read 17
screens, `ds adapt:css` extracted six class families and reported them in the tone of
a full extraction — and the next command proposed a binding for 0 of 26 roles,
correct and useless, with nothing saying why. memos is a Tailwind project and its
components are in the TSX; `ds adapt:react` found 123 of them. The CSS extractor now
says so when the proportion gives it away — a real CSS framework runs 323 families
against 234 tokens, a small one 3 against 4, a utility-class project 6 against 76 —
and points at the extractor that can read them.

From there it completes. `ds bind` proposed 14 of 26 roles with six marked
questionable and six recorded as uncovered; `ds spec` refused the original spec by
naming the three elements nothing there could carry; a spec the project can carry
validated six of six; `ds install --apply` put the gate in; and the generated screen
passed the gate built from that repository's own conventions, with four deliberate
breaks all caught.

The map itself is measured against the maps people wrote. `ds bind <profile> --check`
proposes over a profile that already has a hand-written binding and reports the
disagreements — 88 role decisions across four libraries, which is the only ground
truth there is for a table of synonyms somebody authored. The first run: 73 agreed,
5 different components, 8 missed, 2 filled where a person had deliberately refused,
and only 2 of the 7 errors flagged.

Three fixes came out of the disagreements rather than out of taste. Some roles no
library answers with a component of their own — `searchInput` was missed on three of
four and all three had the library's plain text field, `iconAction` on Ant had
`Button` — so those fall back explicitly and say which role they borrowed from. Two
entries were falsified and removed: `toolbar` for `pageHeader` contradicted MUI's own
binding, which states that MUI ships no page header, and `inlineMessage` as a
fallback for `transientMessage` was wrong in both libraries that name it, because a
toast there is a hook rather than an alert. And ties are no longer settled: where two
candidates matched at the same strength, the shortest-name tiebreak chose `Input`,
`Tag`, `Progress` and `Sheet` where people chose `TextField`, `Badge`, `Spin` and
`DialogContent` — four for four against, so the proposal now names them all and marks
the pick as a question.

It reads 82 of 88 now, nothing missed, Ant Design 26 of 26, and every one of the six
remaining disagreements is marked questionable in the proposal — the tool never
quietly contradicts the only person who looked. What all four human refusals had in
common is written into every proposal it produces: the answer was not a component at
all — a hook, a context instance, a composition of three, plain markup — and a pass
that reads a list of components cannot tell that from a role with no answer.

Two things that run blocked, both fixed. A missing binding was a Node backtrace — on
the path the generator's own report recommends. And `ds adapt:react` writes an empty
binding stub, honestly explaining why it is empty, which `ds bind` read as somebody's
decision and refused to propose over: a placeholder is not a judgment.

One law, applied to the tool itself. The toolchain audit asked whether a repository carries a
secret scanner, which is a different question from whether it has secrets — and a
project could score well on mechanisms present while shipping a private key.
`ds security` closes it, on the same terms as everything else: dependency
advisories from the project's own package manager (npm, pnpm or yarn), secrets by
fixed prefix rather than by entropy, and a short list of constructs each paired
with the mitigation that would make it fine.

That pairing is the whole discipline. On memos the first run reported three
findings and two were wrong: a file calling `escapeHTML` was flagged because the
pattern was spelled `escapeHtml` and was case-sensitive, and a mermaid render was
flagged three lines below its own `securityLevel: "strict"`. What is left is two
real ones — an admin can inject arbitrary CSS **and arbitrary JavaScript** through
instance settings — and the second is reported separately, because filling a
`<script>` is code execution and no amount of escaping makes it markup.

What it does not look at is printed with the result every time: authorisation,
CSRF, SSRF, path traversal, SQL injection, and infrastructure. Those need to
follow a value from its source, and this pass reads text.

The git history used to be on that list, which was the more embarrassing gap of
the two: a key committed in March and deleted in April is reachable by anybody
who clones, and the working-tree count said zero. Where `gitleaks` is installed it
is now run over every reachable commit — 2,800 commits scan in under a second, and
a real repository came back with eighty-one. Where it is not installed the line
reads NOT RUN with the install command, never a zero. Two clone shapes are refused
by name rather than scanned: a shallow clone, because a clean result over the
twenty commits it holds says nothing about the rest, and a blobless clone, because
reading it fetches every blob over the network — that is the one that ran past ten
minutes on a ten-thousand-commit repository and is why the check exists.

Delegating the dependency check meant meeting four package managers, and running
it across eleven repositories found a defect in each layer:

| | |
|---|---|
| **npm, pnpm, yarn classic, yarn berry** | three output shapes; parsing only npm's reported "no result" for most repositories. Verified against each manager's own summary — memos matches pnpm's 9/26/10/0 exactly |
| **distinct advisories, not paths** | yarn counts one advisory reached three ways as three. Excalidraw: 195 paths, 60 problems. Both numbers are printed, because a client running `yarn audit` sees the larger one |
| **the scope is named** | a package in a monorepo has no lockfile, so the audit covers the workspace. TanStack Query's `packages/react-query` returned 126 advisories, nearly all from the docs site — true of the repository, not of the package measured |
| **the refusal is quoted** | Outline pins `yarn@4` and the installed yarn is 1.22, which refuses. That came back as "most often there is no network" — a guess presented as a diagnosis, when the truth was in the first line the tool printed |

## The evidence pack

`ds evidence <repo> --since main` assembles the proof a reviewer reads *instead
of* the diff: what changed, whether the gate and the project's own checks hold,
what the measurements say, and — the half that makes the rest readable — what was
not checked and why.

Four verdicts, never two:

| | |
|---|---|
| `PROVEN` | every check ran and passed |
| `PARTLY PROVEN` | what ran, passed; some checks did not run, and they are named |
| `FAILED` | a failure naming a file this change touched |
| `FAILED ELSEWHERE` | red before this arrived — confirm it, then decide separately |

The last one settles an argument rather than starting it. Run against memos the
pack reports FAILED ELSEWHERE: their `lint` fails on a type error in
`src/types/markdown.ts` and one test fails on an unapplied patch, and neither
names a file the change touched. The test reads the whole output, not the
truncated display copy — searching the truncation would call a failure unrelated
because the line naming the file fell off the top.

## What an agent can be handed here

`ai-audit` measured mechanisms and left the reader to draw the conclusion.
It now derives the conclusion, on three levels borrowed from a reference model
that names them well — assisted, delegated-review, gated-autonomous — with each
requirement pointing back at a measurement:

```
✓ assisted             the agent advises; a person decides and writes
✗ delegated-review     needs a way to score the output; knowledge reachable on
                       demand; a check that runs without being asked
✗ gated-autonomous     needs something that stops a bad turn with nobody watching
```

Derived, never declared. A team that calls itself autonomous with nothing that
stops a bad turn has declared a wish — and autonomy at the gate is not the absence
of a person, it is a person who can see what would have stopped the agent and has
decided not to intervene yet.

Two things `build` refuses to do, and says so:

- **`CONFORMS IN STYLE, DOES NOT COMPILE YET`** — the conventions gate checks
  house style, not that a module is there. Building against a profile the project
  has not adopted is reported, with the components named, rather than passed.
- **What was already red.** `install` runs the project's own `lint` and
  `typecheck` before writing anything, because the gate delegates to them: if one
  was failing yesterday the gate is red today and gets the blame. memos' `lint`
  was already failing on a file this tool never touched, and the install says so.

## Every command

```sh
ds assess <repo>                    measure everything, report
ds report <project>                 the assessment as a self-contained document
ds fit <project> --select/--reject  record what the client agreed and declined
ds install <repo> --plan            build exactly what was agreed (--apply to write)
ds update <repo>                    rebuild after the project or the team moved
ds score <repo> --profile <id>      verify · baseline · evals, one scorer
ds measure <repo> --baseline        record a starting point; later, compare
ds style <url> · ds style:tokens    read a site; turn it into tokens, or diff it against code
ds draft "<requirement>"            a draft spec from a requirement
ds spec <file> --profile a,b,c      check one spec against several libraries
ds build <spec> --repo <r>          screen, styles and test in that repo's idiom
ds mcp --profile <id>               serve the registry to any agent, anywhere
ds adapt:mui · adapt:antd · adapt:css
ds security <repo>                  dependencies, secrets, dangerous constructs
ds vocabulary <repo> --profile <id> which prop values this codebase actually writes
ds audit:output [slot]              the numbers just written, read the way a sceptic reads them
ds eval:choice [--record a b]       whether the registry lets the right component be chosen
ds adapt:figma --from <json>        their Figma variables as a token layer
ds evidence <repo> --since main     the proof a reviewer reads instead of the diff
ds adapt:react <dir> --out <id>     a client's own React components into a profile
ds eval · ds redteam · ds test
ds survey <dir> --targets <tsv>     the chain over many repositories, side by side
```

## What this does not do

- **Route registration is printed, never performed.** Editing a router changes
  what the application does rather than adding to it.
- **`build` produces a screen, styles and a test that pass the repository's own
  eslint, stylelint, vitest and gate.** Real data still has to be wired in; the
  three state branches do not change when it is.
- **Attribution in `measure` is correlation against a stated hypothesis.** Enough
  to move a ring, not to call causal, and the report says so.
- **Everything static is static.** Each detector records what it cannot see, so a
  zero is never mistaken for a clean bill of health.
- **Visual baselines are verified here but not in a client pipeline** — that needs
  their runner, with `pixelmatch`, `pngjs` and `playwright` installed.
