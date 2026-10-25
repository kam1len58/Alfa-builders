## LLM-модели (через changellenge.up.railway.app)

| Модель | Где используется | Лицензия |
|---|---|---|
| `google/gemma-4-26b-a4b-it` | `src/extractor.py` | Apache 2.0 |
| `deepseek/deepseek-v4.1-flash` | `src/conclusion_generator.py` | MIT |

Модели используются через прокси, предоставленный организаторами хакатона. Лицензии допускают коммерческое использование.

## Python-библиотеки

| Пакет | Лицензия | Назначение |
|---|---|---|
| `pydantic` | MIT | Валидация данных |
| `pydantic-settings` | MIT | Настройки из `.env` |
| `python-dotenv` | BSD-3-Clause | Загрузка `.env` |
| `openai` | Apache 2.0 | Клиент для LLM API |
| `chromadb` | Apache 2.0 | Векторная база данных |
| `sentence-transformers` | Apache 2.0 | Эмбеддинги |
| `torch` | BSD-3-Clause | Backend для эмбеддингов |

## Модель эмбеддингов

| Модель | Лицензия | Назначение |
|---|---|---|
| `intfloat/multilingual-e5-small` | MIT | Мультиязычные эмбеддинги (RAG) |

Источник: HuggingFace Hub.


## Сервисы

| Сервис | Назначение |
|---|---|
| `changellenge.up.railway.app` | Прокси для LLM (организаторы) |
| `huggingface.co` | Источник модели эмбеддингов |