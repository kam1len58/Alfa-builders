# src/conclusion_generator.py
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

LLM_MODEL = "deepseek/deepseek-v4.1-flash"


def generate_conclusion(profile, facts, scoring, alfa_view) -> dict:
    """Генерирует персонализированный вывод для клиента."""
    if not os.getenv("LLM_API_KEY"):
        return {
            "why_important": "",
            "consequences": {"risks": [], "opportunities": []},
            "actions": [],
            "next_best_action": {"product": None, "text": ""},
        }

    bank_products = []
    if profile.bank_products.has_loans: bank_products.append("кредиты")
    if profile.bank_products.has_leasing: bank_products.append("лизинг")
    if profile.bank_products.has_deposit: bank_products.append("депозиты")
    if profile.bank_products.has_payroll: bank_products.append("зарплатный проект")
    if profile.bank_products.has_guarantees: bank_products.append("гарантии")


    all_products = []
    for m in scoring.matches:
        all_products.extend(m.bank_products)
    all_products = list(set(all_products))
    products_text = ", ".join(all_products) if all_products else "нет"

    matched_rules_text = "\n".join(
        f"- {m.rule_id} (эффект: {m.effect}, вес: {m.final_weight:.2f})"
        for m in scoring.matches
    )

    system_prompt = f"""Ты — аналитик Альфа-Банка. Объясни клиенту,
почему эта новость важна именно для его компании.

КОНТЕКСТ КЛИЕНТА:
- Отрасль: {profile.industry}
- ОКВЭД: {profile.okved_code}
- Выручка: {profile.revenue:,.0f} руб.
- Регион: {profile.region}
- Продукты банка у клиента: {', '.join(bank_products) or 'нет'}
- ВЭД: {profile.ved.country if profile.ved.has_ved else 'нет'}

НОВОСТЬ:
{facts.get('what_happened', '')}

СРАБОТАВШИЕ ПРАВИЛА:
{matched_rules_text}

МНЕНИЕ АЛЬФА-БАНКА:
{alfa_view}

ДОСТУПНЫЕ ПРОДУКТЫ БАНКА (для next_best_action):
{products_text}

ЗАДАЧА:
Верни СТРОГО JSON:
{{
  "why_important": "1-2 предложения, почему это важно для ЭТОЙ компании. Упомяни ОКВЭД или отрасль и продукты банка.",
  "consequences": {{
    "risks": ["риск 1 (до 15 слов)", "риск 2 (до 15 слов)"],
    "opportunities": ["возможность 1 (до 15 слов)", "возможность 2 (до 15 слов)"]
  }},
  "actions": ["действие 1", "действие 2", "действие 3"],
  "next_best_action": {{
    "product": "название ОДНОГО продукта из списка выше, наиболее подходящего клиенту с учётом его профиля",
    "text": "короткое действие для менеджера (1 предложение)"
  }}
}}

ВАЖНО: каждый пункт в risks и opportunities — не длиннее 15 слов.
КРИТИЧНО: 
1. НЕ придумывай конкретные числа, даты, номера законов, проценты, сроки, которых НЕТ в новости или в мнении Альфа-Банка. Если нужна цифра — используй только те, что есть в новости. Если нет — пиши общими словами («в ближайшие месяцы», «в среднесрочной перспективе», «по действующим программам»).
2. Упоминай ТОЛЬКО те продукты банка, которые есть в списке выше. НЕ придумывай продукты, которых у клиента нет."""

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Сгенерируй вывод."},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
    )

    content = response.choices[0].message.content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    result = json.loads(content)

    # Self-Check
    check = self_check(profile, facts, alfa_view, result, products_text)
    if not check.get("passed", True):
        print(f"[Self-Check] Проблемы: {check.get('issues')}")

    return result, check


def self_check(profile, facts, alfa_view, conclusion, products_text="") -> dict:
    """Проверяет вывод на галлюцинации, различая три источника правды."""
    bank_products = []
    if profile.bank_products.has_loans: bank_products.append("кредиты")
    if profile.bank_products.has_leasing: bank_products.append("лизинг")
    if profile.bank_products.has_deposit: bank_products.append("депозиты")

    check_prompt = f"""Ты проверяешь вывод аналитика на галлюцинации.

КРИТИЧНО: вывод строится на ТРЁХ источниках правды:
1. НОВОСТЬ (текст ниже)
2. МНЕНИЕ АЛЬФА-БАНКА (текст ниже) — цитаты оттуда НЕ галлюцинация
3. ПРОФИЛЬ КЛИЕНТА (ниже) — ОКВЭД, регион, продукты, ВЭД, выручка НЕ галлюцинация

НЕ считай галлюцинацией:
- Упоминание ОКВЭД, региона, продуктов, ВЭД, выручки (это из профиля)
- Упоминание ставок, курса, прогнозов (это из alfa_view)
- Упоминание продуктов банка из списка «ДОСТУПНЫЕ ПРОДУКТЫ» ниже (это из правил)
- Общие слова («маржа», «себестоимость», «оборотный капитал»)
- Числа в разделе "actions" (это рекомендации, а не факты)

ДОСТУПНЫЕ ПРОДУКТЫ БАНКА (из сработавших правил, это правда):
{products_text}

ПРОФИЛЬ КЛИЕНТА:
- Отрасль: {profile.industry}
- ОКВЭД: {profile.okved_code}
- Регион: {profile.region}
- Выручка: {profile.revenue:,.0f} руб.
- Продукты: {', '.join(bank_products) or 'нет'}
- ВЭД: {profile.ved.country if profile.ved.has_ved else 'нет'}

НОВОСТЬ:
{facts.get('what_happened', '')}

МНЕНИЕ АЛЬФА-БАНКА (цитаты оттуда — правда):
{alfa_view}

ВЫВОД:
{json.dumps(conclusion, ensure_ascii=False, indent=2)}

Проверь ТОЛЬКО:
1. Есть ли в выводе **числа или даты**, которых НЕТ ни в новости, ни в alfa_view, ни в профиле?
2. Есть ли в выводе **события**, противоречащие новости?

НЕ считай галлюцинацией:
- Упоминание ОКВЭД, региона, продуктов, ВЭД, выручки (это из профиля)
- Упоминание ставок, курса, прогнозов (это из alfa_view)
- Общие слова («маржа», «себестоимость», «оборотный капитал»)

Верни СТРОГО JSON:
{{"passed": true/false, "issues": ["конкретная проблема"]}}"""

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": check_prompt}],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    content = response.choices[0].message.content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return json.loads(content)