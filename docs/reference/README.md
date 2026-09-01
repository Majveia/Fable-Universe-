# The art reference — provenance

`CLAUDE.md` §9 names this the art north star and defers to it outright:
*"When this section and the reference disagree, the reference wins — read it."*

| | |
|---|---|
| **File** | `hoshi-no-tani.html` |
| **Title** | *Hoshi-no-Tani — The Valley of Stars* |
| **Lines** | 6,133 — as §10 records |
| **Bytes** | 286,812 |
| **SHA-256** | `b6522eafaac66bb5bb2ab3ec6a088bb29ded9ad421c828097338831716f1b07c` |
| **Source** | CodePen export, supplied by the human on 2026-07-26 |
| **Vendored** | 2026-07-26, **byte-exact** with the export |

The file on disk is unmodified. That is deliberate: §9 gives it the last word,
so there must be exactly one unambiguous thing to read, and any local edit
would be a place for drift to hide. The SHA above is the check — if it moves,
someone edited the source of truth, and that should be visible as an edit.

§10 stands: the original `/editor/` URL is session-gated and unreadable by any
agent. It is not a source of truth and must not be cited as one. This file is.

## Verified against the constitution

Not taken on trust — §9 quotes specific constants, and they are all here:

| §9 claims | In the file |
|---|---|
| §9.4 lift `(0.017, 0.021, 0.036)` | `vec3 lift = vec3(0.017, 0.021, 0.036)*uPaint;` — line 4436 |
| §9.7 sun elevation 13.5° | `13.5, // degrees above horizon` — line 181 |
| §9.2's rationale for the half-Lambert wrap | *"13.5° sun grazes flat ground at ndl≈0.23"* — line 642, the sentence §9.2 paraphrases |
| §M1 ordered dither | `fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402909)))` — line 4459 |
| §M3's density exponent | *"x·x·inversesqrt(x): three cheap instructions instead of a pow"* — line 1978 |

## The one thing that is not self-contained

§10 says *"the pen is self-contained and zero-asset."* Nearly. It carries no
images, fonts or audio — but its importmap pulls three from a CDN:

```
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js" } }
```

That matters because §8 requires the reference to **run**: its blind
side-by-side is the rubric's only executable comparison, and on a machine with
no route to jsdelivr it renders nothing at all.

So three r180 is vendored beside it, and the substitution is made **in the dev
server on the way out** (`tools/lib.js`) rather than in the file on disk:

| | |
|---|---|
| `vendor/three-0.180.0/three.module.js` | 603,113 B · `c8211c69345d2e9949dc7a8ac969380497aa0600a5a8ac6a459c8cd02dd9cb8a` |
| `vendor/three-0.180.0/three.core.js` | 1,403,455 B · r180 splits its build across two files, and `three.module.js` imports this one by relative path |

The directory carries the version, not the filenames — `three.core.js`'s name
is fixed by the import inside `three.module.js`, so a second vendored version
would collide with it if the versions lived in filenames instead.

Run `node tools/serve.js` — or any instrument in `tools/`, which all serve
through the same function — and the reference resolves entirely from this repo.
**Verified:** the module graph loads with zero offsite requests and zero 404s,
and the vendored build reports `REVISION '180'` with `WebGLRenderer` present.

Opened through a plain `python3 -m http.server` it still works, provided the
machine can reach jsdelivr. That asymmetry is the price of leaving the file
byte-exact, and it is why `tools/serve.js` exists.

**Capturing it needs a GPU.** Resolving is not rendering. On ANGLE-over-
SwiftShader, measured twice:

- the document loads in **0.2 s** and its canvas element is created;
- setup then holds the main thread past **six minutes** without lifting the
  loading veil, so no frame is ever presented and a screenshot times out;
- **no error is thrown** and the error banner never appears.

Which is to say: a machine that looks hung here is not hung, it is computing —
a twelve-million-vertex wind-driven meadow costs what it costs without a GPU.
Do not debug this; run it on real silicon. It is the same reason §M0 insists on
a real GPU for AEON's own captures. §8's blind side-by-side is executable, and
not on a software rasteriser.

