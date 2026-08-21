// Wood and leaves, as materials. CLAUDE.md §9.2, §9.5.
//
// `tree.js` grows the skeleton and `life.js` hangs clumps on the tips it ends
// at, and both of those were right before this file existed. What was wrong was
// the last step:
//
//     new THREE.MeshStandardMaterial({ color: …, roughness: 1, flatShading: true })
//
// — for the bark, and the same again for the canopy. A PBR lambert-plus-GGX
// over three scene lights, on the two objects in a surface frame that §9.2 has
// the most to say about.
//
// Three consequences, and none of them is subtle once named:
//
//   1. **The trees were outside the art direction.** §9.2 opens by saying every
//      lit surface goes through one function. The ground goes through it, and
//      so does every one of three and a half million grass blades — they carry
//      the wrapped diffuse, the three-stop ramp with drawn band edges, the
//      hemispheric fill and the transmission. The trees standing in that grass
//      were shaded by a different model with different maths, so the frame held
//      two lighting doctrines and the trees were in the losing one.
//
//   2. **Leaves did not transmit.** A leaf is a thin translucent thing and the
//      single largest fact about how a canopy looks is that light comes
//      *through* it from behind. `sakura-realm/src/world/grass.js` annotates
//      that term "does more for realism than anything else here", and §9.2
//      specifies it exactly. A MeshStandardMaterial has no such term at any
//      setting, so a backlit crown came out as a dark mass in front of a bright
//      sky — the one reading a real canopy never gives.
//
//   3. **No shadow, in either direction.** The wood did not cast, and it did
//      not receive. That was not this file's fault — until the commit before
//      this one there was no shadow map in the build to cast into. There is
//      now, so this takes it.
//
// ---------------------------------------------------------------------------
// The method, and where it comes from
//
// The shape is `flora.js`'s blade shader, deliberately: grass and leaves are
// the same problem at two scales — a thin translucent surface, densely
// clustered, lit mostly by wrap and transmission rather than by specular — and
// the frame is coherent exactly to the degree that they are lit by the same
// rules. The constants are §9.2's, unchanged.
//
// From `docs/reference/sakura-realm/src/world/grass.js` (MIT, © 2026 Leonxlnx)
// come three details its own comments single out, and §10's rule applies — the
// method ports, the file does not:
//
//   · **the two-sided flip.** "A blade seen from behind must not go black."
//     Half the triangles of any clump face away from the eye and a one-sided
//     normal makes exactly half a canopy dark for no physical reason.
//   · **occlusion down the axis**, which that file calls "most of what gives
//     the field depth". A crown is a volume, and the inside of a volume is
//     darker than its surface. This is the cheapest depth cue there is: one
//     attribute, no pass.
//   · **per-element value variation**, so no two clumps return the same green.
//
// What AEON adds is the ramp. The reference lerps its albedo; §9.2 asks for a
// three-stop hue path with *visibly banded* edges, and §11 lists that band edge
// by name as the first thing a physically-based instinct deletes. It is not
// deleted here.

import * as THREE from 'three';

/**
 * The leaf colour path, as three stops rather than two.
 *
 * §9.1's palettes are hue *paths*, not brightness ramps: a leaf in shadow is
 * not a darker version of a leaf in sun, it is a bluer one, and a leaf in full
 * sun runs toward yellow-green rather than toward white. Deriving all three
 * from one base keeps a world's seeded canopy colour in charge while giving the
 * ramp somewhere to go — the same derivation the terrain does when `?mat=` is
 * off, and for the same reason.
 */
export const FOLIAGE_GLSL = /* glsl */`
  struct Leaf { vec3 shade; vec3 mid; vec3 lit; vec3 trans; };

  Leaf leafColour(vec3 base, float crown, float var) {
    Leaf f;
    // deep crown runs cooler and bluer, the sunlit outside warmer
    vec3 inner = mix(base * 0.62, vec3(0.16, 0.26, 0.30), 0.30);
    vec3 outer = mix(base, vec3(0.74, 0.80, 0.36), 0.22);
    f.mid   = mix(inner, outer, smoothstep(0.15, 0.80, crown));
    f.shade = mix(f.mid * 0.58, vec3(0.20, 0.26, 0.40), 0.26);
    f.lit   = mix(f.mid * 1.24, vec3(0.86, 0.88, 0.52), 0.24);
    // Transmission is not the albedo. Light that has been *through* a leaf has
    // crossed chlorophyll twice, so it comes out yellow-green and warm however
    // blue-green the leaf looks in reflection. Using the albedo here is the
    // common mistake and it reads as the canopy merely getting brighter.
    f.trans = mix(base, vec3(0.92, 0.86, 0.30), 0.55);
    // no two clumps the same green (§9.5)
    float v = mix(0.84, 1.18, var);
    f.shade *= v; f.mid *= v; f.lit *= v; f.trans *= v;
    return f;
  }
`;

