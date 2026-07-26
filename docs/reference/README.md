# The art reference

`CLAUDE.md` names `docs/reference/hoshi-no-tani.html` as the art north star.
Section 9 defers to it outright: *"When this section and the reference
disagree, the reference wins — read it."*

**The file is not in this repo yet.** It was not included with the
constitution, and it cannot be recovered from anywhere an agent can reach.

## Why nobody can just go and get it

Per §10, the reference arrived as a CodePen export and the original URL is an
`/editor/` link. Those require the author's browser session. No agent — not
this one, not a subagent, not a fetch tool — can open one. Any claim to have
read the pen from its URL is a hallucination, and §10 says so in those words.

So the file has to be handed over. Two ways, either is fine:

1. Drop the exported `index.html` at `docs/reference/hoshi-no-tani.html`.
2. Publish the pen and paste the public `codepen.io/<user>/pen/<id>` URL, which
   *is* fetchable, and it gets vendored to that path.

## What is blocked until then

| Blocked | Why |
|---|---|
| §M0's vendoring item | Nothing to vendor. |
| §8's blind side-by-side | The rubric's one executable comparison is *"capture the reference on the same route and score both blind."* Without the file the critic has no counterpart and every atmospheric score is unanchored. |
| §9.2 `paint()` | Band edges, wrap constants and the shadow tint are transcribed in §9.2, but §9 defers to the file on disagreement. Porting from the summary alone means porting the parts that were written down and silently dropping the parts that were not. |
| §9.4 the print | Same. The tonemap coefficients are quoted; the ordering, the clamps and the NaN firewalls are described but not given. |
| M2 and M3 gates | Both are defined against the reference's behaviour. |

Everything upstream of the atmosphere is unaffected: M0's instruments, M1's
vacuum-scale work, and every §2 invariant stand on their own.

## When it lands, record it here

§M0 asks for provenance, and §10 fixes what that means: the vendored file is
the source of truth, the `/editor/` URL is not a citation. Record, at minimum:

- where the file came from and when it was taken;
- its line count and SHA-256, so a later edit is visible as an edit;
- the three-r185-vs-r170 gap (§10): colour management and renderer defaults
  moved across that range, so anything touching `convertSRGBToLinear`, output
  colour space or render-target formats is re-verified rather than copied.

Port techniques and constants. Never files.
