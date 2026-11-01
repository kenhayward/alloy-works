import { readImageHeader, stripImage } from '@alloy-works/domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

/** The pixels as shown: decoded and turned by its orientation, as the engine draws it. */
const shown = async (bytes: Uint8Array) => {
  const { data, info } = await sharp(bytes).rotate().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels, data };
};

/** A photograph as a phone saves one: turned, with EXIF, GPS, XMP and an ICC profile. */
const photograph = (orientation: number) =>
  sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 200, g: 40, b: 10 } } })
    .composite([
      {
        input: { create: { width: 10, height: 5, channels: 3, background: { r: 0, g: 0, b: 255 } } },
        left: 2,
        top: 3,
      },
    ])
    .jpeg()
    .withMetadata({ orientation, density: 300 })
    .withExifMerge({ IFD0: { Copyright: 'Ada', Artist: 'Ada' }, IFD3: { GPSLatitudeRef: 'N' } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>')
    .toBuffer();

describe("an image stripped for an output still draws as it did (the AL plan, AL-G's risk)", () => {
  it('AST-007 keeps every orientation turned the same and every pixel the same, its EXIF reduced to how it is turned', async () => {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const original = await photograph(orientation);
      const stripped = stripImage(original);
      expect(stripped.found, String(orientation)).toEqual(
        expect.arrayContaining(['exif', 'gps', 'xmp']),
      );
      expect(await shown(stripped.bytes), String(orientation)).toEqual(await shown(original));
      const metadata = await sharp(stripped.bytes).metadata();
      expect(metadata.orientation ?? 1, String(orientation)).toBe(orientation);
      expect(metadata.density, String(orientation)).toBe(300);
      expect(metadata.xmp, String(orientation)).toBeUndefined();
      expect(Buffer.from(stripped.bytes).includes('Ada'), String(orientation)).toBe(false);
      const header = readImageHeader(stripped.bytes);
      expect(header.ok && header.header.orientation, String(orientation)).toBe(orientation);
    }
  });

  it('keeps a PNG with text and transparency drawn the same', async () => {
    const original = await sharp({
      create: { width: 12, height: 9, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 0.5 } },
    })
      .png()
      .withMetadata({ density: 144 })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>')
      .toBuffer();
    const stripped = stripImage(original);
    expect(stripped.found).toContain('xmp');
    expect(await shown(stripped.bytes)).toEqual(await shown(original));
    expect((await sharp(stripped.bytes).metadata()).density).toBe(144);
  });
});
