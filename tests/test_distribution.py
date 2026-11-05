import json
from html.parser import HTMLParser
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import build_standalone
from scripts.prepare_pages import prepare_pages

ROOT = Path(__file__).resolve().parent.parent


class ShellParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.external_resources = []
        self.styles = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.external_resources.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') in ('stylesheet', 'modulepreload'):
            self.external_resources.append(attrs.get('href'))
        if tag == 'style':
            self.in_style = True

    def handle_endtag(self, tag):
        if tag == 'style':
            self.in_style = False

    def handle_data(self, data):
        if self.in_style:
            self.styles.append(data)


class DistributionTests(unittest.TestCase):
    def test_committed_html_contains_current_version_and_inline_shell(self):
        html = (ROOT / 'Domashka_PRO.html').read_text(encoding='utf-8')
        version = re.search(r"APP_VERSION = '([^']+)'", (ROOT / 'src/version.js').read_text()).group(1)
        package = json.loads((ROOT / 'package.json').read_text())
        self.assertEqual(package['version'], f'{version}.0')
        self.assertIn(f'<title>Домашка.ПРО v{version}', html)
        self.assertIn('window.__STANDALONE_BUILD__ = true;', html)
        self.assertNotIn('/Domashka_PRO.html', (ROOT / '.gitignore').read_text().splitlines())
        shell = ShellParser()
        shell.feed(html)
        self.assertEqual(shell.external_resources, [])
        css = ''.join(shell.styles)
        self.assertIn('data:font/woff2;base64,', css)
        for url in re.findall(r'url\(([^)]+)\)', css):
            self.assertTrue(url.strip(' \"\'').startswith(('data:', '#')), url[:100])

    def test_pages_folder_contains_only_standalone_runtime_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'Domashka.PRO'
            prepare_pages(output)
            self.assertEqual({p.name for p in output.iterdir()}, {'index.html', 'Domashka_PRO.html', '.nojekyll'})
            html = (ROOT / 'Domashka_PRO.html').read_bytes()
            self.assertEqual((output / 'index.html').read_bytes(), html)
            self.assertEqual((output / 'Domashka_PRO.html').read_bytes(), html)

    def test_pages_rejects_source_index_and_writing_into_source_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'index.html'
            source.write_text('<script type="module" src="/src/main.jsx"></script>')
            with self.assertRaisesRegex(ValueError, 'собранный'):
                prepare_pages(Path(tmp) / 'site', source)
            with self.assertRaisesRegex(ValueError, 'отдельную папку'):
                prepare_pages(Path(tmp), source)
            self.assertIn('/src/main.jsx', source.read_text())
            self.assertFalse((Path(tmp) / 'site').exists())

    def test_missing_build_does_not_overwrite_a_published_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'site'
            output.mkdir()
            (output / 'index.html').write_text('keep the existing page')
            with self.assertRaises(FileNotFoundError):
                prepare_pages(output, Path(tmp) / 'missing.html')
            self.assertEqual((output / 'index.html').read_text(), 'keep the existing page')

    def test_packager_requires_and_includes_full_user_guide(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / 'static/assets'
            assets.mkdir(parents=True)
            (assets / 'index-test.css').write_text('body{margin:0}')
            (assets / 'index-test.js').write_text('console.log("ready")')
            (root / 'src').mkdir()
            (root / 'src/version.js').write_text("export const APP_VERSION = '3.4';")
            with patch.object(build_standalone, 'ROOT', str(root)), patch.object(build_standalone, 'ASSETS_DIR', str(assets)):
                with self.assertRaisesRegex(RuntimeError, 'USER_GUIDE.md'):
                    build_standalone.build()
                self.assertFalse((root / 'Domashka_PRO.html').exists())
                guide = '# Инструкция\nПК, Android и iPhone.\n'
                (root / 'USER_GUIDE.md').write_text(guide, encoding='utf-8')
                build_standalone.build()
            self.assertEqual((root / 'USER_GUIDE.txt').read_text(encoding='utf-8'), guide)
            html = (root / 'Domashka_PRO.html').read_bytes()
            self.assertEqual((root / 'static/Domashka_PRO.html').read_bytes(), html)
            with zipfile.ZipFile(root / 'Domashka_PRO_Portable.zip') as archive:
                self.assertEqual(archive.read('Domashka_PRO/Domashka_PRO.html'), html)
                self.assertEqual(archive.read('Domashka_PRO/ПОЛНАЯ_ИНСТРУКЦИЯ.txt').decode('utf-8'), guide)
                self.assertIn('HTTPS', archive.read('Domashka_PRO/КАК_ЗАПУСТИТЬ.txt').decode('utf-8'))

    def test_current_portable_archive_matches_committed_html_and_guide(self):
        self.assertEqual((ROOT / 'USER_GUIDE.txt').read_bytes(), (ROOT / 'USER_GUIDE.md').read_bytes())
        archive_path = ROOT / 'Domashka_PRO_Portable.zip'
        if not archive_path.exists():
            self.skipTest('Run npm run build:standalone to check the portable ZIP.')
        with zipfile.ZipFile(archive_path) as archive:
            self.assertEqual(archive.read('Domashka_PRO/Domashka_PRO.html'), (ROOT / 'Domashka_PRO.html').read_bytes())
            self.assertEqual(archive.read('Domashka_PRO/ПОЛНАЯ_ИНСТРУКЦИЯ.txt'), (ROOT / 'USER_GUIDE.md').read_bytes())
            self.assertEqual(len(archive.namelist()), 5)


if __name__ == '__main__':
    unittest.main()
