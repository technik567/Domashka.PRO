export const MAX_PHOTOS = 4;

export function normalizePhotos(images, imageB64) {
  const photos = Array.isArray(images) && images.length ? images : imageB64 ? [imageB64] : [];
  if (photos.length > MAX_PHOTOS) throw new Error(`Можно отправить до ${MAX_PHOTOS} фото за один запрос.`);
  let size = 0;
  for (const photo of photos) {
    if (typeof photo !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(photo)) {
      throw new Error('Не удалось подготовить фото для ИИ. Загрузите JPG/PNG/WebP заново; HEIC при необходимости сохраните как JPG.');
    }
    size += photo.length;
  }
  if (size > 20 * 1024 * 1024) throw new Error('Фото слишком большие. Уменьшите снимки или отправьте меньше страниц (до 20 МБ после кодирования).');
  return photos;
}

export function choosePhotoPlan(photos, requested = 'auto', capability = { maxImages: 0 }) {
  if (!['auto', 'vision', 'ocr'].includes(requested)) throw new Error('Неизвестный способ обработки фото. Выберите его заново.');
  if (!photos.length) return 'none';
  const canSendImages = capability.maxImages > 0 && photos.length <= capability.maxImages;
  if (requested === 'vision' && !canSendImages) {
    throw new Error(capability.maxImages > 0
      ? `Этот шлюз принимает само фото только по ${capability.maxImages} за запрос. Уберите лишние снимки или выберите Gemini / OpenRouter Vision. Автоматической подмены на OCR не будет.`
      : 'Выбранная модель не настроена для приёма изображений. Выберите Vision-модель либо явно переключите фото в режим OCR. Для Ollama нужна мультимодальная модель и включённая поддержка фото в настройках.');
  }
  return requested === 'ocr' || !canSendImages ? 'ocr' : 'vision';
}

export function withOpenAiImages(messages, photos) {
  let lastUser = -1;
  messages.forEach((message, index) => { if (message.role === 'user') lastUser = index; });
  return messages.map((message, index) => index === lastUser && photos.length ? {
    role: 'user', content: [
      { type: 'text', text: String(message.content || 'Рассмотри изображения и помоги с заданием.') },
      ...photos.map((url) => ({ type: 'image_url', image_url: { url } })),
    ],
  } : { role: message.role, content: String(message.content || '') });
}

export function getPhotoInputLabel(mode) {
  if (mode === 'vision') return 'ИИ получил само изображение (Vision)';
  if (mode === 'ocr') return 'ИИ получил распознанный текст (OCR)';
  return '';
}
