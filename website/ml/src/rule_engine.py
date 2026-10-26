"""
Rule Engine: определяет, какие правила из business_matrix срабатывают
для конкретной новости и конкретного клиента, и считает итоговый score.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from src.data_loader import get_field_value
from src.models import ClientProfile, BusinessMatrix, Rule, RuleCondition


@dataclass
class RuleMatch:
    """Результат срабатывания одного правила."""
    rule_id: str
    effect: str                 # "риск" | "возможность" | "риск/возможность"
    base_weight: float          # исходный вес из правила
    final_weight: float         # вес после модификаторов
    modifiers_applied: list = field(default_factory=list)  # какие модификаторы применились
    bank_products: list = field(default_factory=list)      # рекомендуемые продукты банка


@dataclass
class ScoringResult:
    """Результат скоринга новости для клиента."""
    matches: list = field(default_factory=list)   # список RuleMatch
    score: float = 0.0                            # итоговый score (0..1)
    bucket: str = "скрыть"                        # "В фокусе" / "Все события" / "скрыть"


class RuleEngine:
    def __init__(self, matrix: BusinessMatrix):
        self.matrix = matrix

    # --- 2.1. Проверка триггеров ---

    def _news_matches_triggers(self, news_text: str, rule: Rule) -> bool:
        """Есть ли триггер правила в тексте новости."""
        text_lower = news_text.lower()
        for trigger in rule.triggers:
            trigger_lower = trigger.lower()
            if trigger_lower in text_lower:
                return True
            STEMMING_OK = {"санкции", "таможня", "пошлина", "перебои поставок"}
            if trigger_lower in STEMMING_OK and trigger_lower[:6] in text_lower:
                return True
        return False

    # --- 2.2. Проверка условий на клиента ---

    def _check_condition(self, profile: ClientProfile, cond: RuleCondition) -> bool:
        """Выполнено ли одно условие правила для данного клиента."""
        value = get_field_value(profile, cond.field)

        # Поле пустое / неизвестно → условие НЕ выполняется
        if value is None:
            return False

        # eq: точное совпадение
        if cond.eq is not None:
            return value == cond.eq

        # gte: больше или равно
        if cond.gte is not None:
            try:
                return float(value) >= cond.gte
            except (TypeError, ValueError):
                return False

        # in: значение входит в список
        if cond.in_ is not None:
            return value in cond.in_

        # okved_prefix: ОКВЭД начинается с одного из префиксов
        if cond.okved_prefix is not None:
            str_value = str(value)
            return any(str_value.startswith(p) for p in cond.okved_prefix)

        # matches_news_industry: для правил про контрагентов.
        # Пока упрощённо — проверяем, что поле не пустое.
        if cond.matches_news_industry is not None:
            return bool(value)

        # Условие без проверок (пустое) — считается выполненным
        return True

    def _profile_matches_conditions(self, profile: ClientProfile, rule: Rule) -> bool:
        """Все ли условия правила выполнены для клиента."""
        if not rule.condition:
            return True  # нет условий = подходит всем
        for cond in rule.condition:
            if not self._check_condition(profile, cond):
                return False
        return True

    # --- 2.3. Модификаторы ---

    def _apply_modifiers(
        self,
        profile: ClientProfile,
        rule: Rule,
        news_text: str,
        base_weight: float,
    ) -> tuple[float, list]:
        """
        Применяет модификаторы из business_matrix к весу правила.
        Возвращает (итоговый вес, список применённых модификаторов).
        """
        weight = base_weight
        applied = []
        text_lower = news_text.lower()

        # Модификатор 1: страна ВЭД клиента упомянута в новости → ×1.15
        country = get_field_value(profile, "FTS_COUNTRY_NAME")
        if country:
            # country может быть "ТУРЦИЯ, НИДЕРЛАНДЫ" — проверяем каждую страну
            for c in country.split(","):
                if c.strip().lower() in text_lower:
                    weight *= 1.15
                    applied.append(f"страна ВЭД '{c.strip()}' упомянута ×1.15")
                    break

        # Модификатор 2: регион клиента упомянут в новости → ×1.10
        region = get_field_value(profile, "REGION")
        if region and region.lower() in text_lower:
            weight *= 1.10
            applied.append(f"регион '{region}' упомянут ×1.10")

        # Модификатор 3: ОКВЭД-группа компании названа в новости → ×1.20
        okved = get_field_value(profile, "MAINOKVED_CODE")
        if okved:
            okved_prefix = str(okved)[:2]
            for group_name, prefixes in self.matrix.okved_groups.items():
                if okved_prefix in prefixes:
                    # Ищем название группы (англ. → русское приближение)
                    # Простое совпадение по первым 2 цифрам в тексте — не сработает,
                    # поэтому проверяем по ключевым словам групп:
                    group_keywords = {
                        "construction": ["строительств", "застройщик"],
                        "wholesale": ["оптов"],
                        "retail": ["рознич"],
                        "transport": ["перевозк", "транспорт", "логистик"],
                        "manufacturing": ["производств"],
                        "metals": ["металл"],
                        "food": ["продукт", "питан"],
                        "energy": ["энерг", "электростанц"],
                    }
                    keywords = group_keywords.get(group_name, [])
                    if any(kw in text_lower for kw in keywords):
                        weight *= 1.20
                        applied.append(f"ОКВЭД-группа '{group_name}' упомянута ×1.20")
                        break

        # Модификатор 4: правило сработало по графу платежей → × доля контрагента (мин. 0.3)
        # Применяется только к правилам про контрагентов.
        if rule.id in ("PARTNER_INDUSTRY", "SUPPLIER_CONCENTRATION", "CUSTOMER_CONCENTRATION"):
            shares = []
            cp = get_field_value(profile, "counterparties")
            if cp is not None:
                # Для SUPPLIER_CONCENTRATION — доля топ-1 поставщика
                if rule.id == "SUPPLIER_CONCENTRATION":
                    if getattr(cp, "top_supplier_share", None):
                        shares.append(cp.top_supplier_share)
                # Для CUSTOMER_CONCENTRATION — доля топ-1 покупателя
                elif rule.id == "CUSTOMER_CONCENTRATION":
                    if getattr(cp, "top_customer_share", None):
                        shares.append(cp.top_customer_share)
                # Для PARTNER_INDUSTRY — берём максимум из двух
                elif rule.id == "PARTNER_INDUSTRY":
                    if getattr(cp, "top_supplier_share", None):
                        shares.append(cp.top_supplier_share)
                    if getattr(cp, "top_customer_share", None):
                        shares.append(cp.top_customer_share)

            if shares:
                share = max(shares)
                multiplier = max(share, 0.3)  # минимум 0.3
                weight *= multiplier
                applied.append(f"граф платежей: доля {share:.1%} → ×{multiplier:.2f}")

        # Ограничение: итоговый вес не больше 1.0
        weight = min(weight, 1.0)
        return weight, applied

    # --- 2.4. Скоринг ---

    def _compute_score(self, weights: list[float]) -> float:
        """
        Формула из business_matrix:
        score = 1 - Π(1 - w_i)

        Несколько независимых причин усиливают друг друга, но score ≤ 1.
        """
        if not weights:
            return 0.0
        product = 1.0
        for w in weights:
            product *= (1.0 - w)
        return 1.0 - product

    def _score_to_bucket(self, score: float) -> str:
        if score >= 0.6:
            return "focus"
        if score >= 0.4:
            return "all"
        return "hidden"

    # --- 2.5. Главный метод ---

    def evaluate(self, news_text: str, profile: ClientProfile) -> ScoringResult:
        """
        Прогоняет новость через все правила для конкретного клиента.
        Возвращает ScoringResult со списком сработавших правил и итоговым score.
        """
        result = ScoringResult()
        weights = []

        for rule in self.matrix.rules:
            # 1. Есть ли триггер в тексте новости?
            if not self._news_matches_triggers(news_text, rule):
                continue

            # 2. Все ли условия на клиента выполнены?
            if not self._profile_matches_conditions(profile, rule):
                continue

            # 3. Применяем модификаторы
            final_weight, applied = self._apply_modifiers(
                profile, rule, news_text, rule.weight
            )

            # 4. Запоминаем сработавшее правило
            match = RuleMatch(
                rule_id=rule.id,
                effect=rule.effect,
                base_weight=rule.weight,
                final_weight=final_weight,
                modifiers_applied=applied,
                bank_products=rule.bank_products,
            )
            result.matches.append(match)
            weights.append(final_weight)

        # 5. Итоговый score
        result.score = self._compute_score(weights)
        result.bucket = self._score_to_bucket(result.score)
        return result
