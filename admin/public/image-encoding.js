export const imageTargetBytes = 2 * 1024 * 1024;
const imageMaximumBytes = 10 * 1024 * 1024;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function canvasBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
}

function validImage(blob) {
  return blob && imageTypes.has(blob.type) && blob.size > 0;
}

export async function encodeWebImage(canvas) {
  const first = await canvasBlob(canvas, .92).catch(() => null);
  if (!validImage(first)) throw new Error('이미지를 변환할 수 없습니다.');
  let result = first;
  if (first.size > imageTargetBytes) {
    const second = await canvasBlob(canvas, .82).catch(() => null);
    if (validImage(second) && second.size < first.size) result = second;
  }
  if (result.size > imageMaximumBytes) {
    throw new Error('변환한 이미지가 10MiB를 초과합니다.');
  }
  return result;
}

export async function encodeThumbnail(image, original) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const longest = Math.max(width, height);
  if (longest <= 960) return null;
  const scale = 960 / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  try {
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = await canvasBlob(canvas, .79);
    if (!validImage(thumbnail) || thumbnail.size > original.size * .8 ||
        original.size - thumbnail.size < 8192) return null;
    return thumbnail;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
