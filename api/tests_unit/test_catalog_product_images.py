import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.catalog_media import catalog_image_mime


class CatalogProductImageTests(unittest.TestCase):
    def test_detects_only_browser_native_image_signatures(self):
        self.assertEqual(catalog_image_mime(b"\xff\xd8\xff\xe0jpeg"), "image/jpeg")
        self.assertEqual(catalog_image_mime(b"\x89PNG\r\n\x1a\nrest"), "image/png")
        self.assertEqual(catalog_image_mime(b"RIFF1234WEBPrest"), "image/webp")
        self.assertIsNone(catalog_image_mime(b"<svg onload=alert(1)></svg>"))


if __name__ == '__main__':
    unittest.main()
