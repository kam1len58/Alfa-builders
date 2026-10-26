"""
Загрузчик данных кейса.
Читает JSON-файлы и превращает их в Pydantic-объекты.
Даёт резолвер get_field_value для перевода имён полей из business_matrix
в имена полей профиля клиента.
"""

import json
import os
import re
from pathlib import Path

from src.models import (
    ClientProfile,
    BusinessMatrix,
    GoldenNews,
)


# Папка data/ лежит рядом с src/. __file__ — это src/data_loader.py,
# .parent — это src/, .parent.parent — корень проекта, / "data" — папка data.
DATA_DIR = Path(__file__).parent.parent / "data"


# Маппинг: как поля из business_matrix называются в профиле клиента.
# Взят из business_matrix.json → поле "field_map_csv_to_profile".
FIELD_MAP = {
    "CL_PRODUCT_LOA_MARK": "bank_products.has_loans",
    "CL_PRODUCT_LEA_MARK": "bank_products.has_leasing",
    "CL_PRODUCT_DEP_MARK": "bank_products.has_deposit",
    "CL_PRODUCT_ZPP_MARK": "bank_products.has_payroll",
    "CL_PRODUCT_GAR_MARK": "bank_products.has_guarantees",
    "FACTORING_MARK": "bank_products.has_factoring",
    "FTS_FLAG": "ved.has_ved",
    "FTS_COUNTRY_NAME": "ved.country",
    "MAINOKVED_CODE": "okved_code",
    "REVENUE_COMPANY": "revenue",
    "REGION": "region",
}


def get_field_value(profile: ClientProfile, field_name: str):
    """
    Достаёт значение из профиля по имени поля из business_matrix.

    Примеры:
        get_field_value(profile, "MAINOKVED_CODE")     -> "46.34"
        get_field_value(profile, "FTS_COUNTRY_NAME")   -> None или "КИТАЙ"
        get_field_value(profile, "CL_PRODUCT_LOA_MARK") -> 1 или 0

    Если путь ведёт в None (например, profile.ved is None) — возвращает None.
    Если поля нет в FIELD_MAP — пытается достать по имени напрямую.
    """
    path = FIELD_MAP.get(field_name, field_name)
    obj = profile
    for part in path.split("."):
        if obj is None:
            return None
        obj = getattr(obj, part, None)
    return obj


def load_all_profiles() -> dict[str, ClientProfile]:
    """Загружает profiles_all_1.json. Возвращает словарь {id: ClientProfile}."""
    filename = os.getenv('PROFILES_FILE')
    if not filename:
        return load_demo_profiles()
    with open(filename, 'r', encoding='utf-8-sig') as f:
        raw = json.load(f)
    def snake(value):
        if isinstance(value, list):
            return [snake(v) for v in value]
        if not isinstance(value, dict):
            return value
        return {re.sub(r'[A-Z]', lambda m: '_' + m[0].lower(), k): snake(v) for k, v in value.items()}
    rows = raw.get('profiles', list(raw.values())) if isinstance(raw, dict) else raw
    profiles = [ClientProfile(**snake(row)) for row in rows]
    return {p.synthetic_u: p for p in profiles}


def load_demo_profiles() -> dict[str, ClientProfile]:
    """Загружает demo_profiles.json. Там массив, а не словарь."""
    with open(DATA_DIR / "demo_profiles.json", "r", encoding="utf-8") as f:
        raw = json.load(f)
    return {item["synthetic_u"]: ClientProfile(**item) for item in raw}


def load_business_matrix() -> BusinessMatrix:
    """Загружает business_matrix.json (все правила и модификаторы)."""
    with open(DATA_DIR / "business_matrix.json", "r", encoding="utf-8") as f:
        return BusinessMatrix(**json.load(f))


def load_golden_news() -> list[GoldenNews]:
    """Загружает golden_news.json (эталонные разборы)."""
    with open(DATA_DIR / "golden_news.json", "r", encoding="utf-8") as f:
        raw = json.load(f)
    return [GoldenNews(**n) for n in raw["news"]]


# --- Самопроверка: запускается, когда вы делаете `python -m src.data_loader` ---

if __name__ == "__main__":
    print("=" * 50)
    print("ЗАГРУЗКА ДАННЫХ")
    print("=" * 50)

    profiles = load_all_profiles()
    demos = load_demo_profiles()
    matrix = load_business_matrix()
    news = load_golden_news()

    print(f"✓ Профилей загружено: {len(profiles)}")
    print(f"✓ Demo-профилей: {len(demos)}")
    print(f"✓ Правил в матрице: {len(matrix.rules)}")
    print(f"✓ Эталонных новостей: {len(news)}")

    print("\n" + "=" * 50)
    print("ПРОВЕРКА РЕЗОЛВЕРА (U_258064 — из demo_profiles)")
    print("=" * 50)

    p = profiles["U_258064"]
    print(f"ОКВЭД:          {get_field_value(p, 'MAINOKVED_CODE')}")
    print(f"Выручка:        {get_field_value(p, 'REVENUE_COMPANY'):,.0f}")
    print(f"Регион:         {get_field_value(p, 'REGION')}")
    print(f"Есть кредиты:   {get_field_value(p, 'CL_PRODUCT_LOA_MARK')}")
    print(f"Есть депозиты:  {get_field_value(p, 'CL_PRODUCT_DEP_MARK')}")
    print(f"Есть лизинг:    {get_field_value(p, 'CL_PRODUCT_LEA_MARK')}")
    print(f"Страна ВЭД:     {get_field_value(p, 'FTS_COUNTRY_NAME')}")

    print("\n" + "=" * 50)
    print("ПРОВЕРКА РЕЗОЛВЕРА (U_9250 — с ВЭД)")
    print("=" * 50)

    p2 = profiles["U_9250"]
    print(f"ОКВЭД:          {get_field_value(p2, 'MAINOKVED_CODE')}")
    print(f"Страна ВЭД:     {get_field_value(p2, 'FTS_COUNTRY_NAME')}")

    print("\n" + "=" * 50)
    print("ГОТОВО")
    print("=" * 50)
