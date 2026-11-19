import base64
import json
from pathlib import Path
import tempfile
import re
import zipfile
import unittest
from scripts.prepare_cloud import prepare_cloud, public_config, PUBLIC_DOCS, HEADERS, ROOT

ENV = {'DOMASHKA_SUPABASE_URL': 'https://exampleproject.supabase.co',
       'DOMASHKA_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_0123456789abcdef012345',
       'DOMASHKA_SITE_URL': 'https://example-school.pages.dev/'}


class CloudDistributionTests(unittest.TestCase):
    def test_public_keys_only_and_no_github_pages_password_transactions(self):
        self.assertEqual(public_config(ENV)['url'], ENV['DOMASHKA_SUPABASE_URL'])
        admin = 'header.' + base64.urlsafe_b64encode(json.dumps({'role': 'service_role'}).encode()).decode().rstrip('=') + '.signature'
        for key in ('sb_secret_do_not_publish', admin, ''):
            with self.assertRaises(ValueError):
                public_config({**ENV, 'DOMASHKA_SUPABASE_PUBLISHABLE_KEY': key})
        for site in ('https://example.github.io/', 'http://example.pages.dev/', 'https://user:password@example.pages.dev/'):
            with self.assertRaises(ValueError):
                public_config({**ENV, 'DOMASHKA_SITE_URL': site})

    def test_standalone_download_and_source_stay_unconfigured(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'Domashka_PRO.html'
            original = '<html><head><script>window.__STANDALONE_BUILD__ = true;</script></head></html>'
            source.write_text(original)
            site_key = 'public-turnstile-fixture-123'
            site = prepare_cloud(Path(tmp) / 'cloud', source, {**ENV,
                'DOMASHKA_TURNSTILE_SITE_KEY': site_key,
                'DOMASHKA_TURNSTILE_SECRET_KEY': 'private-captcha-fixture-must-not-be-published'})
            html = (site / 'index.html').read_text()
            self.assertIn('window.__DOMASHKA_CLOUD__ =', html)
            self.assertIn('"captchaSiteKey":"' + site_key + '"', html)
            self.assertNotIn('private-captcha-fixture-must-not-be-published', html)
            self.assertNotIn(site_key, (site / 'Domashka_PRO.html').read_text())
            self.assertEqual((site / 'Domashka_PRO.html').read_text(), original)
            self.assertEqual(source.read_text(), original)
            self.assertTrue((site / 'docs/CLOUD_SETUP.md').is_file())
            self.assertTrue((site / 'REFERENCE_COVERAGE.md').is_file())
            self.assertIn('Referrer-Policy: no-referrer', (site / '_headers').read_text())
            self.assertIn("object-src 'none'", (site / '_headers').read_text())
            # Both PDF.js and Tesseract use Fastly for their script/worker assets.
            self.assertEqual((site / '_headers').read_text().count('https://fastly.jsdelivr.net'), 2)

    def test_invalid_configuration_cannot_overwrite_a_site(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp) / 'site'
            site.mkdir()
            (site / 'index.html').write_text('keep me')
            with self.assertRaises(ValueError):
                prepare_cloud(site, Path(tmp) / 'missing', {})
            self.assertEqual((site / 'index.html').read_text(), 'keep me')

    def test_cannot_write_cloud_config_to_the_source_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'Domashka_PRO.html'
            source.write_text('<script>window.__STANDALONE_BUILD__ = true;</script>')
            with self.assertRaises(ValueError):
                prepare_cloud(Path(tmp), source, ENV)

    def test_config_is_script_safe_and_never_includes_server_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'Domashka_PRO.html'
            source.write_text('<script>window.__STANDALONE_BUILD__ = true;</script>')
            site = prepare_cloud(Path(tmp) / 'site', source, {**ENV,
                'DOMASHKA_SITE_URL': 'https://example-school.pages.dev/</script><img>',
                'SUPABASE_SERVICE_ROLE_KEY': 'must-not-appear-in-HTML', 'SMTP_PASSWORD': 'never-export-this'})
            html = (site / 'index.html').read_text()
            self.assertNotIn('must-not-appear-in-HTML', html)
            self.assertNotIn('never-export-this', html)
            self.assertNotIn('</script><img>', html)
            self.assertIn('\\u003c', html)

    def test_committed_cloud_package_is_current_public_only_and_reproducible(self):
        with zipfile.ZipFile(ROOT / 'Domashka_PRO_Cloudflare.zip') as archive:
            self.assertEqual(set(archive.namelist()), {'index.html', '_headers', 'Domashka_PRO.html', *PUBLIC_DOCS})
            self.assertEqual(archive.read('Domashka_PRO.html'), (ROOT / 'Domashka_PRO.html').read_bytes())
            self.assertEqual(archive.read('_headers').decode('utf-8'), HEADERS)
            for relative in PUBLIC_DOCS:
                self.assertEqual(archive.read(relative), (ROOT / relative).read_bytes())
            for entry in archive.infolist():
                self.assertEqual(entry.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(entry.create_system, 3)
                self.assertEqual(entry.external_attr >> 16, 0o644)
            html = archive.read('index.html').decode('utf-8')
            config = json.loads(re.search(r'window.__DOMASHKA_CLOUD__ = (.*?);</script>', html).group(1))
            self.assertEqual(config, public_config({
                'DOMASHKA_SUPABASE_URL': config['url'],
                'DOMASHKA_SUPABASE_PUBLISHABLE_KEY': config['publishableKey'],
                'DOMASHKA_SITE_URL': config['siteUrl'],
                'DOMASHKA_TURNSTILE_SITE_KEY': config['captchaSiteKey'],
            }))
            self.assertEqual(config['siteUrl'], 'auto')
            stripped = re.sub(r'\n  <script>window.__DOMASHKA_CLOUD__ = .*?;</script>', '', html, count=1)
            self.assertEqual(stripped, (ROOT / 'Domashka_PRO.html').read_text(encoding='utf-8'))
