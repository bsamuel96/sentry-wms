import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.local_catalog import update_pricing, validate_catalog, positive_price


class LocalCatalogTests(unittest.TestCase):
    def test_initial_price_refresh_override_and_explicit_reset(self):
        first = update_pricing({}, 'refresh', quote={'id': '1', 'price': 139.15, 'currency': 'RON'}, reference='ABC')
        self.assertEqual(first['price'], 139.15)
        manual = update_pricing(first, 'manual', price='150,50')
        refreshed = update_pricing(manual, 'refresh', quote={'id': '1', 'price': 160, 'currency': 'RON'}, reference='ABC')
        self.assertEqual(refreshed['price'], 150.50)
        self.assertEqual(refreshed['connex']['price'], 160)
        self.assertEqual(refreshed['source'], 'manual')
        self.assertEqual(update_pricing(refreshed, 'use_connex')['price'], 160)
        self.assertEqual(first['price'], 139.15)

    def test_manual_only_product_needs_no_connex_match(self):
        self.assertEqual(update_pricing({}, 'manual', price=25)['price'], 25)
        with self.assertRaises(ValueError):
            update_pricing({}, 'use_connex')

    def test_prices_and_currency_are_validated(self):
        for value in [None, 'NaN', 'Infinity', '-2', '0', '0.001', '100000001', 'abc']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                positive_price(value)
        with self.assertRaises(ValueError):
            update_pricing({}, 'refresh', quote={'price': 10, 'currency': 'EUR'})

    def test_manual_identity_is_not_a_fabricated_tecdoc_match(self):
        result = validate_catalog({'name': 'Filtru', 'brand': 'Marca', 'code': 'ABC',
                                   'id': 'fake-tecdoc-id', 'matchType': 'ean',
                                   'eans': ['123', '123'], 'images': ['https://example.test/a.jpg'],
                                   'references': [{'code': 'OE123', 'type': 'OE', 'manufacturer': 'VW'}]})
        self.assertEqual(result['matchType'], 'manual')
        self.assertNotIn('id', result)
        self.assertEqual(result['eans'], ['123'])
        self.assertEqual(result['references'][0]['code'], 'OE123')

    def test_manual_identity_validates_required_fields_and_image_urls(self):
        for patch in [{'name': ''}, {'images': ['javascript:alert(1)']}, {'references': [{'code': ''}]}, {'category': 'x' * 101}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_catalog({'name': 'Filtru', 'brand': 'Marca', 'code': 'ABC', **patch})


if __name__ == '__main__':
    unittest.main()
