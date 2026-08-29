# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a 100% static app: vanilla HTML/CSS/JS, **no dependencies, no build step, no bundler, no package.json**.

- **Run it**: open `index.html` directly in a browser (or serve the folder with any static server).
- **Lint/typecheck**: none configured — there is no tooling to run.
- **Tests**: no test framework in the repo. `js/solver.js` is the one pure, dependency-free module (it takes a `state` object and returns a result — no DOM access), so it's the only thing practical to test outside the browser. It ends with `if (typeof module !== 'undefined' && module.exports) module.exports = Solver;`, so it can be exercised from Node without touching the rest of the app:
  ```js
  const Solver = require('./js/solver.js');
  const res = Solver.solve(state); // state shape: see below
  ```
  When changing the solver, write a throwaway Node script that builds a `state` and asserts on `res.ok`/`res.schedule`/`res.message` rather than trying to test through the UI. For non-trivial solver changes, also fuzz-compare against `git show <prev-rev>:js/solver.js` on randomized instances to catch regressions in feasibility verdicts (false "impossible" is the dangerous failure mode) — this has caught real issues before.

## Architecture

No modules, no build: every file in `js/` attaches its API to a **global object** and is loaded via plain `<script>` tags in `index.html`, in a load-bearing order (`storage.js`, `solver.js`, then `js/ui/core.js` first among the UI files, `js/ui/swap.js` and `js/app.js` last). Getting this order wrong breaks the app silently.

- `js/storage.js` — `Storage` global: localStorage persistence, JSON import/export, `defaultState()`.
- `js/solver.js` — `Solver` global: schedule generation, a **pure function** (`Solver.solve(state) -> {ok, schedule, message}`) with no DOM dependency. See "Solver algorithm" below.
- `js/ui/core.js` — defines the `UI` global (state, `init()`, `renderAll()`). Every other `js/ui/*.js` file extends the same `UI` object via `Object.assign(UI, {...})` — they are not separate modules, just namespace-split source files for one object.
- `js/ui/tabs.js`, `io.js`, `config.js`, `profs.js`, `constraints.js`, `schedule.js`, `swap.js` — one file per tab/feature of the `UI` object (Configuration, Professeurs & dispos, Contraintes, Emploi du temps, plus import/export and cell-swap interaction).
- `js/app.js` — entry point: loads state via `Storage`, calls `UI.init(state, saveCallback)`, wires the theme toggle. `UI.init` re-renders and calls `onChange` (→ `Storage.save`) after every user edit — there's no separate "save" action, state is persisted continuously.

### State shape

```js
{
  config: { classes, subjects, slots, days, activeDays },
  volumes: { "classe|matière": heures },
  profs:   [{ id, name, subjectClasses: { matière: [classes] }, availability: [jours][slots] }],
  constraints: {
    pins:   [{ id, subj, classes: [...], day, slot, profId? }],           // créneau exact imposé
    groups: [{ id, subj, classes: [...] (>=2), hours, profId? }],          // classes partagent des heures, mais SANS créneau imposé — le solveur choisit
  },
  options: { noGapsForStudents, solverTimeBudgetMs?, solverMaxIter? },
  schedule: { "classe|jour|slot": { subj, profId, pinned } } | null,
}
```
`schedule` keys and pin/session lookups throughout the codebase use string-concatenated composite keys (`"cls|day|slot"`, `"profId|day|slot"`) rather than nested objects — grep for the `|` template-literal pattern when tracing how a cell is read or written.

### Solver algorithm (`js/solver.js`)

CSP solved by backtracking, structured in four phases:

1. **Pins application** — pins are hard placements applied before search; they decrement the hour demand for their (classe, matière) and mark their exact (classe/prof, day, slot) busy. Any check downstream that computes "how many free slots does X have" must net out slots already consumed by pins (via the `pinnedBusyClass`/`pinnedBusyProf` maps built here) — forgetting this was a real bug: a class/prof can look like it has enough capacity when counted against the raw weekly grid, while its *actual* remaining free slots (after pins) are already exhausted.
2. **Groups application** — a "group" (`constraints.groups`) is the flexible counterpart to a pin: N classes share the same hours of a subject (same prof, same slot) but *without* an imposed day/slot — the search still picks when. It decrements demand like a pin, and produces multi-class sessions (see below) instead of writing directly to the schedule. A class can have both grouped and individual hours of the same subject in the same run (e.g. 2h of Sport shared with another class, +1h alone) — the group only consumes the hours it declares.
3. **Static pre-checks** — cheap, exact necessary conditions checked before ever searching (no prof teaches a demanded subject/group; not enough truly-free slots for a (classe, matière) pair or for a group's *shared* slot; a class's total remaining demand — including hours it owes to groups — exceeds its truly-free weekly capacity; a prof who is the sole teacher of several subjects/groups is overbooked across all of them). These exist so obviously-infeasible configs fail instantly with a precise, actionable message instead of burning the search budget to rediscover the same fact.
4. **Backtracking search** — one "session" per hour of remaining demand. A session carries `classes: string[]` (length 1 for ordinary demand, length ≥2 for a group) rather than a single `cls` — a group session must find a (day, slot, prof) where *every* class in it is free simultaneously, and placing it marks all of them busy at once. Uses **dynamic MRV** (the most-constrained session is recomputed every node, not sorted once up front) plus **forward-checking** (a tentative placement is rejected before recursing if it would empty another session's domain — this is what "anticipates" dead ends instead of discovering them many levels deeper). Candidate order is **always shuffled** (Fisher-Yates, every node) before the optional `options.noGapsForStudents` compaction sort is applied as a stable tie-breaker — this is not cosmetic: a fixed deterministic order (e.g. earliest-slot-first) can walk the search into an arbitrary dead branch and then reproduce that exact same failure on every single run, since nothing about the ordering ever changes. Measured on a real near-infeasible config: deterministic ordering got stuck at 30/112 placed on 5/5 identical runs, shuffled ordering reached 107–110/112. There is no setting to disable this — it was one during early development (`options.randomize`), and it was removed once this failure mode was measured, since the deterministic path had no offsetting benefit (`noGapsForStudents` compaction is fully preserved either way — the shuffle only affects tie-breaking among otherwise-equal candidates). The "avoid gaps" heuristic is evaluated against a group session's *first* class only (a documented approximation — there's no single correct answer when classes' gap patterns disagree). A time+iteration budget (`options.solverTimeBudgetMs`, default 8000ms; `options.solverMaxIter`, default 60000000) guarantees the function always returns rather than hanging — on exhaustion it returns a message explicitly distinguishing **"proven impossible"** (search space fully exhausted) from **"budget exceeded, undetermined"**, and aggregates conflict frequency across the whole search to name the most likely bottleneck (classe(s)/matière + eligible profs), rather than reporting only the single deepest point reached.

Both the pre-checks and the search must stay consistent about what "free capacity" means once pins/groups are involved — the most common classes of solver bugs in this codebase are (a) a capacity check that forgets to subtract pinned/grouped slots, and (b) a search heuristic that's correct in isolation but changes the feasibility verdict (it must not: feasibility is a property of the CSP, not of the heuristic). When touching the session model, grep for `sess.cls` (singular) — it should no longer exist; everything is `sess.classes` (array) now, including single-class sessions.

Phases 1–3 (pin/group application, eligibility helpers, `demand`/`groups`/`sessions` construction) live in a module-private `buildContext(state)` function, not inside `solve()` — it's the single source of truth for "how many hours does a prof have to cover, and how much is he actually free," and for the `sessions` list itself. Three functions consume it: `solve()` (the search), `analyzeProfLoad(state)` (see below), and `repair()` (see below). If you ever need a fourth place that reasons about prof load or the session list, extend `buildContext` rather than re-deriving that math again.

`Solver.analyzeProfLoad(state)` is a non-search diagnostic that reports, per prof, exclusive-hours-owed vs. net-availability-remaining, sorted tightest-margin-first (surfaced in the UI as the "Charge de travail" table on the Profs tab, recomputed on every visit to that tab since volumes/pins/groups can change elsewhere). A margin of exactly 0 there is not a stable equilibrium — it means every one of that prof's free slots must be used with zero room for a class-side conflict, which in practice is close to unsatisfiable.

`Solver.repair(state, partial)` is a second, fundamentally different algorithm — local search (min-conflicts), not backtracking. `solve()` on failure now returns `{ partial: { schedule, placements, missing }, aborted }` — `schedule`/`placements` is the best valid partial assignment reached (snapshotted from an explicit `placedStack` the moment `deepestCount` improves, not reconstructed after the fact — backtracking undoes everything as it unwinds, so without that snapshot the near-solution would be lost), and `missing` is exactly which sessions didn't make it in. `repair()` seeds those missing sessions into arbitrary (but availability-respecting) slots — creating conflicts — then repeatedly moves a random conflicted session to whatever position minimizes conflicts (10% of moves are fully random, to escape local optima), until conflicts hit zero or its own time budget (`options.repairTimeBudgetMs`, default 5000ms) runs out. It is dramatically faster than exhaustive backtracking at *finding* a solution when one exists close to a near-miss (observed: an 8s backtrack timeout at 108/112 repaired to a complete, valid 126-cell schedule in ~15ms) — but unlike `solve()`, it can never prove infeasibility; a failed repair means "didn't find one this attempt," not "impossible." Both pins and already-valid placements are fair game to move during repair (moving a previously-fine session may be exactly what's needed to make room for a missing one) — only pinned cells (`pinnedBusyClass`/`pinnedBusyProf`) are permanently off-limits.

The UI (`js/ui/schedule.js`) keeps the last failed `partial` in `UI.lastPartial` (not in `state`, so a failed attempt is never accidentally persisted to localStorage) and renders it read-only (no cell-swap) below the failure message so the user sees the near-miss instead of a blank grid; the "Réparer" button is enabled exactly when `lastPartial.missing.length > 0`.

The "points de blocage" (aggregated forward-checking-wipeout/dead-end frequency) explanation is trustworthy as a *root-cause* claim only when the search actually completed (`aborted: false` — full exhaustive proof of infeasibility gives the frequency count real meaning). When the search was cut off by the time/iteration budget (`aborted: true`), that block is dropped from the message entirely — a session's dead-end count in an incomplete search often just reflects wherever the search happened to thrash, not the true global bottleneck (confirmed empirically: a prof with a comfortable +11h margin still topped the blocked list in an aborted run). Don't re-add it to the aborted branch without re-litigating that finding.
