// A minimal PNG reader, so captured frames can be *measured* rather than
// looked at.
//
// §8 says a review that says "looks good" is a failed review, and asks for the
// specific pixel region that lost the point. Several milestone gates go
// further and are outright numeric — M1 alone wants four distinguishable hue
// families inside a stated luminance band, and zero banding in the deep field
// at 8-bit. Neither is answerable by eye, and both are answerable exactly.
//
// Node ships zlib; PNG is a filtered scanline format on top of it. That is the
// whole dependency story (§2.2 — and this is dev tooling besides).
//
// Handles what Chromium's screenshots actually produce: 8-bit RGB or RGBA,
// non-interlaced. Anything else throws rather than guessing.

import { inflateSync } from 'node:zlib';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * @param {Buffer} buf a PNG file
 * @returns {{width:number, height:number, data:Uint8Array}} RGBA, 4 bytes/px
 */
export function decodePNG(buf) {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('not a PNG');
  }
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} unsupported (need 8)`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`PNG colour type ${colorType} unsupported (need RGB or RGBA)`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);

  let r = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[r++];
    for (let x = 0; x < stride; x++) {
      const v = raw[r + x];
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      line[x] = (
        filter === 0 ? v
          : filter === 1 ? v + a
            : filter === 2 ? v + b
              : filter === 3 ? v + ((a + b) >> 1)
                : v + paeth(a, b, c)
      ) & 0xff;
    }
    r += stride;
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev.set(line);
  }
  return { width, height, data: out };
}
