#!/usr/bin/env python3
"""Prepare static hosting from the committed HTML; no Node/Python backend required."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def prepare_pages(output_dir: Path, source_file: Path = ROOT / "Domashka_PRO.html") -> None:
    output_dir = Path(output_dir).resolve()
    source_file = Path(source_file).resolve()
    if output_dir == source_file.parent:
        raise ValueError("Выберите отдельную папку публикации, не папку с исходниками.")
    # Read first: a missing build must not overwrite any existing destination files.
    html = source_file.read_bytes()
    if b"window.__STANDALONE_BUILD__ = true;" not in html:
        raise ValueError("Нужен собранный Domashka_PRO.html, а не исходный index.html.")
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "index.html").write_bytes(html)
    (output_dir / "Domashka_PRO.html").write_bytes(html)
    (output_dir / ".nojekyll").write_text("", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".cache" / "pages-site")
    args = parser.parse_args()
    prepare_pages(args.output)
    print(f"Статический сайт готов: {args.output}")


if __name__ == "__main__":
    main()
