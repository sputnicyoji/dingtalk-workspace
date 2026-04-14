from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256


def make_event_id(kind: str, source_id: str, facet: str) -> str:
    return sha256(f"{kind}|{source_id}|{facet}".encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class Event:
    kind: str
    source_id: str
    severity: str
    title: str
    detail: str
    extra: dict = field(default_factory=dict)

    @property
    def event_id(self) -> str:
        return make_event_id(self.kind, self.source_id, self.detail)

    def to_markdown_row(self) -> str:
        return f"- [{self.severity}] {self.kind}:{self.source_id} — {self.title} — {self.detail}"
