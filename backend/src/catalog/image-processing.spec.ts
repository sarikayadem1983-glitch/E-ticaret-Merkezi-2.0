import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectFormat, processImage } from './image-processing.js';

const base = (width = 200, height = 120) =>
  sharp({ create: { width, height, channels: 3, background: '#e07020' } });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { response: { code: string } }).response.code;
  }
  return 'accepted';
};

describe('processImage (IMG-01)', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'accepts %s by content',
    async (f) => {
      const out = await processImage(await base().toFormat(f).toBuffer());
      expect(out).toMatchObject({
        contentType: `image/${f}`,
        width: 200,
        height: 120,
      });
      expect(detectFormat(out.body)).toBe(f);
    },
  );

  it('removes EXIF/GPS and applies the orientation first', async () => {
    const input = await base()
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: {
          IFD0: { Copyright: 'GIZLI-SAHIP' },
          IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 0/1 0/1' },
        },
      })
      .toBuffer();
    expect(input.includes('GIZLI-SAHIP')).toBe(true);
    const out = await processImage(input);
    const meta = await sharp(out.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.body.includes('GIZLI-SAHIP')).toBe(false);
    expect([out.width, out.height]).toEqual([120, 200]);
  });

  it('drops data appended after the image', async () => {
    const png = await base().png().toBuffer();
    const out = await processImage(
      Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]),
    );
    expect(out.body.includes('<script>')).toBe(false);
  });

  it('refuses other types, whatever they claim to be', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
    );
    const gif = await base().gif().toBuffer();
    const pdf = Buffer.from('%PDF-1.7 ........');
    for (const b of [svg, gif, pdf, Buffer.alloc(0)]) {
      expect(await code(processImage(b))).toBe('IMAGE_TYPE_UNSUPPORTED');
    }
  });

  it('refuses broken, too small and too many pixels', async () => {
    const jpeg = await base().jpeg().toBuffer();
    expect(await code(processImage(jpeg.subarray(0, 200)))).toBe(
      'IMAGE_INVALID',
    );
    const small = await base(99, 300).png().toBuffer();
    expect(await code(processImage(small))).toBe('IMAGE_TOO_SMALL');
    const bomb = await base(8000, 5001).png().toBuffer();
    expect(await code(processImage(bomb))).toBe('IMAGE_INVALID');
  }, 20_000);
});
