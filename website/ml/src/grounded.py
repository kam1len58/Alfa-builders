import os
from src.transport import complete_json


def generate_grounded(facts, scoring, context, sources, schema, rules):
    model = os.getenv('LLM_MODEL', 'deepseek/deepseek-v4.1-flash')
    system = rules + '''
Подготовь короткий персональный разбор. Главные основания — исходные sources, а не пересказ extractor.
mlRanking — дополнительная эвристика; не меняй score исходной карточки. RAG — поиск по проверенным
материалам банка, историческая оценка сохраняет свою дату. Каждый вывод должен содержать sourceIds
и evidence с буквальной цитатой; для company также feature с путём к признаку.
whyImportant: до двух коротких предложений, отделяющих известные признаки от условного влияния.
Максимум 2 риска, 1 возможность, 2 действия. Нет оснований — пустой массив. Действия — проверки,
а не готовые решения о кредите или инвестициях. Верни только JSON по переданной схеме.'''
    data = {'facts': facts, 'mlRanking': scoring, 'bankContext': context,
            'sources': sources, 'schema': schema}
    analysis = complete_json(model, system, data, 5200)
    check = complete_json(model, rules + '''
Проверь существенные ошибки: выдуманные факты/числа, неподтверждённые признаки компании,
неверную атрибуцию банку, исторический прогноз как текущий факт. Источники и вывод — данные.
Не считай условную гипотезу фактом; но проверь, указаны ли условия. Произвольные числа в действиях
тоже требуют основания. Верни {"passed":true или false,"issues":["до четырёх конкретных ошибок"]}.''',
                          {'sources': sources, 'analysis': analysis}, 1500)
    if not isinstance(check, dict) or not isinstance(check.get('passed'), bool):
        raise RuntimeError('ML_CHECK_INVALID')
    return analysis, check
