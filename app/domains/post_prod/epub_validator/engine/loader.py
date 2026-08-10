import json
import os
from pathlib import Path

_RULES_ROOT = Path(__file__).resolve().parent.parent / "rules"


def _read_rules_file(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    rules = data.get("rules", [])
    for r in rules:
        r.setdefault("_source_file", path.name)
    return rules


def load_general() -> list[dict]:
    """Load every rule under rules/general/*.json.

    Files are read in sorted filename order; rules keep their in-file order.
    """
    general_dir = _RULES_ROOT / "general"
    if not general_dir.is_dir():
        return []
    rules: list[dict] = []
    for path in sorted(general_dir.glob("*.json")):
        rules.extend(_read_rules_file(path))
    return rules


def load_customer(customer: str | None) -> list[dict]:
    """Load customer-specific rules from rules/customers/<client_code>/customer.json (or rules.json)."""
    if not customer:
        return []
    c_clean = customer.strip()
    customers_dir = _RULES_ROOT / "customers"
    if not customers_dir.is_dir():
        return []

    # Case-insensitive match on customer / client_code directory
    target_dir: Path | None = None
    for p in customers_dir.iterdir():
        if p.is_dir() and p.name.lower() == c_clean.lower():
            target_dir = p
            break

    if target_dir is None:
        return []

    for fn in ("customer.json", "rules.json"):
        rf = target_dir / fn
        if rf.is_file():
            return _read_rules_file(rf)
    return []



def load_overrides(customer: str | None) -> dict:
    """Reserved for Phase 2."""
    if not customer:
        return {}
    overrides_file = _RULES_ROOT / "customers" / customer / "overrides.json"
    if not overrides_file.is_file():
        return {}
    with overrides_file.open("r", encoding="utf-8") as f:
        return json.load(f)
