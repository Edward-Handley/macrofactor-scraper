from macrofactor_scraper.firestore import decode_document, decode_firestore_value


def test_decode_firestore_value_handles_common_types() -> None:
    value = {
        "mapValue": {
            "fields": {
                "name": {"stringValue": "entry"},
                "grams": {"integerValue": "150"},
                "energy": {"doubleValue": 244.5},
                "active": {"booleanValue": True},
                "missing": {"nullValue": None},
                "tags": {"arrayValue": {"values": [{"stringValue": "a"}, {"stringValue": "b"}]}},
                "nested": {"mapValue": {"fields": {"x": {"integerValue": "1"}}}},
            }
        }
    }

    assert decode_firestore_value(value) == {
        "name": "entry",
        "grams": 150,
        "energy": 244.5,
        "active": True,
        "missing": None,
        "tags": ["a", "b"],
        "nested": {"x": 1},
    }


def test_decode_document_adds_metadata() -> None:
    document = {
        "name": "projects/sbs-diet-app/databases/(default)/documents/users/abc/weightLog/2026-05-01",
        "createTime": "2026-05-01T00:00:00Z",
        "updateTime": "2026-05-01T00:01:00Z",
        "fields": {"weight": {"doubleValue": 80.5}},
    }

    decoded = decode_document(document)

    assert decoded["weight"] == 80.5
    assert decoded["_id"] == "2026-05-01"
    assert decoded["_path"] == "users/abc/weightLog/2026-05-01"
    assert decoded["_create_time"] == "2026-05-01T00:00:00Z"
