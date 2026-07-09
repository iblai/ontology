"""Semantic search over text memories (Component 2D).

Embeddings over the Markdown text memories enable natural-language search. The
index is ChromaDB; embeddings are BYOK (OpenAI/Google) or a local model
(nomic-embed-text via Ollama) for air-gapped deployments.

The indexer/query require the ``[vector]`` extra (chromadb). The result shape is
stable so the CLI works regardless of backend availability.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class SearchResult:
    path: str
    score: float
    snippet: str


class VectorSearch:
    """Query and (re)build the ChromaDB vector index over text memories."""

    def __init__(
        self, collection: str = "ontology", files_root: str | None = None
    ) -> None:
        self.collection_name = collection
        self.files_root = files_root or os.environ.get(
            "ONTOLOGY_FILES_ROOT", "/ontology"
        )
        self.chroma_url = os.environ.get("CHROMA_URL", "http://vector-store:8000")
        # Static bearer token presented to an auth-enabled ChromaDB server. Left
        # unset for local/air-gapped runs where the vector store has no auth.
        self.chroma_token = os.environ.get("CHROMA_TOKEN") or None

    def _collection(self):
        try:
            import chromadb
        except ImportError as exc:  # pragma: no cover - optional extra
            raise RuntimeError(
                "chromadb is required for semantic search. Install with: "
                "pip install 'iblai-ontology[vector]'"
            ) from exc
        from urllib.parse import urlparse

        parsed = urlparse(self.chroma_url)
        kwargs = {"host": parsed.hostname or "localhost", "port": parsed.port or 8000}
        if self.chroma_token:
            # Token auth: the default transport header (Authorization) and Bearer
            # framing match the server's TokenAuthenticationServerProvider.
            from chromadb.config import Settings

            kwargs["settings"] = Settings(
                chroma_client_auth_provider="chromadb.auth.token_authn.TokenAuthClientProvider",
                chroma_client_auth_credentials=self.chroma_token,
            )
        client = chromadb.HttpClient(**kwargs)
        return client.get_or_create_collection(self.collection_name)

    def index_file(self, path: str, text: str) -> None:
        """Add or update a single text-memory file in the index."""
        self._collection().upsert(
            ids=[path], documents=[text], metadatas=[{"path": path}]
        )

    def query(
        self, term: str, *, domain: Optional[str] = None, limit: int = 10
    ) -> list[SearchResult]:
        """Semantic search; optionally restrict to a domain (students, courses…)."""
        where = {"path": {"$contains": f"/{domain}/"}} if domain else None
        res = self._collection().query(query_texts=[term], n_results=limit, where=where)
        out: list[SearchResult] = []
        docs = (res.get("documents") or [[]])[0]
        ids = (res.get("ids") or [[]])[0]
        dists = (res.get("distances") or [[None] * len(ids)])[0]
        for doc, _id, dist in zip(docs, ids, dists):
            score = 1.0 - dist if isinstance(dist, (int, float)) else 0.0
            snippet = (doc or "").strip().splitlines()[0][:200] if doc else ""
            out.append(SearchResult(path=_id, score=score, snippet=snippet))
        return out
