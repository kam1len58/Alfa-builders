# Альфа-Будущее: ML-сервис новостной аналитики и персонализированных инсайтов

Интеллектуальный ML-сервис на Python 3.12 для автоматического сопоставления внешних новостей, аналитики Альфа-Банка и детального бизнес-контекста крупных корпоративных клиентов. Сервис извлекает факты из новости, определяет релевантность по 25 правилам, находит позицию Альфа-Банка через RAG и генерирует персонализированный вывод с рисками, возможностями и рекомендациями.

## Запуск

Для запуска проекта требуется установленный Python 3.12.

```bash
# Перейти в директорию проекта
cd project_alfa

# Создать виртуальное окружение
python -m venv .venv
.venv\Scripts\Activate.ps1

# Установить зависимости
pip install -r requirements.txt

# Скопировать шаблон окружения и заполнить .env
copy .env.example .env
# Вписать LLM_BASE_URL, LLM_API_KEY, LLM_MODEL

# Индексировать RAG (один раз)
$env:OPENBLAS_NUM_THREADS="1"
python -c "from src.rag import index_alfa_analytics; index_alfa_analytics()"

# Оценка качества
python -m src.evaluate
```

 После запуска evaluate.py выводит метрики на эталонных данных и сохраняет отчёт в data/evaluation_report.json.
## ML-пайплайн
Разбор новости выполняется в 6 последовательных шагов, каждый из которых логируется в data/traces/trace_{trace_id}.json:
1. Извлечение фактов (src/extractor.py) — Gemma 4 извлекает what_happened, date, entities, topic в строгий JSON.

2. Скоринг релевантности (src/rule_engine.py) — 25 правил из business_matrix.json, формула score = 1 − Π(1 − w_i), модификаторы (регион, страна, ОКВЭД, доля контрагента).

3. RAG по аналитике Альфы (src/rag.py) — ChromaDB + intfloat/multilingual-e5-small находит позицию банка по topic.

4. Генерация вывода (src/conclusion_generator.py) — DeepSeek генерирует why_important, risks, opportunities, actions, next_best_action с учётом профиля клиента.

5. Self-Check (src/conclusion_generator.py) — проверка вывода на галлюцинации с учётом трёх источников правды: новость, мнение Альфа-Банка, профиль клиента.

6. Сборка карточки (src/pipeline.py) — всё соединяется в карточку по контракту API_CONTRACT.md.

Пайплайн обеспечивает полную трассируемость: по trace_id можно восстановить, какие инструменты вызывал агент, какие чанки из RAG достал и какие правила сработали.

## Файлы и структура
```
project_alfa/
├── Dockerfile                  # Сборка ML-сервиса
├── .dockerignore              # Что не копировать в образ
├── requirements.txt           # Зависимости (минимальный набор)
├── README.md                  # Этот файл
├── THIRD_PARTY_NOTICES.md     # Сторонние компоненты и лицензии
├── API_CONTRACT.md            # Контракт карточки и API
├── .env.example               # Шаблон переменных окружения
├── data/
│   ├── golden_news.json       # Эталонные разборы новостей
│   ├── profiles_all_1.json    # 100 профилей компаний
│   ├── demo_profiles.json     # 4 demo-клиента
│   ├── business_matrix.json   # 25 правил скоринга
│   ├── evaluation_report.json # Отчёт с метриками
│   └── traces/                # Логи шагов агента (генерируются)
└── src/
    ├── data_loader.py         # Загрузка JSON, резолвер полей
    ├── models.py              # Pydantic-модели
    ├── rule_engine.py         # Правила, скоринг, модификаторы
    ├── extractor.py           # LLM-извлечение фактов
    ├── rag.py                 # ChromaDB + эмбеддинги
    ├── conclusion_generator.py # LLM-генерация + Self-Check
    ├── pipeline.py            # Связка всех компонентов
    └── evaluate.py            # Метрики качества
```

## Результаты и метрики
Отчёт data/evaluation_report.json (генерируется src/evaluate.py):

| Метрика | Результат | Цель |
|---|---|---|
| Rule Accuracy | 100% (11/11) | 100% |
| Factuality(Self-Check) | 100% (10/10) | ≥95% |
| Пересечение лент (персонализация) | 20% | ≤40% |
| Тест на «шумные» данные | OK (2/2) | Не падает |

* Rule Accuracy — совпадение сработавших правил с эталоном golden_news.json.
* Factuality — доля выводов, прошедших Self-Check без галлюцинаций.
* Пересечение лент — доля общих новостей в топ-5 у клиентов из разных отраслей.
* Тест на «шумных» данных — клиенты с пустыми полями (без контрагентов, без ВЭД) не ломают пайплайн.

## Ограничения
* Модель эмбеддингов intfloat/multilingual-e5-small загружается 1–2 минуты при первом запуске (потом кэшируется).
* Лимит LLM — 500 ₽/день на ключ (общий для команды).
* На Windows обязательна переменная OPENBLAS_NUM_THREADS=1 (иначе MemoryError).
* При недоступности LLM сервис переключается на rule-based fallback и возвращает корректный разбор.

## Состав репозитория
Коммитить исходный код ML-сервиса, конфигурационные файлы, исходные датасеты (golden_news.json, profiles_all_1.json, demo_profiles.json, business_matrix.json), README.md, Dockerfile, .dockerignore, THIRD_PARTY_NOTICES.md, requirements.txt, API_CONTRACT.md, data/evaluation_report.json.