"""Search only the bank documents whose provenance was checked by the website."""
import hashlib
import json
import os
from pathlib import Path


def retrieve_context(topic, sources, top_k=3):
    documents = [s for s in sources if s.get('kind') == 'bank' and s.get('verified') is True]
    if not documents:
        return {'items': [], 'method': 'no_verified_material'}
    import chromadb
    from src.rag import get_model
    root = Path(os.environ['APP_DATA_DIR']) / 'ml' / 'chroma'
    root.mkdir(parents=True, exist_ok=True)
    texts, ids, metadata = [], [], []
    by_id = {s['id']: s for s in documents}
    for source in documents:
        body = source['data'].get('text', '')
        # Keep offsets and source IDs: retrieved text never inherits a different attribution.
        for offset in range(0, len(body), 700):
            chunk = body[offset:offset + 900]
            if not chunk.strip():
                continue
            texts.append(chunk)
            ids.append(source['id'] + ':' + str(offset))
            metadata.append({'source_id': source['id'], 'offset': offset})
    if not texts:
        return {'items': [], 'method': 'no_verified_material'}
    digest = hashlib.sha256(json.dumps([ids, texts], ensure_ascii=False).encode()).hexdigest()[:24]
    collection = chromadb.PersistentClient(path=str(root), settings=chromadb.Settings(
        anonymized_telemetry=False)).get_or_create_collection('verified_' + digest)
    model = get_model()
    if collection.count() != len(texts):
        vectors = model.encode(['passage: ' + t for t in texts], normalize_embeddings=True,
                               show_progress_bar=False).tolist()
        collection.upsert(ids=ids, documents=texts, embeddings=vectors, metadatas=metadata)
    query = model.encode(['query: ' + topic], normalize_embeddings=True,
                         show_progress_bar=False).tolist()
    found = collection.query(query_embeddings=query, n_results=min(top_k, len(texts)))
    items = []
    for body, meta in zip(found['documents'][0], found['metadatas'][0]):
        source = by_id[meta['source_id']]
        items.append({'sourceId': source['id'], 'text': body, 'date': source.get('date'),
                      'historical': source.get('historical', False), 'url': source.get('url')})
    return {'items': items, 'method': 'chromadb_multilingual_e5_small'}