const LEAF_VERT = /* glsl */`
  attribute float aCrown;
  attribute float aVar;
  varying vec3 vW;
  varying vec3 vN;
  varying float vCrown;
  varying float vVar;

  void main() {
    vCrown = aCrown;
    vVar = aVar;
    vec4 wp = instanceMatrix * vec4(position, 1.0);
    vW = (modelMatrix * wp).xyz;
    // The clump is scaled non-uniformly, so the normal needs the inverse
    // transpose of the instance matrix and not the matrix. Skipping this is the
    // classic instancing bug and it shows up as a crown lit from the wrong side
    // wherever a clump is squashed — which, here, is all of them.
    //
    // For an instance matrix that is rotation times a diagonal scale, R*S, the
    // normal transform is R*inverse(S) — so scaling the normal down by S once
    // to undo the scale baked into nm, and once more for the inverse, is exact
    // rather than approximate, and costs three reciprocals instead of a matrix
    // inverse.
    mat3 nm = mat3(instanceMatrix);
    vec3 inv = 1.0 / max(vec3(length(nm[0]), length(nm[1]), length(nm[2])), vec3(1e-6));
    vN = normalize(mat3(modelMatrix) * (nm * (normal * inv * inv)));
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`;

const LEAF_FRAG = (shadowGLSL) => /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uBase;
  uniform vec3 uCam;
  uniform float uDusk;
  varying vec3 vW;
  varying vec3 vN;
  varying float vCrown;
  varying float vVar;
  ${shadowGLSL || ''}
  ${FOLIAGE_GLSL}

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(uCam - vW);
    // a leaf seen from behind must not go black
    if (dot(N, V) < 0.0) N = -N;

    Leaf f = leafColour(uBase, vCrown, vVar);

    // §9.2's wrapped diffuse. Non-negotiable at low sun: at the 8-18 degree
    // spawn band §9.7 forces, plain Lambert puts most of a crown in the shade
    // band and golden hour reads as dusk.
    float ndl = dot(N, uSunDir);
    float wrap = clamp(ndl * 0.62 + 0.46, 0.0, 1.0);

    // A crown is a volume and the inside of it is dark. This is the reference's
    // ao term one object class up, and it is most of what stops a canopy
    // reading as a solid painted ball.
    float ao = mix(0.30, 1.0, pow(clamp(vCrown, 0.0, 1.0), 0.6));

    float sh = ${shadowGLSL ? 'sunShadow(vW, ndl)' : '1.0'};

    // the three-stop ramp, with the band edges drawn rather than smoothed away
    vec3 col = mix(f.shade, f.mid, smoothstep(0.10, 0.44, wrap));
    col = mix(col, f.lit, smoothstep(0.52, 0.86, wrap));
    // §9.2: shadows change hue, they do not go black. The key keeps a floor and
    // what replaces it is the sky, so a shaded crown goes blue rather than grey.
    col *= ao * mix(0.30, 1.0, sh);
    col *= uSunColor * mix(0.35, 1.0, uDusk);
    col += uSkyColor * (0.12 + 0.20 * ao) * f.mid;
    col += uSkyColor * 0.10 * (1.0 - sh) * f.mid;

    // §9.2's subsurface transmission, and the single most important term here.
    // Only a leaf nearly edge-on to the sun transmits, because this is light
    // coming *through* rather than bouncing off — which is why the exponent
    // sits on 1 - |dot(N, sun)| and not on the wrap. A backlit crown lights up
    // from inside; a frontlit one does not, and both are correct.
    float trans = pow(max(dot(V, -uSunDir), 0.0), 3.2)
                * pow(1.0 - abs(dot(N, uSunDir)), 2.2);
    // Shadow gates it. Light cannot come through a leaf that the trunk in front
    // of it is standing in the way of, and without this gate a shadowed crown
    // glows exactly as hard as a lit one.
    col += f.trans * trans * 0.85 * uDusk * mix(0.25, 1.0, sh);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const BARK_VERT = /* glsl */`
  attribute float aBarkAO;
  varying vec3 vW;
  varying vec3 vN;
  varying float vAO;

  void main() {
    vAO = aBarkAO;
    vec4 wp = instanceMatrix * vec4(position, 1.0);
    vW = (modelMatrix * wp).xyz;
    // a bone is a unit ring scaled to its own radius and length, so the same
    // inverse-scale correction the leaves need applies here and matters more:
    // a segment's length-to-radius ratio runs from about 3 to about 40
    mat3 nm = mat3(instanceMatrix);
    vec3 inv = 1.0 / max(vec3(length(nm[0]), length(nm[1]), length(nm[2])), vec3(1e-6));
    vN = normalize(mat3(modelMatrix) * (nm * (normal * inv * inv)));
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`;

