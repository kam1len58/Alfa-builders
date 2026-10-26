using NewsAnalytics.BLL.Ranking;
using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Services;

public class NewsClassifier
{
    private static readonly Dictionary<string, string[]> RuleKeywords = new()
    {
        ["INFL_COSTS"] = ["инфляц", "цены рост", "себестоим", "ФОТ", "зарплат"],
        ["PMI_ORDERS"] = ["PMI", "заказ", "производств", "промышленн", "активност"],
        ["SANCTIONS"] = ["санкц", "ограничен", "запрет", "эмбарго"],
        ["CUSTOMS"] = ["пошлин", "тамож", "импорт", "экспорт", "ВЭД"],
        ["SUPPLIER_CONCENTRATION"] = ["поставщ", "контрагент", "зависимост"],
        ["FUEL"] = ["топлив", "дизель", "бензин", "ГСМ", "нефтепродукт"],
        ["GOV_PROCUREMENT"] = ["госзакуп", "44-ФЗ", "223-ФЗ", "госзаказ", "тендер"],
        ["OIL"] = ["нефт", "газ", "добыч", "Brent", "Urals", "нефтегаз"]
    };

    public List<string> Classify(NewsItem news, CompanyProfile company)
    {
        var content = (news.Title + " " + news.Content).ToLowerInvariant();
        var matchedRules = new List<string>();

        foreach (var rule in RuleCatalog.All)
        {
            if (!rule.AppliesTo(company))
                continue;

            if (RuleKeywords.TryGetValue(rule.Code, out var keywords))
            {
                if (keywords.Any(kw => content.Contains(kw)))
                    matchedRules.Add(rule.Code);
            }
        }

        return matchedRules;
    }
}