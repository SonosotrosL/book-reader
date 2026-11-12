"""Builds portable_book_reader.html and index.html from modular files in src/."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"

PARTS = [
    "00_head.html",
    "01_styles.css",
    "02_body.html",
    "03_core_parsers.js",
    "04_reader_ui.js",
    "05_cloud_sync.js",
    "06_catalogs_init.js",
    "99_tail.html",
]


def build() -> int:
    chunks = []
    for name in PARTS:
        part_path = SRC / name
        if not part_path.exists():
            raise FileNotFoundError(f"Missing module: {part_path}")
        chunks.append(part_path.read_bytes())

    bundle = b"".join(chunks)
    (ROOT / "portable_book_reader.html").write_bytes(bundle)
    (ROOT / "index.html").write_bytes(bundle)
    return len(bundle)


if __name__ == "__main__":
    total = build()
    print(f"Built portable_book_reader.html and index.html ({total:,} bytes)")
