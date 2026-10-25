# src/pipeline.py
import json
import uuid
from pathlib import Path

from src.data_loader import get_field_value
from src.models import ClientProfile
from src.rule_engine import RuleEngine
from src.extractor import extract_news_facts
from src.rag import retrieve_alfa_view
from src.conclusion_generator import generate_conclusion

CATEGORY_MAP = {
    # Ключевая ставка (5 правил)
    "KR_HIGH_LOANS": "Ключевая ставка",
    "KR_HIGH_LEASING": "Ключевая ставка",
    "KR_HIGH_DEPOSITS": "Ключевая ставка",
    "KR_CUT_LOANS": "Ключевая ставка",
    "KR_HIGH_CAPEX": "Ключевая ставка",

    # Макроэкономика (5 правил)
    "INFL_COSTS": "Макроэкономика",
    "LABOR_WAGES": "Макроэкономика",
    "GDP_SLOWDOWN": "Макроэкономика",
    "PMI_ORDERS": "Макроэкономика",
    "CONSUMER_DEMAND": "Макроэкономика",

    # Валюта и ВЭД (3 правила)
    "FX_RUB_WEAK": "Валюта и ВЭД",
    "FX_RUB_STRONG": "Валюта и ВЭД",
    "FX_CNY": "Валюта и ВЭД",

    # Санкции и таможня (2 правила)
    "SANCTIONS": "Санкции",
    "CUSTOMS": "Таможня",

    # Сырьё и топливо (4 правила)
    "FUEL": "Сырьё и топливо",
    "OIL": "Сырьё и топливо",
    "METALS": "Сырьё и топливо",
    "GOLD": "Сырьё и топливо",

    # Отраслевые и регуляторные (3 правила)
    "MORTGAGE_CONSTR": "Строительство",
    "GOV_PROCUREMENT": "Госзакупки",
    "BOND_MARKET": "Долговой рынок",

    # Контрагенты по графу платежей (3 правила)
    "PARTNER_INDUSTRY": "Контрагенты",
    "SUPPLIER_CONCENTRATION": "Контрагенты",
    "CUSTOMER_CONCENTRATION": "Контрагенты",
}


def _rule_to_category(rule_id: str) -> str:
    return CATEGORY_MAP.get(rule_id, "Прочее")



def analyze_news(news_text: str, profile: ClientProfile, engine: RuleEngine, news_id: str = None) -> dict:
    trace_id = uuid.uuid4().hex[:8]
    trace = {"trace_id": trace_id, "steps": []}

    facts = extract_news_facts(news_text)
    trace["steps"].append({"step": 1, "tool": "extract_news_facts", "output": facts})

    scoring = engine.evaluate(news_text, profile)
    trace["steps"].append({
        "step": 2,
        "tool": "rule_engine",
        "matched_rules": [m.rule_id for m in scoring.matches],
        "score": scoring.score,
    })

    alfa_view = retrieve_alfa_view(facts.get("topic", ""))
    conclusion, check = generate_conclusion(profile, facts, scoring, alfa_view)
    trace["steps"].append({"step": 3, "tool": "rag", "query": facts.get("topic"), "found": alfa_view})

    # Сохраняем trace
    Path("data/traces").mkdir(exist_ok=True)
    with open(f"data/traces/trace_{trace_id}.json", "w", encoding="utf-8") as f:
        json.dump(trace, f, ensure_ascii=False, indent=2)

    return _build_card(profile, facts, scoring, alfa_view, trace_id, engine, news_id, conclusion, check)


def _build_card(profile, facts, scoring, alfa_view, trace_id, engine, news_id=None, conclusion=None, check=None) -> dict:
    features = []
    for match in scoring.matches:
        rule = next((r for r in engine.matrix.rules if r.id == match.rule_id), None)
        if rule:
            for cond in rule.condition:
                value = get_field_value(profile, cond.field)
                features.append(f"{cond.field}={value}")
    features = list(set(features))

    first_rule = scoring.matches[0] if scoring.matches else None
    category = _rule_to_category(first_rule.rule_id) if first_rule else "Прочее"
    next_product = first_rule.bank_products[0] if first_rule and first_rule.bank_products else None

    return {
        "news_id": news_id,
        "company_id": profile.synthetic_u,
        "date": facts.get("date"),
        "title": facts.get("what_happened", ""),
        "category": category,
        "score": scoring.score,
        "bucket": scoring.bucket,
        "facts": {"text": facts.get("what_happened", ""), "sources": []},
        "alfa_view": {"text": alfa_view, "sources": []},
        "ai_conclusion": {
            "why_important": conclusion.get("why_important", ""),
            "consequences": conclusion.get("consequences", {"risks": [], "opportunities": []}),
            "actions": conclusion.get("actions", []),
            "company_features_used": features,
            "matched_rules": [m.rule_id for m in scoring.matches],
            "self_check_passed": check.get("passed", True) if check else True,
            "self_check_issues": check.get("issues", []) if check else [],
        },
        "next_best_action": conclusion.get("next_best_action", {
            "product": next_product,
            "text": f"Обсудить с менеджером: {next_product}" if next_product else "",
        }),
        "trace_id": trace_id,
    }