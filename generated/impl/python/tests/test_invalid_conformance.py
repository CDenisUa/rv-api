"""Negative conformance suite: every document under conformance/invalid/ MUST be rejected.

This is the cross-language *negative* contract that complements the happy-path golden suite. Error
messages differ by language, so the assertion is "rejected", not "rejected with message X".
"""

# Core
import json
import pytest
# Under test
import rvx
from rvx.errors import ValidationError
# Fixtures
from conftest import CONFORMANCE


def _invalid_cases():
    manifest = json.load(open(CONFORMANCE / "invalid" / "manifest.json"))
    out = []
    for entry in manifest["cases"]:
        doc = json.load(open(CONFORMANCE / "invalid" / entry["doc"]))
        out.append(pytest.param(doc, id=entry["name"]))
    return out


@pytest.mark.parametrize("doc", _invalid_cases())
def test_invalid_document_is_rejected(doc):
    with pytest.raises(ValidationError):
        rvx.parse_document(doc)
