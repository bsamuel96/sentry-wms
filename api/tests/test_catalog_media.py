from services.catalog_media import catalog_image_urls


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
