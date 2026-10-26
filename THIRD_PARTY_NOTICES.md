# Third-party notices

Компоненты сайта, шрифты, изображения, модели и источники новостей перечислены в [website/THIRD_PARTY_NOTICES](website/THIRD_PARTY_NOTICES).

## Данные

- Обезличенные данные Альфа-Банка из материалов кейса: `df_Uid_data_hack.csv`, `df_Uid_payment_hack.csv`, `df_Fid_Uid_link_hack.csv`. В репозиторий входят только производные профили четырёх демо-компаний и 115 крупных компаний.
- Аналитические материалы Центра макроэкономических исследований Альфа-Банка (Приложение 2 кейса) и публикации Альфа-Банка «Стратегия на IV квартал 2026 года».
- Эталонные разборы `data/golden_news.json` подготовлены командой по открытым публикациям; ссылки на первоисточники указаны в каждом разборе.

## Языковые модели

Через API организаторов, из списка, разрешённого кейсом:
- DeepSeek-V4.1-Flash
- Qwen3.6 35B A3B

## Библиотеки

| Компонент | Библиотека | Лицензия |
|---|---|---|
| analytics | pandas | BSD-3-Clause |
| analytics | openpyxl | MIT |
| NewsAnalytics | Microsoft.AspNetCore.OpenApi | MIT |
| NewsAnalytics | Microsoft.EntityFrameworkCore.Sqlite | MIT |
| NewsAnalytics | Swashbuckle.AspNetCore | MIT |
| website | linkedom, fast-xml-parser, pdfjs-dist | см. website/THIRD_PARTY_NOTICES |

## Смоделированные интеграции

Интерфейс Альфа-Бизнеса воспроизведён для демонстрации; интеграции с реальной системой банка нет.
