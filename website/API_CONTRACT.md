# Формат карточки и API

Сервер сайта реализует согласованный формат команды поверх C# API. Бэкенд команды не изменён. Интерфейс получает данные через эти маршруты:

| Метод | Путь | Ответ |
| --- | --- | --- |
| GET | /api/companies | Массив: id, industry, revenue, region, scenario |
| GET | /api/company?id=U_9250 | Полный профиль, camelCase |
| GET | /api/feed?company_id=U_9250 | Массив карточек по убыванию score |
| POST | /api/chat | {company_id, news_id, question, history?}; ответ: answer, sources, trace_id |
| GET | /api/trace?id=… | Этапы отбора/анализа, источники и проверки |
| POST | /analyze | {company:{id}, news:{id}}; полная карточка |
| POST | /chat | {company, news, card?, question, history?}; ответ как /api/chat |

В company также принимаются syntheticU и synthetic_u. Полный профиль и новость разрешается передать, но сервер читает зарегистрированные данные по ID: клиент не может заменить финансовый профиль или вставить непроверенный текст в анализ. Несовпадающий news.text возвращает 409 CONTEXT_MISMATCH. Новые материалы сначала импортируются разрешённым серверным сборщиком. card не используется как источник фактов.

Все маршруты требуют сессию и проверяют доступ к компании. Изменяющие запросы требуют X-CSRF-Token из GET /api/session. Генерация разрешена только ролям с analyze. Маршруты /api/Companies, /api/Companies/:id/feed и /api/ai/* сохранены для совместимости.

Карточка содержит news_id, company_id, date, title, category, score, bucket, facts, alfa_view, ai_conclusion, next_best_action, trace_id. focus: score >=0.6; all: 0.4–0.6; ниже 0.4 карточка не выдаётся. Балл — релевантность, не вероятность риска.

- facts.text — текст источника или сверенное изложение; facts.status и content_scope различают source_text, rss_excerpt и reviewed_summary. Нет ссылки — text=null и unverified. Ссылки доступны в facts.sources, с отметкой недоступной прямой загрузки.
- alfa_view — только подтверждённые материалы банка с датами и historical. Нет материала/готового разбора — text=null; позиция банка не придумывается.
- ai_conclusion — why_important, consequences.risks/opportunities, actions, company_features_used (путь=значение), matched_rules. Условия сохраняются в строках последствий. До генерации — null и analysis_status=not_generated. GET ленты не вызывает модель.
- next_best_action — первое проверенное действие. product=null, пока продукт не обоснован отдельно; автоматической подстановки рекламного предложения нет.
- trace_id с префиксом rank: показывает серверный отбор. После анализа — SHA-256 ID сохранённого разбора. Недоступные компании не раскрываются через trace.

Дополнения для интерфейса: publications (тексты разделены по публикациям), member_ids (включая прежние ID), discrepancies, source_warnings, source_excerpt, content_scope, origin, content_hash, ranking и analysis_payload. В последнем сохранены структурированные условия, цитаты, основания и журнал обработки; без него не следует интерпретировать строки как безусловный прогноз.

reviewed_summary — редакционное изложение, не цитата издателя. В publications.originalExcerpt находятся короткая оригинальная цитата, её URL и границы подтверждения. Исходные XLSX/JSON не переписываются. Расхождения цифр требуют проверки: разные значения могут относиться к разным периодам или метрикам.

Ошибки: 400 неверный запрос, 401 вход, 403 права/CSRF, 404 данные/устаревший trace, 409 другой текст, 429 лимит пользователя/провайдера/бюджета, 502 отказ проверки ответа, 503 недоступный сервис. Ошибка не заменяется фиктивным успешным разбором.
