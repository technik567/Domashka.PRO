import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from scripts.prepare_cloud import PUBLIC_DOCS, HEADERS, ROOT
from scripts.prepare_worker import prepare_worker, load_public_environment, OUTPUT, MANIFEST, WORKER_NAME

PUBLIC = {
    'url': 'https://fixtureproject.supabase.co',
    'publishableKey': 'sb_publishable_fixture1234567890',
    'siteUrl': 'auto',
    'captchaSiteKey': 'public-turnstile-fixture-123',
}
HTML = '<html><script>window.__STANDALONE_BUILD__ = true;</script></html>'


class WorkerBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.write_public(PUBLIC)
        (self.root / 'wrangler.json').write_text(json.dumps({'name': WORKER_NAME, 'assets': {'directory': OUTPUT}}))
        (self.root / 'Domashka_PRO.html').write_text(HTML)
        for guide in PUBLIC_DOCS:
            path = self.root / guide
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('# Public guide\n')
        self.docs = patch('scripts.prepare_cloud.ROOT', self.root)
        self.docs.start()

    def tearDown(self):
        self.docs.stop()
        self.temp.cleanup()

    def write_public(self, value):
        (self.root / 'cloudflare.public.json').write_text(json.dumps(value))

    def test_builds_the_cloud_entry_and_keeps_downloadable_html_local(self):
        output = prepare_worker(self.root)
        self.assertEqual(output, self.root / OUTPUT)
        index = (output / 'index.html').read_text()
        self.assertIn('window.__DOMASHKA_CLOUD__ =', index)
        self.assertIn(PUBLIC['captchaSiteKey'], index)
        self.assertEqual((output / 'Domashka_PRO.html').read_text(), HTML)
        self.assertEqual((self.root / 'Domashka_PRO.html').read_text(), HTML)
        self.assertEqual((output / '_headers').read_text(), HEADERS)
        manifest = json.loads((self.root / MANIFEST).read_text())
        self.assertEqual(manifest['worker'], WORKER_NAME)
        self.assertEqual(set(manifest['files']), {'index.html', '_headers', 'Domashka_PRO.html', *PUBLIC_DOCS})
        for name, digest in manifest['files'].items():
            self.assertEqual(digest, hashlib.sha256((output / name).read_bytes()).hexdigest())

    def test_ignores_build_secrets_and_does_not_copy_repository_sources(self):
        (self.root / '.env').write_text('PRIVATE_ENV_SENTINEL')
        with patch.dict(os.environ, {'SUPABASE_SERVICE_ROLE_KEY': 'PRIVATE_SERVER_SENTINEL',
                                     'CLOUDFLARE_API_TOKEN': 'PRIVATE_DEPLOY_SENTINEL',
                                     'DOMASHKA_TURNSTILE_SECRET_KEY': 'PRIVATE_CAPTCHA_SENTINEL',
                                     'DOMASHKA_SUPABASE_PUBLISHABLE_KEY': 'sb_secret_wrong_build_variable'}):
            output = prepare_worker(self.root)
        self.assertNotIn('.env', [p.name for p in output.iterdir()])
        published = '\n'.join(p.read_text() for p in output.rglob('*') if p.is_file())
        self.assertNotIn('PRIVATE_', published)
        self.assertNotIn('sb_secret_wrong', published)
        self.assertIn(PUBLIC['publishableKey'], published)

    def test_rebuild_is_deterministic_and_discards_stale_generated_assets_only(self):
        output = prepare_worker(self.root)
        previous = (self.root / MANIFEST).read_bytes()
        (output / 'private-extra.txt').write_text('never upload me')
        sibling = self.root / '.cache/keep.txt'
        sibling.write_text('keep this sibling')
        prepare_worker(self.root)
        self.assertFalse((output / 'private-extra.txt').exists())
        self.assertEqual((self.root / MANIFEST).read_bytes(), previous)
        self.assertEqual(sibling.read_text(), 'keep this sibling')
        self.assertEqual((self.root / 'Domashka_PRO.html').read_text(), HTML)

    def test_rejects_private_or_incomplete_config_before_touching_previous_output(self):
        output = prepare_worker(self.root)
        old_index = (output / 'index.html').read_bytes()
        for config in ({**PUBLIC, 'publishableKey': 'sb_secret_never_publish'},
                       {**PUBLIC, 'service_role': 'private'},
                       {**PUBLIC, 'captchaSiteKey': ''},
                       {**PUBLIC, 'siteUrl': 'https://different-site.example'},
                       {**PUBLIC, 'url': None}):
            with self.subTest(config_keys=list(config)):
                self.write_public(config)
                with self.assertRaises(ValueError):
                    prepare_worker(self.root)
                self.assertEqual((output / 'index.html').read_bytes(), old_index)

    def test_plain_vite_entry_and_missing_guide_cannot_replace_previous_site(self):
        output = prepare_worker(self.root)
        old_index = (output / 'index.html').read_bytes()
        (self.root / 'Domashka_PRO.html').write_text('<script src="/src/main.jsx"></script>')
        with self.assertRaisesRegex(ValueError, 'автономный HTML'):
            prepare_worker(self.root)
        self.assertEqual((output / 'index.html').read_bytes(), old_index)
        self.assertEqual(list((self.root / '.cache').glob('worker-staging-*')), [])
        (self.root / 'USER_GUIDE.md').unlink()
        with self.assertRaisesRegex(ValueError, 'инструкция'):
            prepare_worker(self.root)

    def test_wrong_target_and_symlinks_cannot_redirect_cleanup_or_publication(self):
        for config in ({'name': 'another-worker', 'assets': {'directory': OUTPUT}},
                       {'name': WORKER_NAME, 'assets': {'directory': '.'}}):
            (self.root / 'wrangler.json').write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError, 'существующего'):
                prepare_worker(self.root)
        (self.root / 'wrangler.json').write_text(json.dumps({'name': WORKER_NAME, 'assets': {'directory': OUTPUT}}))
        (self.root / '.cache').mkdir()
        (self.root / OUTPUT).symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'ссылками'):
            prepare_worker(self.root)
        self.assertTrue((self.root / 'Domashka_PRO.html').is_file())

    def test_symlinked_public_guide_cannot_copy_a_private_file(self):
        output = prepare_worker(self.root)
        previous = (output / 'index.html').read_bytes()
        private = self.root / '.env'
        private.write_text('PRIVATE_SOURCE_SENTINEL')
        guide = self.root / 'USER_GUIDE.md'
        guide.unlink()
        guide.symlink_to(private)
        with self.assertRaisesRegex(ValueError, 'ссылками'):
            prepare_worker(self.root)
        self.assertEqual((output / 'index.html').read_bytes(), previous)
        self.assertEqual((output / 'USER_GUIDE.md').read_text(), '# Public guide\n')

    def test_public_environment_only_contains_the_allowlisted_fields(self):
        env = load_public_environment(self.root)
        self.assertEqual(set(env), {'DOMASHKA_SUPABASE_URL', 'DOMASHKA_SUPABASE_PUBLISHABLE_KEY', 'DOMASHKA_SITE_URL', 'DOMASHKA_TURNSTILE_SITE_KEY'})
        self.assertEqual(env['DOMASHKA_SUPABASE_URL'], PUBLIC['url'])


