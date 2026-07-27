from typing import Callable

_REGISTRY: dict[str, Callable] = {}


def rule(rule_id: str) -> Callable[[Callable], Callable]:
    def deco(fn: Callable) -> Callable:
        if rule_id in _REGISTRY and _REGISTRY[rule_id] is not fn:
            raise RuntimeError(f"Duplicate rule registration: {rule_id}")
        _REGISTRY[rule_id] = fn
        return fn
    return deco


def get(rule_id: str) -> Callable | None:
    return _REGISTRY.get(rule_id)


def all_registered() -> dict[str, Callable]:
    return dict(_REGISTRY)
