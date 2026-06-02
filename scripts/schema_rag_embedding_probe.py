#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Probe DBX Schema RAG retrieval with the same OpenAI-compatible embedding request
shape and scoring formula used by the Schema RAG sidecar.

This script intentionally depends only on the Python standard library so it can
run on the Windows host without installing project dependencies.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


DEFAULT_LIMIT = 10
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_MIN_VECTOR_SCORE = 0.05


@dataclass
class ProbeConfig:
    embedding_provider: str
    embedding_endpoint: str
    embedding_model: str
    embedding_api_key: str
    embedding_dimension: int
    proxy_enabled: bool = False
    proxy_url: str = ""


@dataclass
class ProbeCase:
    query: str
    expected_tables: list[str] = field(default_factory=list)


@dataclass
class ProbePaths:
    config_path: Path
    documents_path: Path


def camel_or_snake(data: dict[str, Any], camel: str, snake: str, default: Any = None) -> Any:
    if camel in data:
        return data[camel]
    if snake in data:
        return data[snake]
    return default


def normalize_config(raw: dict[str, Any]) -> ProbeConfig:
    return ProbeConfig(
        embedding_provider=str(camel_or_snake(raw, "embeddingProvider", "embedding_provider", "openai-compatible") or ""),
        embedding_endpoint=str(camel_or_snake(raw, "embeddingEndpoint", "embedding_endpoint", "") or ""),
        embedding_model=str(camel_or_snake(raw, "embeddingModel", "embedding_model", "") or ""),
        embedding_api_key=str(camel_or_snake(raw, "embeddingApiKey", "embedding_api_key", "") or ""),
        embedding_dimension=int(camel_or_snake(raw, "embeddingDimension", "embedding_dimension", 0) or 0),
        proxy_enabled=bool(camel_or_snake(raw, "proxyEnabled", "proxy_enabled", False)),
        proxy_url=str(camel_or_snake(raw, "proxyUrl", "proxy_url", "") or ""),
    )


def apply_config_overrides(config: ProbeConfig, args: argparse.Namespace) -> ProbeConfig:
    return ProbeConfig(
        embedding_provider=args.embedding_provider or config.embedding_provider,
        embedding_endpoint=args.embedding_endpoint or config.embedding_endpoint,
        embedding_model=args.embedding_model or config.embedding_model,
        embedding_api_key=args.embedding_api_key if args.embedding_api_key is not None else config.embedding_api_key,
        embedding_dimension=args.embedding_dimension or config.embedding_dimension,
        proxy_enabled=args.proxy_enabled or config.proxy_enabled,
        proxy_url=args.proxy_url or config.proxy_url,
    )


def validate_config(config: ProbeConfig) -> None:
    if config.embedding_provider.lower() != "openai-compatible":
        raise SystemExit(f"Only openai-compatible embedding provider is supported, got: {config.embedding_provider}")
    if not config.embedding_endpoint.strip():
        raise SystemExit("Missing embedding endpoint. Pass --config or --embedding-endpoint.")
    if not config.embedding_model.strip():
        raise SystemExit("Missing embedding model. Pass --config or --embedding-model.")
    if config.embedding_dimension <= 0:
        raise SystemExit("Missing embedding dimension. Pass --config or --embedding-dimension.")