const BARK_FRAG = (shadowGLSL) => /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uBark;
  uniform vec3 uCam;
  uniform float uDusk;
  varying vec3 vW;
  varying vec3 vN;
  varying float vAO;

  ${shadowGLSL || ''}

  // Bark is not smooth, and at 1.68 m eye height a trunk is one of the few
  // surfaces close enough for that to matter. Two cheap axial bands stand in
  // for fissures: one coarse, one fine, both running *up* the trunk because
  // that is the direction bark splits.
  float barkGrain(vec3 p) {
    float a = sin(p.x * 34.0 + p.z * 27.0) * 0.5 + 0.5;
    float b = sin(p.x * 91.0 - p.z * 78.0 + a * 2.4) * 0.5 + 0.5;
    return a * 0.62 + b * 0.38;
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(uCam - vW);
    if (dot(N, V) < 0.0) N = -N;

    float ndl = dot(N, uSunDir);
    float wrap = clamp(ndl * 0.62 + 0.46, 0.0, 1.0);
    float sh = ${shadowGLSL ? 'sunShadow(vW, ndl)' : '1.0'};

    float grain = barkGrain(vW);
    // the fissures are darker than the ridges, and they hold the ambient
    vec3 base = uBark * mix(0.74, 1.10, grain);

    // §9.1's hue path: bark in shadow goes violet, bark in sun goes warm.
    vec3 shade = mix(base * 0.55, vec3(0.24, 0.24, 0.38), 0.30);
    vec3 lit   = mix(base * 1.20, vec3(0.82, 0.66, 0.44), 0.26);
    vec3 col = mix(shade, base, smoothstep(0.10, 0.44, wrap));
    col = mix(col, lit, smoothstep(0.52, 0.86, wrap));

    // A trunk is darkest where it meets the ground: the undergrowth occludes
    // it, and so does its own root flare. This is the same axial occlusion the
    // leaves use, and it is what sits a tree *into* the meadow instead of on
    // top of it.
    col *= mix(0.46, 1.0, vAO) * mix(0.30, 1.0, sh);
    col *= uSunColor * mix(0.35, 1.0, uDusk);
    col += uSkyColor * (0.10 + 0.12 * vAO) * base;
    col += uSkyColor * 0.09 * (1.0 - sh) * base;

    // §9.2's backlight rim — "the connective tissue of the whole image". On a
    // trunk it is what separates a dark bole from the dark wood behind it.
    float rim = pow(1.0 - max(dot(N, V), 0.0), 4.2)
              * smoothstep(0.05, 0.85, dot(V, -uSunDir));
    col += uSunColor * rim * 0.34 * sh * uDusk;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Shared uniforms, built once per world.
 *
 * The sun and sky come in as **the same uniform objects** the sky, the terrain
 * and the meadow already hold — §M3's one-field doctrine applied to light. A
 * tree cannot be lit by yesterday's sun because there is only one sun object
 * and everything on the world points at it.
 */
function shared({ sunDir, sunColor, skyColor, cam, dusk }) {
  return {
    uSunDir: sunDir,
    uSunColor: sunColor,
    uSkyColor: skyColor,
    uCam: cam,
    uDusk: dusk ?? { value: 1 },
  };
}

/** the canopy: §9.2's ramp, crown occlusion, and the transmission that matters */
export function foliageMaterial(opts) {
  const { base, shadowGLSL = null, shadowUniforms = null } = opts;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared(opts),
      uBase: { value: base },
      ...(shadowUniforms ?? {}),
    },
    vertexShader: LEAF_VERT,
    fragmentShader: LEAF_FRAG(shadowGLSL),
    // A crown is a volume of clumps and half of every clump faces away. Culling
    // it would open the mass up from any angle where the eye can see between
    // two tips, which is most of them.
    side: THREE.DoubleSide,
  });
}

/** the wood: the same ramp, an axial occlusion, and §9.2's rim */
export function barkMaterial(opts) {
  const { bark, shadowGLSL = null, shadowUniforms = null } = opts;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared(opts),
      uBark: { value: bark },
      ...(shadowUniforms ?? {}),
    },
    vertexShader: BARK_VERT,
    fragmentShader: BARK_FRAG(shadowGLSL),
  });
}
