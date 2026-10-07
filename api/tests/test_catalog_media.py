from services.catalog_media import catalog_image_urls, catalog_is_oil_product, catalog_oil_viscosity


def test_catalog_image_urls_deduplicates_and_rejects_unsafe_urls():
    assert catalog_image_urls({
        "imageUrl": "https://cdn.example.test/part.jpg",
        "images": [
            "https://cdn.example.test/part.jpg",
            {"url": "https://cdn.example.test/part-side.jpg"},
            "javascript:alert(1)",
            "/relative/image.jpg",
        ],
    }) == [
        "https://cdn.example.test/part.jpg",
        "https://cdn.example.test/part-side.jpg",
    ]


def test_catalog_image_urls_accepts_jsonb_serialized_as_text():
    assert catalog_image_urls('{"images":[{"imageUrl":"http://images.example.test/a.png"}]}') == [
        "http://images.example.test/a.png",
    ]


def test_catalog_oil_viscosity_reads_direct_criteria_and_product_names():
    assert catalog_oil_viscosity({
        'criteria': [{'criteriaDescription': 'Vâscozitate', 'formattedValue': '5W30'}]
    }) == '5W-30'
    assert catalog_oil_viscosity({}, 'MOTUL 8100 X-CLEAN 5W-40 5L') == '5W-40'


def test_catalog_oil_viscosity_does_not_invent_a_value_for_non_oil_products():
    assert catalog_oil_viscosity({'name': 'Filtru de ulei MANN W 79'}) is None


def test_catalog_is_oil_product_excludes_parts_that_only_reference_oil():
    assert catalog_is_oil_product({'category': 'Uleiuri', 'name': 'MOTUL SPECIFIC'}) is True
    assert catalog_is_oil_product({'name': 'Filtru de ulei MANN W 79'}) is False
