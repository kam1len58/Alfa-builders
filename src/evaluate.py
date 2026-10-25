"""Оценка качества пайплайна на эталонных данных."""
import json
from src.data_loader import load_all_profiles, load_business_matrix, load_golden_news
from src.rule_engine import RuleEngine
from src.pipeline import analyze_news


# Для каждой новости — только те клиенты, для которых правило ДОЛЖНО сработать
TEST_CASES = {
    "N1": ["U_9250", "U_258064", "U_258131", "U_276153"],  # INFL_COSTS — всем
    "N2": ["U_258064", "U_258131"],                        # PMI_ORDERS — только оптовикам (ОКВЭД 46)
    "N3": ["U_9250", "U_258131", "U_276153"],              # SANCTIONS/CONCENTRATION — у кого ВЭД/концентрация
    "N4": ["U_9250"],                                       # FUEL — только стройке (ОКВЭД 42)
    "N5": ["U_9250"],                                       # GOV_PROCUREMENT — только у кого гарантии
}


def evaluate_rule_accuracy(engine, profiles, news_list):
    """Rule Accuracy: совпали ли matched_rules с эталоном (только где эталон имеет смысл)."""
    total = 0
    correct = 0
    details = []

    for news in news_list:
        expected = set(news.matched_rules)
        for uid in TEST_CASES.get(news.id, []):
            profile = profiles[uid]
            card = analyze_news(news.what_happened, profile, engine, news_id=news.id)
            actual = set(card["ai_conclusion"]["matched_rules"])

            overlap = expected & actual
            is_correct = len(overlap) > 0 or (not expected and not actual)

            total += 1
            if is_correct:
                correct += 1
            else:
                details.append({
                    "news_id": news.id,
                    "client": uid,
                    "expected": list(expected),
                    "actual": list(actual),
                })

    accuracy = correct / total if total else 0.0
    return {
        "accuracy": accuracy,
        "total": total,
        "correct": correct,
        "mismatches": details,
    }


def evaluate_factuality(engine, profiles, news_list):
    """Factuality: доля выводов, прошедших Self-Check без галлюцинаций."""
    total = 0
    passed = 0
    issues_all = []

    for news in news_list:
        for uid in ["U_9250", "U_258064"]:
            profile = profiles[uid]
            card = analyze_news(news.what_happened, profile, engine, news_id=news.id)

            total += 1
            if card["ai_conclusion"].get("self_check_passed", True):
                passed += 1
            else:
                issues_all.append({
                    "news_id": news.id,
                    "client": uid,
                    "issues": card["ai_conclusion"].get("self_check_issues", []),
                })

    accuracy = passed / total if total else 0.0
    return {
        "factuality": accuracy,
        "total": total,
        "passed": passed,
        "issues": issues_all,
    }


def evaluate_personalization(engine, profiles, news_list):
    """Персонализация: доля общих новостей в топ-5 у клиентов из разных отраслей."""
    feeds = {}
    for uid in ["U_9250", "U_258064"]:
        profile = profiles[uid]
        cards = []
        for news in news_list:
            card = analyze_news(news.what_happened, profile, engine, news_id=news.id)
            if card["bucket"] in ("focus", "all"):
                cards.append((news.id, card["score"]))
        cards.sort(key=lambda x: -x[1])
        feeds[uid] = [c[0] for c in cards[:5]]

    common = set(feeds["U_9250"]) & set(feeds["U_258064"])
    total_unique = len(set(feeds["U_9250"]) | set(feeds["U_258064"]))
    overlap = len(common) / total_unique if total_unique else 0.0

    return {
        "overlap": overlap,
        "feeds": feeds,
        "common_news": list(common),
    }


def test_noisy_data(engine, profiles):
    """Тест на «шумных» данных: клиент с пустыми полями не должен ломать пайплайн."""
    noisy_uids = ["U_183405", "U_199017"]
    results = []

    for uid in noisy_uids:
        if uid not in profiles:
            continue
        profile = profiles[uid]
        try:
            card = analyze_news(
                "Росстат: инфляция в сентябре 0,35%, годовая 6,35%",
                profile, engine, news_id="N1",
            )
            results.append({
                "client": uid,
                "status": "OK",
                "why_important": card["ai_conclusion"]["why_important"][:100],
            })
        except Exception as e:
            results.append({"client": uid, "status": "FAIL", "error": str(e)})

    return results


def main():
    print("=" * 60)
    print("ОЦЕНКА КАЧЕСТВА ПАЙПЛАЙНА")
    print("=" * 60)

    profiles = load_all_profiles()
    engine = RuleEngine(load_business_matrix())
    news_list = load_golden_news()

    # 1. Rule Accuracy
    print("\n[1] RULE ACCURACY")
    ra = evaluate_rule_accuracy(engine, profiles, news_list)
    print(f"  Точность: {ra['accuracy']:.1%} ({ra['correct']}/{ra['total']})")
    if ra["mismatches"]:
        print(f"  Расхождения: {len(ra['mismatches'])}")
        for m in ra["mismatches"][:5]:
            print(f"    {m['news_id']} + {m['client']}: ожидали {m['expected']}, получили {m['actual']}")

    # 2. Factuality
    print("\n[2] FACTUALITY")
    fa = evaluate_factuality(engine, profiles, news_list)
    print(f"  Прошли Self-Check: {fa['factuality']:.1%} ({fa['passed']}/{fa['total']})")
    if fa["issues"]:
        print(f"  Проблемы: {len(fa['issues'])}")
        for issue in fa["issues"][:3]:
            print(f"    {issue['news_id']} + {issue['client']}: {issue['issues']}")

    # 3. Персонализация
    print("\n[3] ПЕРСОНАЛИЗАЦИЯ (пересечение лент)")
    pers = evaluate_personalization(engine, profiles, news_list)
    print(f"  Пересечение топ-5 у U_9250 и U_258064: {pers['overlap']:.1%}")
    print(f"  Общие новости: {pers['common_news']}")
    print(f"  Лента U_9250: {pers['feeds']['U_9250']}")
    print(f"  Лента U_258064: {pers['feeds']['U_258064']}")

    # 4. Тест на шумных данных
    print("\n[4] ТЕСТ НА ШУМНЫХ ДАННЫХ")
    noisy = test_noisy_data(engine, profiles)
    for r in noisy:
        print(f"  {r['client']}: {r['status']}")
        if r["status"] == "OK":
            print(f"    → {r['why_important'][:80]}...")
        else:
            print(f"    → ОШИБКА: {r['error']}")

    # Сохраняем отчёт
    report = {
        "rule_accuracy": ra["accuracy"],
        "rule_accuracy_details": {"total": ra["total"], "correct": ra["correct"]},
        "factuality": fa["factuality"],
        "factuality_details": {"total": fa["total"], "passed": fa["passed"]},
        "personalization_overlap": pers["overlap"],
        "personalization_feeds": pers["feeds"],
        "noisy_data": noisy,
    }
    with open("data/evaluation_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nОтчёт сохранён: data/evaluation_report.json")

    print("\n" + "=" * 60)
    print("ГОТОВО")
    print("=" * 60)


if __name__ == "__main__":
    main()