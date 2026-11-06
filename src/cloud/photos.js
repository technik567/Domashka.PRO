const PHOTO = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/;
const REF_PATH = /^[a-f0-9-]{36}\/(?:private\/|family\/[a-f0-9-]{36}\/)[a-f0-9]{64}\.(jpeg|png|webp)$/;
export const isPhotoReference = (value) => Boolean(value && typeof value === 'object' && value.__cloud_photo === 1 && REF_PATH.test(value.path));
export function createPhotoStore({ uid, upload, download, assertActive }) {
  const uploaded = new Set(); const images = new Map();
  async function store(uri, { target = uid, childId = '' } = {}) {
    const match = typeof uri === 'string' && uri.match(PHOTO);
    if (!match) return uri;
    if (uri.length > 2700000) throw new Error('Фото для облака: до 2 МБ. Уменьшите изображение и повторите.');
    assertActive();
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    if (bytes.length > 2000000) throw new Error('Фото больше 2 МБ.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = [...digest].map((n) => n.toString(16).padStart(2,'0')).join('');
    const path = childId ? `${uid}/family/${childId}/${hash}.${match[1]}` : `${target}/private/${hash}.${match[1]}`;
    if (!REF_PATH.test(path)) throw new Error('Неизвестный владелец фото.');
    assertActive();
    if (!uploaded.has(path)) { await upload(path, bytes, `image/${match[1]}`); assertActive(); uploaded.add(path); }
    return { __cloud_photo: 1, path };
  }
  async function pack(value, options = {}, depth = 0) {
    if (depth > 16) throw new Error('Слишком вложенная запись.');
    if (typeof value === 'string') return store(value, options);
    if (!value || typeof value !== 'object' || isPhotoReference(value)) return value;
    if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await pack(item, options, depth + 1)); return result; }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Недопустимое поле записи.');
      result[key] = await pack(item, options, depth + 1);
    }
    return result;
  }
  async function unpack(value, depth = 0) {
    if (depth > 16) throw new Error('Слишком вложенная запись.');
    if (isPhotoReference(value)) {
      assertActive();
      if (!images.has(value.path)) {
        const blob = await download(value.path); assertActive();
        if (blob.size > 2000000 || !/^image\/(jpeg|png|webp)$/.test(blob.type)) throw new Error('Облако вернуло неподдерживаемое фото.');
        const uri = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        if (images.size >= 16) images.delete(images.keys().next().value);
        images.set(value.path, uri);
      }
      return images.get(value.path);
    }
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await unpack(item, depth + 1)); return result; }
    const result = {}; for (const [key, item] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Недопустимое поле записи.');
      result[key] = await unpack(item, depth + 1);
    }
    return result;
  }
  return { pack, unpack };
}
