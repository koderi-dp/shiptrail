"""Provider adapters; unavailable providers never fall back implicitly."""

from typing import Any

from shiptrail.engine.adapters.base import Adapter, UnsupportedProviderError


def get_adapter(provider: str, **kwargs: Any) -> Adapter:
    if provider == "codex":
        from shiptrail.engine.adapters.codex import CodexAdapter
        return CodexAdapter(**kwargs)
    if provider == "opencode":
        from shiptrail.engine.adapters.opencode import OpencodeAdapter
        return OpencodeAdapter(**kwargs)
    raise UnsupportedProviderError(f"Unsupported provider: {provider}; no adapter is installed")