def sanitize_path_segment(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return "_"
    sanitized = "".join(ch if (ch.isascii() and (ch.isalnum() or ch in "-_.")) else "_" for ch in trimmed)
    return sanitized or "_"


def resolve_probe_paths(args: argparse.Namespace) -> ProbePaths:
    config_path = Path(args.config).expanduser() if args.config else None
    documents_path = Path(args.documents).expanduser() if args.documents else None

    if args.data_dir:
        data_dir = Path(args.data_dir).expanduser()
        config_path = config_path or data_dir / "schema-rag" / "config.json"
        if not documents_path:
            missing = [
                name
                for name, value in {
                    "--connection-id": args.connection_id,
                    "--database": args.database,
                    "--schema": args.schema,
                }.items()
                if not value
            ]
            if missing:
                raise SystemExit(f"--data-dir mode also requires {', '.join(missing)}")
            documents_path = (
                data_dir
                / "schema-rag"
                / "indexes"
                / sanitize_path_segment(args.connection_id)
                / sanitize_path_segment(args.database)
                / sanitize_path_segment(args.schema)
                / "documents.json"
            )

    if not config_path:
        raise SystemExit("Pass --config, or pass --data-dir so the script can use schema-rag/config.json.")
    if not documents_path:
        raise SystemExit("Pass --documents, or pass --data-dir with --connection-id --database --schema.")
    return ProbePaths(config_path=config_path, documents_path=documents_path)


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise SystemExit(f"File not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from None


def normalize_kind(value: Any) -> str:
    text = str(value or "").strip()
    if text.lower() in {"table", "schemaTable"}:
        return "table"
    if text.lower() in {"column", "schemaColumn"}:
        return "column"
    return text[:1].lower() + text[1:]


def document_text(doc: dict[str, Any]) -> str:
    return str(camel_or_snake(doc, "textForEmbedding", "text_for_embedding", "") or "")


def document_schema(doc: dict[str, Any]) -> str:
    return str(doc.get("schema") or "")


def document_table(doc: dict[str, Any]) -> str:
    return str(doc.get("table") or "")


def document_column(doc: dict[str, Any]) -> str:
    column = doc.get("column")
    return "" if column is None else str(column)


def document_data_type(doc: dict[str, Any]) -> str:
    return str(camel_or_snake(doc, "dataType", "data_type", "") or "")


def document_embedding(doc: dict[str, Any]) -> list[float]:
    raw = doc.get("embedding") or []
    if not isinstance(raw, list):
        return []
    return [float(value) for value in raw]


def table_key(schema: str, table: str) -> tuple[str, str]:
    return (schema, table)


def table_name_matches(expected: str, schema: str, table: str) -> bool:
    expected = expected.strip().lower()
    if not expected:
        return False
    actual_table = table.lower()
    actual_full = f"{schema}.{table}".lower() if schema else actual_table
    return expected == actual_table or expected == actual_full


def resolve_endpoint(endpoint: str) -> str:
    endpoint = endpoint.strip().rstrip("/")
    if endpoint.endswith("/embeddings"):
        return endpoint
    return f"{endpoint}/embeddings"


def endpoint_requires_single_input(endpoint: str) -> bool:
    return "ai.gitee.com/" in endpoint


def embedding_request_body(config: ProbeConfig, texts: list[str], single_input_only: bool) -> dict[str, Any]:
    if single_input_only or len(texts) == 1:
        input_value: str | list[str] = texts[0]
    else:
        input_value = texts
    return {
        "model": config.embedding_model,
        "input": input_value,
        "encoding_format": "float",
        "dimensions": config.embedding_dimension,
        "user": "",
    }


def build_opener(config: ProbeConfig) -> urllib.request.OpenerDirector:
    if config.proxy_enabled and config.proxy_url.strip():
        proxy = config.proxy_url.strip()
        return urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    return urllib.request.build_opener()


def request_embeddings(config: ProbeConfig, texts: list[str], timeout: int) -> list[list[float]]:
    endpoint = resolve_endpoint(config.embedding_endpoint)
    body = embedding_request_body(config, texts, endpoint_requires_single_input(endpoint))
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if config.embedding_api_key.strip():
        headers["Authorization"] = f"Bearer {config.embedding_api_key.strip()}"
    request = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")
    opener = build_opener(config)
    started = time.perf_counter()
    try:
        with opener.open(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Embedding HTTP {exc.code}: {body_text}") from None
    except urllib.error.URLError as exc:
        raise SystemExit(f"Embedding request failed: {exc}") from None

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    try:
        payload_json = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Embedding response is not JSON: {exc}") from None

    data = payload_json.get("data")
    if not isinstance(data, list):
        raise SystemExit(f"Embedding response missing data array: {payload_json}")
    vectors: list[list[float]] = []
    for item in data:
        embedding = item.get("embedding") if isinstance(item, dict) else None
        if not isinstance(embedding, list):
            raise SystemExit(f"Embedding response item missing embedding array: {item}")
        vectors.append([float(value) for value in embedding])
    if len(vectors) != len(texts):
        raise SystemExit(f"Embedding service returned {len(vectors)} vectors for {len(texts)} inputs")
    dims = len(vectors[0]) if vectors else 0
    print(f"[embedding] endpoint={endpoint} model={config.embedding_model} inputs={len(texts)} dims={dims} elapsed_ms={elapsed_ms}")
    return vectors


def is_cjk_char(ch: str) -> bool:
    return "\u4e00" <= ch <= "\u9fff"


def is_cjk_token(token: str) -> bool:
    return len(token) == 1 and is_cjk_char(token)


def tokenize(value: str) -> set[str]:
    lower = value.lower()
    tokens = set()
    for token in re.split(r"[^0-9a-zA-Z_\u4e00-\u9fff]+", lower):
        token = token.strip()
        if len(token) >= 2:
            tokens.add(token)
    for ch in lower:
        if is_cjk_char(ch):
            tokens.add(ch)
    return tokens


def lexical_score(query_tokens: set[str], query_text: str, doc: dict[str, Any]) -> float:
    haystack = document_text(doc).lower()
    score = 0.0
    for token in query_tokens:
        if len(token) >= 2 and token in haystack:
            score += len(token)
        elif is_cjk_token(token) and token in haystack:
            score += 0.5
    table = document_table(doc).lower()
    if table and table in query_text:
        score += 12.0
    column = document_column(doc).lower()
    if column and column in query_text:
        score += 14.0
    return score


def normalize_lexical_score(score: float) -> float:
    if score <= 0.0:
        return 0.0
    return min(score / 24.0, 1.0)


def cosine_similarity(left: list[float], right: list[float]) -> float | None:
    if not left or not right or len(left) != len(right):
        return None
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for left_value, right_value in zip(left, right):
        dot += left_value * right_value
        left_norm += left_value * left_value
        right_norm += right_value * right_value
    if left_norm <= sys.float_info.epsilon or right_norm <= sys.float_info.epsilon:
        return None
    return dot / (math.sqrt(left_norm) * math.sqrt(right_norm))


def document_reasons(kind: str, column: str, vector_score: float, lexical_raw: float) -> list[str]:
    reasons = []
    if vector_score >= 0.35:
        reasons.append("向量命中表级文档" if kind == "table" else f"向量命中字段 {column}")
    if lexical_raw > 0.0:
        reasons.append("关键词命中表级元数据" if kind == "table" else f"关键词命中字段 {column}")
    if not reasons:
        reasons.append("低分向量命中表级文档" if kind == "table" else f"低分向量命中字段 {column}")
    return reasons


def summarize_reasons(reasons: list[str]) -> str:
    seen = set()
    out = []
    for reason in reasons:
        if reason in seen:
            continue
        seen.add(reason)
        out.append(reason)
        if len(out) >= 3:
            break
    return "; ".join(out)


def score_document(
    doc: dict[str, Any],
    query_embedding: list[float],
    query_tokens: set[str],
    query_text: str,
    score_mode: str,
) -> dict[str, Any] | None:
    vector_score = cosine_similarity(query_embedding, document_embedding(doc))
    vector_score = max(vector_score or 0.0, 0.0)
    lexical_raw = lexical_score(query_tokens, query_text, doc)
    if vector_score < DEFAULT_MIN_VECTOR_SCORE and lexical_raw <= 0.0:
        return None

    kind = normalize_kind(doc.get("kind"))
    lexical_component = normalize_lexical_score(lexical_raw)
    if score_mode == "vector":
        score = vector_score
    elif score_mode == "lexical":
        score = lexical_component
    else:
        score = vector_score * 0.70 + lexical_component * 0.20
    if kind == "column":
        score += 0.05
    if score <= 0.0:
        return None
    return {
        "score": score,
        "vectorScore": vector_score,
        "lexicalRaw": lexical_raw,
        "lexicalComponent": lexical_component,
        "kind": kind,
        "schema": document_schema(doc),
        "table": document_table(doc),
        "column": document_column(doc),
        "dataType": document_data_type(doc),
        "text": document_text(doc),
        "reasons": document_reasons(kind, document_column(doc), vector_score, lexical_raw),
    }


def key_columns_for_table(table: dict[str, Any]) -> list[dict[str, Any]]:
    columns = camel_or_snake(table, "columns", "columns", []) or []
    out = []
    for column in columns:
        if not isinstance(column, dict):
            continue
        is_pk = bool(camel_or_snake(column, "isPrimaryKey", "is_primary_key", False))
        comment = str(column.get("comment") or "").strip()
        if not is_pk and not comment:
            continue
        out.append(
            {
                "name": column.get("name", ""),
                "dataType": camel_or_snake(column, "dataType", "data_type", ""),
                "score": 0.0,
                "vectorScore": 0.0,
                "lexicalRaw": 0.0,
                "reason": "表级文档命中后展开关键字段",
            }
        )
        if len(out) >= 8:
            break
    return out


def search_documents(
    stored_index: dict[str, Any],
    schema: str,
    query: str,
    query_embedding: list[float],
    limit: int,
    score_mode: str,
) -> dict[str, Any]:
    docs = stored_index.get("documents") or []
    tables = stored_index.get("tables") or []
    manifest = stored_index.get("manifest") or {}
    table_map = {
        table_key(str(table.get("schema") or ""), str(table.get("name") or "")): table
        for table in tables
        if isinstance(table, dict)
    }
    query_tokens = tokenize(query)
    query_text = query.lower()
    by_table: dict[tuple[str, str], dict[str, Any]] = {}

    for doc in docs:
        if not isinstance(doc, dict):
            continue
        if schema and document_schema(doc) != schema:
            continue
        scored = score_document(doc, query_embedding, query_tokens, query_text, score_mode)
        if not scored:
            continue
        key = table_key(scored["schema"], scored["table"])
        entry = by_table.setdefault(key, {"score": 0.0, "reasons": [], "matchedColumns": [], "bestDocs": []})
        entry["score"] = max(entry["score"], scored["score"])
        entry["reasons"].extend(scored["reasons"])
        entry["bestDocs"].append(scored)
        if scored["kind"] == "column" and scored["column"]:
            entry["matchedColumns"].append(
                {
                    "name": scored["column"],
                    "dataType": scored["dataType"],
                    "score": scored["score"],
                    "vectorScore": scored["vectorScore"],
                    "lexicalRaw": scored["lexicalRaw"],
                    "reason": summarize_reasons(scored["reasons"]),
                    "text": scored["text"],
                }
            )

    results = []
    for (table_schema, table_name), entry in by_table.items():
        table = table_map.get((table_schema, table_name), {})
        matched_columns = sorted(entry["matchedColumns"], key=lambda item: item["score"], reverse=True)
        deduped_columns = []
        seen_columns = set()
        for column in matched_columns:
            key = str(column["name"]).lower()
            if key in seen_columns:
                continue
            seen_columns.add(key)
            deduped_columns.append(column)
            if len(deduped_columns) >= 8:
                break
        if not deduped_columns and table:
            deduped_columns = key_columns_for_table(table)
        best_docs = sorted(entry["bestDocs"], key=lambda item: item["score"], reverse=True)[:5]
        results.append(
            {
                "schema": table_schema,
                "name": table_name,
                "tableType": camel_or_snake(table, "tableType", "table_type", ""),
                "score": entry["score"],
                "reason": summarize_reasons(entry["reasons"]),
                "matchedColumns": deduped_columns,
                "bestDocs": best_docs,
            }
        )

    results.sort(key=lambda item: item["score"], reverse=True)
    truncated = len(results) > limit
    return {
        "indexedAt": str(camel_or_snake(manifest, "analyzedAt", "analyzed_at", "")),
        "query": query,
        "schema": schema,
        "tables": results[:limit],
        "truncated": truncated,
        "totalMatched": len(results),
    }


def load_cases(args: argparse.Namespace) -> list[ProbeCase]:
    cases: list[ProbeCase] = []
    for query in args.query or []:
        cases.append(ProbeCase(query=query, expected_tables=list(args.expected_table or [])))
    if args.queries_file:
        path = Path(args.queries_file).expanduser()
        suffix = path.suffix.lower()
        if suffix == ".jsonl":
            with path.open("r", encoding="utf-8") as handle:
                for line_no, line in enumerate(handle, start=1):
                    line = line.strip()
                    if not line:
                        continue
                    data = json.loads(line)
                    cases.append(case_from_json_obj(data, f"{path}:{line_no}"))
        elif suffix == ".json":
            data = load_json(path)
            if not isinstance(data, list):
                raise SystemExit(f"{path} must contain a JSON array")
            for index, item in enumerate(data, start=1):
                cases.append(case_from_json_obj(item, f"{path}[{index}]"))
        else:
            with path.open("r", encoding="utf-8", newline="") as handle:
                sample = handle.read(2048)
                handle.seek(0)
                dialect = csv.Sniffer().sniff(sample, delimiters="\t,") if sample.strip() else csv.excel_tab
                reader = csv.reader(handle, dialect)
                for row in reader:
                    if not row or not row[0].strip() or row[0].strip().startswith("#"):
                        continue
                    expected = split_expected(row[1]) if len(row) > 1 else []
                    cases.append(ProbeCase(query=row[0].strip(), expected_tables=expected))
    if not cases:
        raise SystemExit("Pass --query, or pass --queries-file.")
    return cases


def split_expected(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in re.split(r"[,;|]", str(value)) if item.strip()]


def case_from_json_obj(value: Any, source: str) -> ProbeCase:
    if isinstance(value, str):
        return ProbeCase(query=value)
    if not isinstance(value, dict):
        raise SystemExit(f"Invalid query case at {source}: expected string or object")
    query = str(value.get("query") or "").strip()
    if not query:
        raise SystemExit(f"Invalid query case at {source}: missing query")
    expected = (
        value.get("expectedTables")
        or value.get("expected_tables")
        or value.get("expected")
        or value.get("expectedTable")
        or value.get("expected_table")
    )
    return ProbeCase(query=query, expected_tables=split_expected(expected))


def expected_rank(result: dict[str, Any], expected_tables: list[str]) -> int | None:
    if not expected_tables:
        return None
    for index, table in enumerate(result["tables"], start=1):
        for expected in expected_tables:
            if table_name_matches(expected, table["schema"], table["name"]):
                return index
    return None


def print_result(result: dict[str, Any], expected_tables: list[str], show_text: bool) -> None:
    print()
    print(f"Query: {result['query']}")
    if expected_tables:
        rank = expected_rank(result, expected_tables)
        status = f"HIT rank={rank}" if rank is not None else "MISS"
        print(f"Expected: {', '.join(expected_tables)} -> {status}")
    print(f"Total matched tables before limit: {result['totalMatched']} truncated={result['truncated']}")
    if not result["tables"]:
        print("No table hits.")
        return
    for index, table in enumerate(result["tables"], start=1):
        print(f"{index:>2}. {table['schema']}.{table['name']} score={table['score']:.4f} {table['reason']}")
        for column in table.get("matchedColumns", [])[:5]:
            print(
                f"    - {column['name']} {column.get('dataType', '')} "
                f"score={column['score']:.4f} vector={column.get('vectorScore', 0):.4f} "
                f"lexical={column.get('lexicalRaw', 0):.2f} {column.get('reason', '')}"
            )
        if show_text:
            for doc in table.get("bestDocs", [])[:2]:
                excerpt = re.sub(r"\s+", " ", doc.get("text", "")).strip()
                if len(excerpt) > 240:
                    excerpt = excerpt[:237] + "..."
                label = doc["kind"]
                if doc.get("column"):
                    label += f":{doc['column']}"
                print(
                    f"      doc[{label}] score={doc['score']:.4f} vector={doc['vectorScore']:.4f} "
                    f"lexical={doc['lexicalRaw']:.2f}: {excerpt}"
                )


def summarize_batch(results: list[tuple[ProbeCase, dict[str, Any]]]) -> None:
    expected = [(case, result) for case, result in results if case.expected_tables]
    if not expected:
        return
    print()
    print("Batch accuracy summary")
    for k in (1, 3, 5, 10):
        hits = 0
        for case, result in expected:
            rank = expected_rank(result, case.expected_tables)
            if rank is not None and rank <= k:
                hits += 1
        print(f"hit@{k}: {hits}/{len(expected)} = {hits / len(expected):.2%}")
    misses = [(case, result) for case, result in expected if expected_rank(result, case.expected_tables) is None]
    if misses:
        print("Misses:")
        for case, result in misses:
            top = result["tables"][0] if result["tables"] else None
            top_name = f"{top['schema']}.{top['name']}" if top else "(none)"
            print(f"  - query={case.query!r} expected={case.expected_tables} top1={top_name}")


def dump_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Probe DBX Schema RAG embedding retrieval accuracy.")
    source = parser.add_argument_group("Index/config source")
    source.add_argument("--data-dir", help="DBX data dir. Usually contains schema-rag/config.json and schema-rag/indexes/...")
    source.add_argument("--connection-id", help="Connection id used when the schema index was analyzed.")
    source.add_argument("--database", help="Database name used when the schema index was analyzed.")
    source.add_argument("--schema", help="Schema name to search and to locate the index in --data-dir mode.")
    source.add_argument("--documents", help="Path to an existing Schema RAG documents.json.")
    source.add_argument("--config", help="Path to schema-rag/config.json.")

    query = parser.add_argument_group("Queries")
    query.add_argument("--query", action="append", help="Query to test. Can be repeated.")
    query.add_argument(
        "--queries-file",
        help="Optional .json/.jsonl/.tsv/.csv file. Rows may be: query<TAB>expected_table1,expected_table2",
    )
    query.add_argument("--expected-table", action="append", help="Expected table for --query mode. Can be repeated.")

    scoring = parser.add_argument_group("Scoring/output")
    scoring.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Top table limit to print. Default: 10.")
    scoring.add_argument(
        "--score-mode",
        choices=("sidecar", "vector", "lexical"),
        default="sidecar",
        help="sidecar reproduces current DBX weighting. vector/lexical isolate components.",
    )
    scoring.add_argument("--show-text", action="store_true", help="Print top matched document text excerpts.")
    scoring.add_argument("--output-json", help="Write full probe result JSON to this path.")

    overrides = parser.add_argument_group("Embedding config overrides")
    overrides.add_argument("--embedding-provider", help="Override embedding provider. Only openai-compatible is supported.")
    overrides.add_argument("--embedding-endpoint", help="Override embedding endpoint/base URL.")
    overrides.add_argument("--embedding-model", help="Override embedding model.")
    overrides.add_argument("--embedding-api-key", help="Override embedding API key. Empty string disables Authorization.")
    overrides.add_argument("--embedding-dimension", type=int, help="Override embedding dimension.")
    overrides.add_argument("--proxy-enabled", action="store_true", help="Use --proxy-url or config proxyUrl.")
    overrides.add_argument("--proxy-url", help="Proxy URL, e.g. http://127.0.0.1:7890.")
    overrides.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS, help="HTTP timeout seconds. Default: 120.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    paths = resolve_probe_paths(args)
    raw_config = load_json(paths.config_path)
    stored_index = load_json(paths.documents_path)
    if not isinstance(stored_index, dict):
        raise SystemExit(f"{paths.documents_path} must contain a JSON object")
    config = apply_config_overrides(normalize_config(raw_config), args)
    validate_config(config)
    docs = stored_index.get("documents") or []
    if not docs:
        raise SystemExit(f"No documents found in {paths.documents_path}")
    indexed_dims = sorted({len(document_embedding(doc)) for doc in docs if isinstance(doc, dict) and document_embedding(doc)})
    print(f"[index] documents={len(docs)} dims={indexed_dims} path={paths.documents_path}")
    print(f"[config] endpoint={resolve_endpoint(config.embedding_endpoint)} model={config.embedding_model} configured_dims={config.embedding_dimension}")

    cases = load_cases(args)
    outputs = []
    for case in cases:
        query_embedding = request_embeddings(config, [case.query], args.timeout)[0]
        if indexed_dims and len(query_embedding) not in indexed_dims:
            raise SystemExit(
                f"Query embedding dimension {len(query_embedding)} does not match indexed document dimensions {indexed_dims}. "
                "Rebuild the Schema RAG index or pass matching --embedding-dimension/model."
            )
        result = search_documents(
            stored_index=stored_index,
            schema=args.schema or str(camel_or_snake(stored_index.get("manifest") or {}, "schema", "schema", "")),
            query=case.query,
            query_embedding=query_embedding,
            limit=max(args.limit, 1),
            score_mode=args.score_mode,
        )
        print_result(result, case.expected_tables, args.show_text)
        outputs.append({"query": case.query, "expectedTables": case.expected_tables, "result": result})

    summarize_batch([(ProbeCase(item["query"], item["expectedTables"]), item["result"]) for item in outputs])
    if args.output_json:
        dump_json(Path(args.output_json).expanduser(), outputs)
        print(f"\nWrote JSON: {args.output_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