**Version note (§10).** §10 records the pen's `package.json` as pinning
`three ^0.185.1`; this export's importmap actually pins `0.180.0`, and that is
what is vendored — the file it was authored against beats the manifest beside
it. AEON vendors r170. Colour management and renderer defaults moved across
that range, so **capture the reference on its own r180**, never on AEON's r170.
Anything ported that touches `convertSRGBToLinear`, output colour space or
render-target formats is re-verified rather than copied.

## Reading notes

Things that will mislead a reader who greps rather than reads. Recorded as
found, because §11's whole point is that a day lost to one of these is a day
somebody already lost.

**The grass density exponent is 1.5.** `DENS_POW = 1.5` at line 251, with the
reasoning §M3 quotes: at exactly 1.5 the shader evaluates `(dn/d)^1.5` as
`x·x·inversesqrt(x)`, three single-cycle instructions against roughly ten for a
general `pow()`, on ~12 M vertices a frame. But the comment block at lines
220–239 still describes the **previous** law at 1.45, in detail and
persuasively, including a specific argument for why 1.45 beats 1.7. It is
stale — superseded by the block immediately below it — and `grep 1.45` finds it
three times against one hit for the live constant. §M3 transcribes the file
correctly; the file argues with itself.

**The quality table is four rows, and `px` is a multiplier.** `QUALITY` at line
210. `px` is a supersample factor applied *on top of* device pixel ratio, not a
pixel ratio itself — 0.85 on Low resolves up, everything above resolves down.
`src/quality.js` mirrors the shape.

Port techniques and constants. Never files.

---

# The other references

`hoshi-no-tani.html` is the north star and §9 defers to it outright. Two others
sit beside it, each answering a domain it does not cover. Neither has §9's last
word; both are evidence.

| | covers | provenance |
|---|---|---|
| `sakura-realm/` | weather, trees, plants, terrain — the nature systems | `sakura-realm/README.md` |
| `the-long-silence/` | **vacuum** — hulls, stations, baked worlds from orbit, the surfacing of built things | `the-long-silence/README.md` |

`the-long-silence/` is the newest and the least like AEON: it is a game, with a
game loop §4 forbids, built on a bundler §2.2 forbids, and — despite its own
README's claim — it ships assets §2.1 forbids. Its provenance record says
exactly which two modules load them and why the tree keeps them anyway.

What it is *for* is the half of the frame §9 never had to describe. Four of §9's
eight subsections assume air. Everything AEON has ever put in vacuum was
surfaced by three's stock `MeshStandardMaterial` — which `painted.js` was
written to get rid of everywhere else, and which §11 lists as a trap by name.

## The Long Silence — licence, and two ports of it

`https://github.com/achimala/TheLongSilence` — Anshu Chimala, MIT licence.

**This was ported twice, independently, and the two halves are complementary
rather than duplicate.** Worth stating plainly, because each port wrote its own
provenance and neither knew about the other:

| port | took | record |
|---|---|---|
| the cabin | the seat, the deck, the descent (Allen–Eggers, re-derived), the sqrt-mean auto-exposure | `docs/plans/LONG-SILENCE.md` |
| the vacuum surface | the plate-seam law and geometry kit (`greeble.js`), the stopping bound (`governor.js`) | `the-long-silence/README.md`, RECKONING Act F |

They also disagreed about vendoring, and the disagreement has been resolved in
favour of vendoring — so **`LONG-SILENCE.md`'s statement that "nothing from this
project is copied into the tree" is no longer true**, and is left standing there
as the record of what that port intended rather than silently edited.

`docs/reference/the-long-silence/` now carries its `src/` at pinned commit
`4845c1d`, on the `sakura-realm` precedent: §8's rubric is executable only
against a reference you can actually read, and `LONG-SILENCE.md`'s own
clause-by-clause audit is far easier to check against a tree than against a
shallow clone somebody has to re-fetch. `public/` is deliberately not vendored —
that is where its §2.1 violations live.

Its MIT notice, required either way:

```
MIT License

Copyright (c) 2026 Anshu Chimala

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
