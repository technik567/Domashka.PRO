#!/usr/bin/env python3
"""Prepare ONLY the existing Worker's public static assets, never deploy.

No ambient build environment is serialized. Cloudflare's deployment token,
Supabase service keys and CAPTCHA secrets must stay outside this directory.
"""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

try:
    from .prepare_cloud import ROOT, PUBLIC_DOCS, prepare_cloud, public_config
except ImportError:  # python3 scripts/prepare_worker.py
    from prepare_cloud import ROOT, PUBLIC_DOCS, prepare_cloud, public_config

WORKER_NAME = 'gentle-fog-7c3b'
OUTPUT = '.cache/worker-site'
MANIFEST = '.cache/worker-build-manifest.json'
PUBLIC_FIELDS = {
    'url': 'DOMASHKA_SUPABASE_URL',
    'publishableKey': 'DOMASHKA_SUPABASE_PUBLISHABLE_KEY',
    'siteUrl': 'DOMASHKA_SITE_URL',
    'captchaSiteKey': 'DOMASHKA_TURNSTILE_SITE_KEY',
}


def load_public_environment(root=ROOT):
    raw = json.loads((Path(root) / 'cloudflare.public.json').read_text(encoding='utf-8'))
    if not isinstance(raw, dict) or set(raw) != set(PUBLIC_FIELDS) or any(not isinstance(v, str) for v in raw.values()):
        raise ValueError('cloudflare.public.json: разрешены только четыре публичных параметра.')
    environment = {PUBLIC_FIELDS[key]: value for key, value in raw.items()}
    validated = public_config(environment)
    if validated != raw or raw['siteUrl'] != 'auto' or not raw['captchaSiteKey']:
        raise ValueError('Нужны нормализованная публичная конфигурация, siteUrl:auto и Site key Turnstile.')
    return environment


def prepare_worker(root=ROOT):
    root = Path(root).resolve()
    environment = load_public_environment(root)
    wrangler = json.loads((root / 'wrangler.json').read_text(encoding='utf-8'))
    if (not isinstance(wrangler, dict) or wrangler.get('name') != WORKER_NAME
            or not isinstance(wrangler.get('assets'), dict)
            or wrangler['assets'].get('directory') != OUTPUT):
        raise ValueError('Сборка предназначена только для существующего gentle-fog-7c3b и .cache/worker-site.')
    # Missing guides or symlinked inputs must not silently publish less, or
    # copy something outside the intended public source list into the assets.
    for relative in ('Domashka_PRO.html', *PUBLIC_DOCS):
        source = root / relative
        if not source.is_file():
            raise ValueError(f'Не найден HTML или инструкция для публикации: {relative}')
        if source.resolve() != source:
            raise ValueError('Публичные исходники не должны быть символическими ссылками.')
    cache = root / '.cache'
    output = root / OUTPUT
    manifest_path = root / MANIFEST
    if cache.is_symlink() or output.is_symlink() or manifest_path.is_symlink():
        raise ValueError('Папка сборки и манифест не должны быть символическими ссылками.')
    if output.exists() and not output.is_dir():
        raise ValueError('.cache/worker-site должна быть отдельной папкой.')
    cache.mkdir(exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='worker-staging-', dir=cache))
    try:
        prepare_cloud(staging, root / 'Domashka_PRO.html', environment)
        names = ['index.html', '_headers', 'Domashka_PRO.html', *PUBLIC_DOCS]
        files = {name: hashlib.sha256((staging / name).read_bytes()).hexdigest() for name in sorted(names)}
        # Clean only this fixed, validated generated directory; never the repo,
        # static/, a caller-supplied destination, or a symlink target.
        if output.exists():
            shutil.rmtree(output)
        staging.rename(output)
        manifest = {'version': 1, 'worker': WORKER_NAME, 'output': OUTPUT, 'files': files}
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return output


if __name__ == '__main__':
    try:
        site = prepare_worker()
        print(f'Готова облачная сборка существующего Worker: {site}')
        print('Это только сборка. Supabase, SQL, Auth и секреты не менялись; публикация не выполнялась.')
    except (ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
