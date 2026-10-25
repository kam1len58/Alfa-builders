# src/extractor.py
import json
import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI


load_dotenv(Path(__file__).parent.parent / ".env")

client = OpenAI(
    api_key=os.getenv("LLM_API_KEY", "sk-FF-b55xVTJFTqCEpiCa22w"),
    base_url=os.getenv("LLM_BASE_URL", "https://changellenge.up.railway.app/v1"),
    timeout=120.0, 
)

LLM_MODEL = "google/gemma-4-26b-a4b-it"


def extract_news_facts(news_text: str) -> dict:
    """Извлекает структурированные факты из новости через LLM."""

    # Если ключа нет — возвращаем заглушку (для отладки без ключа)
    if not os.getenv("LLM_API_KEY"):
        return {
            "what_happened": news_text[:200],
            "date": None,
            "entities": [],
            "topic": "unknown",
        }

    system_prompt = system_prompt = """Ты — аналитик. Извлеки факты из новости.
Верни СТРОГО JSON:
{
  "what_happened": "1-2 предложения",
  "date": "YYYY-MM-DD или null",
  "entities": ["страны, компании"],
  "topic": "инфляция | ключевая ставка | санкции | топливо | нефть | PMI | госзакупки | другое"
}

ВАЖНО: topic — это ГЛАВНАЯ тема новости, а не побочное упоминание.
Если новость про санкции, но упоминает нефть — topic = "санкции".
Если новость про поставки дизеля, но упоминает Россию — topic = "топливо".
Только JSON, без пояснений."""

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": news_text},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
    )

    content = response.choices[0].message.content.strip()


    if content.startswith("```"):
        content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    return json.loads(content)