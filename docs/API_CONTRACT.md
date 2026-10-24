# Формат данных и API

Общий формат для ML-сервиса, бэкенда и интерфейса.

## Карточка новости

```json
{
  "news_id": "N4",
  "company_id": "U_9250",
  "date": "2026-10-14",
  "title": "Россия возобновила экспорт дизеля из Приморска",
  "category": "Сырьё и топливо",
  "score": 0.85,
  "bucket": "focus",
  "facts": {
    "text": "14 октября 2026 года Россия возобновила отгрузки дизельного топлива из Приморска...",
    "sources": [{"title": "Reuters, данные LSEG", "url": "https://..."}]
  },
  "alfa_view": {
    "text": "Альфа-Банк оценивает ситуацию на топливном рынке как напряжённую...",
    "sources": [{"title": "Стратегия на IV квартал 2026 года", "url": "https://..."}]
  },
  "ai_conclusion": {
    "why_important": "Компания занимается строительством, топливо для техники — заметная часть затрат...",
    "consequences": {"risks": ["..."], "opportunities": ["..."]},
    "actions": ["Оценить долю топлива в себестоимости", "..."],
    "company_features_used": ["okved_code=42.99", "bank_products.has_leasing=1"],
    "matched_rules": ["FUEL"]
  },
  "next_best_action": {"product": "Лизинг техники", "text": "Обсудить с менеджером условия лизинга"},
  "trace_id": "a1b2c3"
}
```

- `facts` — только подтверждённое источником.
- `alfa_view` — только из материалов Альфа-Банка.
- `ai_conclusion` — выводы модели.
- `bucket`: `focus` при `score` от 0,6, `all` от 0,4 до 0,6; ниже 0,4 карточка не показывается.
- `trace_id` — ссылка на журнал шагов агента.

## API бэкенда

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/companies` | список компаний: `id`, `industry`, `revenue`, `region`, `scenario` |
| GET | `/api/company?id=U_9250` | полный профиль компании |
| GET | `/api/feed?company_id=U_9250` | карточки, отсортированные по `score` |
| POST | `/api/chat` | вход `{company_id, news_id, question}`, ответ `{answer, sources, trace_id}` |
| GET | `/api/trace?id=...` | шаги агента по карточке |

## API ML-сервиса

| Метод | Путь | Вход | Ответ |
|---|---|---|---|
| POST | `/analyze` | `{company, news: {id, title, text, url, date}}` | карточка новости |
| POST | `/chat` | `{company, news, card, question}` | `{answer, sources, trace_id}` |

`company` — объект профиля из `data/demo_profiles.json` или `data/profiles_all.json`.
