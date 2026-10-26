
import os

# Ограничения памяти для Windows (OpenBLAS, OpenMP, tokenizers)
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ.setdefault("HF_HOME", os.path.join(os.environ.get("APP_DATA_DIR", os.path.expanduser("~/.alfa-business/runtime")), "ml", "models"))

from typing import Optional
import chromadb
from sentence_transformers import SentenceTransformer

# Мультиязычная модель для русского языка
EMBED_MODEL = "intfloat/multilingual-e5-small"
EMBED_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
_model: Optional[SentenceTransformer] = None


def get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(EMBED_MODEL, revision=EMBED_REVISION, device="cpu")
    return _model


def get_collection():
    client = chromadb.PersistentClient(path=os.path.join(os.environ.get("APP_DATA_DIR", os.path.expanduser("~/.alfa-business/runtime")), "ml", "legacy-chroma"))
    return client.get_or_create_collection(name="alfa_analytics")


def index_alfa_analytics():
    from src.data_loader import load_golden_news
    collection = get_collection()
    model = get_model()
    docs, ids, metadatas = [], [], []

    for news in load_golden_news():
        if news.alfa_view:
            docs.append("passage: " + news.alfa_view)
            ids.append(f"golden_{news.id}")
            metadatas.append({"topic": _topic_from_id(news.id)})

    if docs:
        embeddings = model.encode(docs, normalize_embeddings=True).tolist()
        collection.add(documents=docs, embeddings=embeddings, ids=ids, metadatas=metadatas)
        print(f"Проиндексировано {len(docs)} документов")


def _topic_from_id(nid):
    return {"N1": "инфляция", "N2": "pmi", "N3": "санкции", "N4": "топливо", "N5": "нефть"}.get(nid, "unknown")


def retrieve_alfa_view(topic: str, top_k: int = 1) -> str:
    collection = get_collection()
    model = get_model()
    query_embedding = model.encode(["query: " + topic], normalize_embeddings=True).tolist()

    # Сначала ищем по metadata-фильтру
    results = collection.query(
        query_embeddings=query_embedding,
        n_results=top_k,
        where={"topic": topic},  # ← фильтр по topic
    )
    if not results["documents"] or not results["documents"][0]:
        # fallback: ищем без фильтра
        results = collection.query(query_embeddings=query_embedding, n_results=top_k)

    if not results["documents"] or not results["documents"][0]:
        return ""

    text = results["documents"][0][0]
    if text.startswith("passage: "):
        text = text[len("passage: "):]
    return text