class WorkerRepositoryTests(unittest.TestCase):
    def test_real_worker_assets_match_the_committed_public_cloud_package(self):
        output = prepare_worker(ROOT)
        manifest_before = (ROOT / MANIFEST).read_bytes()
        with zipfile.ZipFile(ROOT / 'Domashka_PRO_Cloudflare.zip') as archive:
            expected = {'index.html', '_headers', 'Domashka_PRO.html', *PUBLIC_DOCS}
            self.assertEqual(set(archive.namelist()), expected)
            self.assertEqual({p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}, expected)
            for name in expected:
                self.assertEqual((output / name).read_bytes(), archive.read(name), name)
        prepare_worker(ROOT)
        self.assertEqual((ROOT / MANIFEST).read_bytes(), manifest_before)

    def test_repository_target_scripts_and_locked_toolchain_agree(self):
        config = json.loads((ROOT / 'wrangler.json').read_text())
        self.assertEqual(config['name'], WORKER_NAME)
        self.assertEqual(config['assets'], {'directory': OUTPUT, 'not_found_handling': 'none'})
        self.assertTrue(config['workers_dev'])
        self.assertTrue(config['keep_vars'])
        self.assertFalse(config['preview_urls'])
        self.assertNotIn('main', config)  # no server code or backend deployment
        self.assertNotIn('routes', config)
        package = json.loads((ROOT / 'package.json').read_text())
        lock = json.loads((ROOT / 'package-lock.json').read_text())
        self.assertEqual(package['devDependencies']['wrangler'], lock['packages']['node_modules/wrangler']['version'])
        self.assertEqual(package['packageManager'], 'npm@10.9.8')
        self.assertEqual(package['engines']['node'], '>=22.12.0')
        self.assertEqual((ROOT / '.node-version').read_text().strip(), '22')
        self.assertEqual((ROOT / '.python-version').read_text().strip(), '3.11')
        self.assertEqual(package['scripts']['build:worker'], 'npm run build:standalone && python3 scripts/prepare_worker.py')
        self.assertEqual(package['scripts']['deploy:worker'], 'node scripts/deploy_worker.mjs')
        self.assertEqual(package['scripts']['check:worker'], 'npm run build:worker && node scripts/deploy_worker.mjs --dry-run')
        ci = (ROOT / '.github/workflows/check.yml').read_text()
        self.assertIn('run: npm run check:worker', ci)
        self.assertNotIn('run: npm run deploy:worker', ci)
