import { UnprocessableEntityException } from '@nestjs/common';
import sharp, { type OutputInfo } from 'sharp';

/** IMG-01 limits. The pixel count is checked before decoding (decompression bombs). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MIN_IMAGE_SIDE = 100;
export const MAX_IMAGES_PER_PRODUCT = 20;

export type ImageFormat = 'jpeg' | 'png' | 'webp';

const EXTENSION: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ProcessedImage {
  body: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
}

const refuse = (code: string, message: string) =>
  new UnprocessableEntityException({ code, message });

/**
 * Type from the leading bytes; the client's Content-Type and file name are never used.
 * SVG, GIF, TIFF, HEIC and everything else are refused before any decoder sees them.
 */
export function detectFormat(b: Buffer): ImageFormat | undefined {
  if (b.length < 12) return undefined;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.subarray(0, 8).equals(PNG)) return 'png';
  const riff = b.toString('latin1', 0, 4) === 'RIFF';
  return riff && b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : undefined;
}

/**
 * Decodes and re-encodes the image: orientation is applied, then every byte outside the
 * pixels (EXIF, GPS, XMP, trailing data) is dropped. Animations keep the first frame.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const format = detectFormat(input);
  if (!format) {
    throw refuse(
      'IMAGE_TYPE_UNSUPPORTED',
      'Yalnızca JPEG, PNG ve WebP görselleri yüklenebilir',
    );
  }
  let data: Buffer;
  let info: OutputInfo;
  try {
    const image = sharp(input, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'error',
    })
      .rotate()
      .toColourspace('srgb');
    const encoded =
      format === 'jpeg'
        ? image.jpeg({ quality: 90 })
        : format === 'png'
          ? image.png()
          : image.webp({ quality: 90 });
    ({ data, info } = await encoded.toBuffer({ resolveWithObject: true }));
  } catch {
    throw refuse('IMAGE_INVALID', 'Görsel okunamadı veya çok büyük');
  }
  if (Math.min(info.width, info.height) < MIN_IMAGE_SIDE) {
    throw refuse(
      'IMAGE_TOO_SMALL',
      `Görselin kısa kenarı en az ${MIN_IMAGE_SIDE} piksel olmalı`,
    );
  }
  return {
    body: data,
    contentType: `image/${format}`,
    extension: EXTENSION[format],
    width: info.width,
    height: info.height,
  };
}
