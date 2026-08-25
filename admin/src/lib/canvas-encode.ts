import { scaledSize } from './images';

// canvas を WebP に変換する(必要なら縮小してから)。
// encodeUnderLimit の attempt コールバックとして image-upload-widget と
// crop-dialog の両方から使う。
// Safari は toBlob('image/webp') に非対応で、黙って PNG を返し quality も無視する。
// 写真の PNG は縮小しても 512KB に収まらないことが多く、そのままだと大きめの
// 画像だけ IMAGE_TOO_LARGE で必ず失敗する。WebP が得られなかった場合は
// JPEG(quality が効く)で再エンコードする。
export async function encodeCanvas(
  source: HTMLCanvasElement, quality: number, scale: number,
): Promise<Blob | null> {
  let canvas = source;
  if (scale < 1) {
    const { width, height } = scaledSize(source.width, source.height, scale);
    const scaled = document.createElement('canvas');
    scaled.width = width;
    scaled.height = height;
    scaled.getContext('2d')!.drawImage(source, 0, 0, width, height);
    canvas = scaled;
  }
  const blob = await toBlobOfType(canvas, 'image/webp', quality);
  if (blob && blob.type === 'image/webp') return blob;
  return toBlobOfType(canvas, 'image/jpeg', quality);
}

function toBlobOfType(
  canvas: HTMLCanvasElement, type: string, quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
