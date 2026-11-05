/** Capability checks, not a promise that every native WebView is detectable. */
export function getBrowserEnvironment({ navigator: nav = globalThis.navigator, location = globalThis.location, secureContext = globalThis.isSecureContext } = {}) {
  const ua = nav?.userAgent || '';
  const ios = /iPad|iPhone|iPod/i.test(ua) || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1);
  const mobile = ios || /Android|Mobile/i.test(ua);
  const protocol = location?.protocol || '';
  const localFile = ['file:', 'content:'].includes(protocol);
  const embeddedIOS = ios && (!/Safari\//i.test(ua) || /HTML[\s_-]*Viewer|WKWebView/i.test(ua));
  const host = location?.hostname || '';
  const loopbackPage = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(host);
  const secure = typeof secureContext === 'boolean' ? secureContext : protocol === 'https:' || (protocol === 'http:' && loopbackPage);
  return { ios, mobile, protocol, localFile, embeddedIOS, secure,
    unsafeNativeMedia: ios && (localFile || embeddedIOS || !secure || protocol !== 'https:'),
    origin: localFile ? 'null' : location?.origin || '',
  };
}

export const IOS_CAMERA_HELP = 'В HTML Viewer камера может завершить само iOS-приложение — сайт не может перехватить такой сбой. Снимите задание обычной «Камерой» iPhone, вернитесь и выберите готовое фото в «Галерее» (не пункт «Снять фото»). Если и выбор фото не работает, откройте сайт в Safari по HTTPS. Прямой вызов камеры здесь отключён для безопасности.';
export const VOICE_FALLBACK_HELP = 'Нажмите на поле задания и используйте микрофон экранной клавиатуры. На iPhone: Настройки → Основные → Клавиатура → Включить диктовку. Для голосового ввода кнопкой сайта откройте его в Safari/Chrome по HTTPS; поддержка зависит от браузера, ОС и разрешений.';
