# Core
import json
import sys
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SRC = Path(__file__).resolve().parents[1] / "src"
CONFORMANCE = REPO_ROOT / "conformance"

sys.path.insert(0, str(SRC))


def _load(path):
    with open(path) as f:
        return json.load(f)


@pytest.fixture(scope="session")
def schema():
    return _load(REPO_ROOT / "spec" / "rv.schema.json")


@pytest.fixture(scope="session")
def manifest():
    return _load(CONFORMANCE / "manifest.json")


def conformance_cases():
    manifest = _load(CONFORMANCE / "manifest.json")
    out = []
    for entry in manifest["cases"]:
        case = _load(CONFORMANCE / entry["case"])
        golden = _load(CONFORMANCE / entry["golden"])
        out.append(pytest.param(case, golden, id=entry["name"]))
    return out
