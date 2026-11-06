#!/usr/bin/env python3
"""Build Cloudflare Pages files from the standalone HTML + PUBLIC environment.

No Supabase admin key or SMTP credential belongs in this build. The original
tracked/downloadable HTML stays local and is copied unmodified for download.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent


def public_config(environ=None):
    env = os.environ if environ is None else environ
    url = env.get('DOMASHKA_SUPABASE_URL', '').strip().rstrip('/')
    key = env.get('DOMASHKA_SUPABASE_PUBLISHABLE_KEY', '').strip()
    site = env.get('DOMASHKA_SITE_URL', '').strip()
    captcha = env.get('DOMASHKA_TURNSTILE_SITE_KEY', '').strip()
    project = urlsplit(url)
    if (project.scheme != 'https' or not re.fullmatch(r'[a-z0-9-]+\.supabase\.co', project.netloc)
            or project.path or project.query or project.fragment):
        raise ValueError('DOMASHKA_SUPABASE_URL: нужен HTTPS-адрес проекта Supabase.')
    is_public = bool(re.fullmatch(r'sb_publishable_[A-Za-z0-9_-]{16,}', key))
    if not is_public:
        try:
            parts = key.split('.')
            payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
            is_public = len(parts) == 3 and payload.get('role') == 'anon'
        except (ValueError, IndexError, UnicodeError):
            is_public = False
    if not is_public:
        raise ValueError('Разрешён только publishable / anon ключ. Никогда service_role / secret.')
    host = urlsplit(site)
    if (host.scheme != 'https' or not host.hostname or host.username or host.password or host.query or host.fragment
            or host.hostname.endswith('.github.io') or host.hostname in ('localhost', '127.0.0.1')):
        raise ValueError('DOMASHKA_SITE_URL: нужен публичный HTTPS-адрес Cloudflare Pages/своего сайта, не GitHub Pages.')
    if captcha and not re.fullmatch(r'[A-Za-z0-9_-]{10,200}', captcha):
        raise ValueError('DOMASHKA_TURNSTILE_SITE_KEY: нужен публичный site key, не секрет CAPTCHA.')
    return {'url': url, 'publishableKey': key, 'siteUrl': site, 'captchaSiteKey': captcha}


HEADERS = '''/*
  Cache-Control: no-store
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: microphone=(self), camera=(self), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://fastly.jsdelivr.net https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: blob:; worker-src 'self' blob: https://cdn.jsdelivr.net https://fastly.jsdelivr.net; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
'''


def prepare_cloud(output_dir, source_file=ROOT / 'Domashka_PRO.html', environ=None):
    output = Path(output_dir).resolve()
    source = Path(source_file).resolve()
    if output == source.parent or output == ROOT:
        raise ValueError('Выберите отдельную папку облачной публикации, не исходники.')
    config = public_config(environ)
    html = source.read_text(encoding='utf-8')
    marker = '<script>window.__STANDALONE_BUILD__ = true;</script>'
    if marker not in html or 'window.__DOMASHKA_CLOUD__ =' in html:
        raise ValueError('Нужен чистый собранный автономный HTML, не исходный index.html/облачная сборка.')
    serialized = json.dumps(config, ensure_ascii=True, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    configured = html.replace(marker, marker + '\n  <script>window.__DOMASHKA_CLOUD__ = ' + serialized + ';</script>', 1)
    # Validate ALL inputs before writing any published file. No rm -rf and no
    # mutation of the original tracked HTML, source tree or repository root.
    output.mkdir(parents=True, exist_ok=True)
    (output / 'index.html').write_text(configured, encoding='utf-8')
    shutil.copyfile(source, output / 'Domashka_PRO.html')
    (output / '_headers').write_text(HEADERS, encoding='utf-8')
    for guide in ('USER_GUIDE.md', 'USER_GUIDE.txt', 'REFERENCE_COVERAGE.md', 'docs/CLOUD_SETUP.md', 'docs/PUBLIC_DEMOS.md', 'docs/QA_4.2.md'):
        if (ROOT / guide).is_file():
            (output / guide).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / guide, output / guide)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache' / 'cloud-site')
    args = parser.parse_args()
    output = prepare_cloud(args.output)
    print(f'Облачная статическая сборка готова: {output}')
    print('Это НЕ deployment и НЕ проверка Supabase/почты. Загрузите папку в Cloudflare Pages после серверной настройки.')


if __name__ == '__main__':
    main()
