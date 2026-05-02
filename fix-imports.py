from pathlib import Path

ROOT = Path(r"C:\development\CsPortfolioTracking")
SEARCH_DIRS = [ROOT / "src", ROOT / "apps" / "web" / "src", ROOT / "packages" / "shared" / "src"]
EXTS = {".js", ".jsx"}

replacements = [
    ('from "@/', 'from "@shared/'),
    ("from '@/", "from '@shared/"),
    ("@shared/ModalContext", "@shared/contexts/ModalContext"),
    ("@shared/ThemeContext", "@shared/contexts/ThemeContext"),
    ("@shared/CurrencyContext", "@shared/contexts/CurrencyContext"),
]

fixed = 0
for base in SEARCH_DIRS:
    if not base.exists():
        continue
    for file in base.rglob('*'):
        if file.suffix not in EXTS:
            continue
        original = file.read_text(encoding='utf-8')
        updated = original
        for old, new in replacements:
            updated = updated.replace(old, new)
        if updated != original:
            file.write_text(updated, encoding='utf-8')
            print(f'Fixed {file}')
            fixed += 1

print(f'Done. Fixed {fixed} files.')

