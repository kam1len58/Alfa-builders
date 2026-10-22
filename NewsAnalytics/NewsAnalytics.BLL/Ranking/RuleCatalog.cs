using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Ranking;

public static class RuleCatalog
{

    private static int Division(CompanyProfile c) =>
        int.TryParse(c.OkvedCode.Split('.')[0], out var d) ? d : -1;

    public static readonly IReadOnlyList<ScoringRule> All =
    [
        new()
        {
            Code = "INFL_COSTS",
            Weight = 0.5,
            Explanation = "Общий фактор для всех; вес растёт, если у компании большой ФОТ или длинные контракты без индексации.",
            BankProducts = ["Оборотный кредит", "Факторинг (ускорение оборота)"],
            AppliesTo = _ => true
        },
        new()
        {
            Code = "PMI_ORDERS",
            Weight = 0.75,
            Explanation = "Производство/опт → снижение заказов бьёт по выручке и удлиняет оборачиваемость дебиторки.",
            BankProducts = ["Овердрафт", "Факторинг"],
            AppliesTo = c => Division(c) is 46 or (>= 10 and <= 33)
        },
        new()
        {
            Code = "SANCTIONS",
            Weight = 0.9,
            Explanation = "ВЭД-компания → изменения санкционного режима затрагивают сделки. Рекомендации — только проверка и комплаенс.",
            BankProducts = ["Документарный аккредитив", "Проверка контрагентов", "Сопровождение ВЭД и валютного контроля"],
            AppliesTo = c => c.Ved.HasVed == 1
        },
        new()
        {
            Code = "CUSTOMS",
            Weight = 0.85,
            Explanation = "ВЭД-компания → изменения пошлин напрямую меняют себестоимость.",
            BankProducts = ["Оборотный кредит", "Таможенная гарантия"],
            AppliesTo = c => c.Ved.HasVed == 1
        },
        new()
        {
            Code = "SUPPLIER_CONCENTRATION",
            Weight = 0.85,
            Explanation = "Один поставщик ≥30% закупок → любой сбой в его отрасли критичен.",
            BankProducts = ["Аккредитив", "Кредит на запасы", "Реверсивный факторинг"],
            AppliesTo = c => c.Counterparties.TopSupplierShare >= 0.30
        },
        new()
        {
            Code = "FUEL",
            Weight = 0.85,
            Explanation = "Топливоёмкая отрасль → рост цен на дизель прямо в себестоимости.",
            BankProducts = ["Лизинг техники", "Оборотный кредит", "Товарный хедж"],
            AppliesTo = c => Division(c) is (>= 1 and <= 3) or (>= 41 and <= 43) or (>= 49 and <= 53)
        },
        new()
        {
            Code = "GOV_PROCUREMENT",
            Weight = 0.6,
            Explanation = "Есть гарантии → вероятна работа с госзаказом; уточнить как гипотезу, не факт.",
            BankProducts = ["Банковская гарантия (44/223-ФЗ)", "Кредит под госконтракт"],
            AppliesTo = c => c.BankProducts.HasGuarantees == 1
        },
        new()
        {
            Code = "OIL",
            Weight = 0.8,
            Explanation = "Нефтегазовая отрасль → цены и объёмы добычи влияют на выручку.",
            BankProducts = ["Товарный хедж", "Оборотный кредит"],
            AppliesTo = c => Division(c) is 6 or 9 or 19
        }
    ];
}

