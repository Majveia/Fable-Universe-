# Working protocol for parallel agents in this container

**Not art direction. Operations.** This exists because a specific failure has
now happened five times and cost four rounds of finished work.

---

## 0 · The failure

The container reverts to an earlier commit without warning. Every time it has
happened it landed on the same commit, and every time it took **the entire
working tree with it** — including `/tmp` scratchpads. Observed five times in
one session.

What survived, every time, without exception: **anything that had been pushed
to origin.** Nothing else, ever.

The rounds that were lost were not small. One took a completed and self-verified
fog fix ("all reapplied and green"), a rebuilt star belt shader, an orbital
ascent correction, and a character visor that its author had just got right.

## 1 · The rule that follows

**Commit and push each increment as it becomes green. Not per session, not per
round, not "when the agent reports" — per increment.**

The old protocol was: agents edit, the coordinator gates and commits at the end
of a round. That protocol has a window between "work exists" and "work is
pushed" that is measured in tens of minutes, and the revert lands inside that
window roughly half the time. It cannot be made safe by being more careful; the
window is the defect.

### Agents commit their own work

Reversing the previous instruction. An agent that has brought its own files to
green **commits and pushes them itself**, immediately, before continuing.

This was originally forbidden to prevent agents colliding in git. That trade was
wrong once the revert rate was known: file ownership is disjoint by
construction, so two agents committing sequentially from one worktree is a
non-event, while an uncommitted green increment is a coin flip. A merge conflict
is recoverable. A revert is not.

## 2 · How to commit safely while others are writing

Never gate the working tree. It changes under you — that is how a commit that
gated 90 files and contained 91 reached CI red.

Gate the **index**, then commit the index:

```sh
git add -- <only your own files>     # never git add -A
TREE=$(git write-tree)               # freeze it
W=$(mktemp -d); git archive "$TREE" | tar -x -C "$W"
cd "$W" && node tools/parse.js && node tools/verify.js
# green? then, back in the repo:
git commit -m "..."                  # commits the index — the same bytes
git push origin <branch>
```

Nothing another agent writes after the `git add` can affect any later step. The
bytes measured and the bytes committed are identical by construction rather than
by timing.

## 3 · Both gates, every time

- `node tools/parse.js` — about a second. Catches the defect that has broken
  this tree four times: **a backtick inside a `//` comment inside a GLSL or CSS
  template literal**, which silently terminates the string. In prose inside a
  shader, write identifiers bare. Every agent has hit this, and so has the
  coordinator.
- `node tools/verify.js` — the offline suite. It must not go down.

If your change legitimately breaks a check, say so and argue it. Do not work
around it. One check here asserted an exact source literal and broke when
correct code changed shape; the right fix was to make the check assert the
property, and that is a conversation, not a silent edit.

## 4 · Rendering on this box

It rasterises in software and four agents share it.

- **One browser at a time.** Contention is what stalled two renders outright.
- The surface scale takes **~7 minutes to build** before its first frame.
- Wait on `!!window.AEON`, *then* on `frames > N`. Use 20-minute timeouts.
- Pass `timeout: 900000` to `page.screenshot`. Playwright's 30 s default killed
  two runs *after* the probe had already succeeded.
- `?grass=0` when grass is not the subject — it costs minutes and currently
  renders nothing anyway (see the meadow investigation).
- Hide chrome: `document.querySelectorAll('.hud').forEach(e => e.style.display = 'none')`.
- Nothing here is §5 evidence. A software rasteriser cannot measure frames, and
  `docs/captures/README.md` is explicit that such a set is fabricated evidence.

## 5 · Sessions end mid-thought

Agents are terminated by account limits, typically mid-edit, several times a
day. Two consequences:

- **Leave the tree parseable at every step.** A half-written template literal
  that survives a termination blocks everyone.
- **Say what you were about to do.** The last line of an agent's output is the
  entire handover; "now the belt shader and the JS uniform wiring" is a usable
  resume point and "working on it" is not.

Resume agents with `SendMessage` to the existing id — never a fresh spawn. The
transcript is the context, and re-briefing from scratch loses everything the
agent learned, including its own failed hypotheses, which are the expensive part.
