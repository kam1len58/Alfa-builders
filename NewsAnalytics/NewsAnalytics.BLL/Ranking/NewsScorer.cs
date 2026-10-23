using NewsAnalytics.BLL.Dto;
using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Ranking;

public class NewsScorer
{
    private const double FocusThreshold = 0.6;

    public ScoredNewsDto Score(CompanyProfile company, NewsItem news, IReadOnlyList<AlfaAnalyticsItem>? analytics = null)
    {
        var hits = RuleCatalog.All
            .Where(r => news.Tags.Contains(r.Code) && r.AppliesTo(company))
            .Select(r => new RuleHitDto(
                r.Code,
                r.Weight,
                BuildExplanation(r, news),
                r.BankProducts))
            .ToList();

        var score = hits.Count == 0
            ? 0
            : 1 - hits.Aggregate(1.0, (acc, h) => acc * (1 - h.Weight));
        score = Math.Round(score, 3);

        var tier = score == 0 ? FeedTierDto.Hidden
                 : score >= FocusThreshold ? FeedTierDto.Focus
                 : FeedTierDto.All;

        AlfaAnalyticsItem? alfaPosition = null;
        if (analytics != null)
        {
            alfaPosition = analytics.FirstOrDefault(a => a.Id == "A_" + news.Id);
        }

        return new ScoredNewsDto(news, score, tier, hits, alfaPosition);
    }

    public IReadOnlyList<ScoredNewsDto> Rank(CompanyProfile company, IEnumerable<NewsItem> news, IReadOnlyList<AlfaAnalyticsItem>? analytics = null)
    {
        return news
            .Select(n => Score(company, n, analytics))
            .Where(s => s.Tier != FeedTierDto.Hidden)
            .OrderByDescending(s => s.Score)
            .ToList();
    }

    private static string BuildExplanation(ScoringRule rule, NewsItem news)
    {
        var content = news.Content.ToLowerInvariant();
        var isNegative = content.Contains("снижен") || content.Contains("паден") || content.Contains("сокращен") || content.Contains("упал");
        var isPositive = content.Contains("рост") || content.Contains("увеличен") || content.Contains("вырос") || content.Contains("ускорил");

        var dynamicText = rule.Code switch
        {
            "PMI_ORDERS" when isPositive => "Производство/опт → рост заказов поддерживает выручку.",
            "PMI_ORDERS" when isNegative => "Производство/опт → снижение заказов бьёт по выручке.",
            "PMI_ORDERS" => rule.Explanation,

            "FUEL" when isPositive => "Топливоёмкая отрасль → рост цен на топливо прямо в себестоимости.",
            "FUEL" when isNegative => "Топливоёмкая отрасль → снижение цен на топливо снижает себестоимость.",
            "FUEL" => rule.Explanation,

            _ => rule.Explanation
        };

        var contextParts = new List<string>();
        if (!string.IsNullOrWhiteSpace(news.WhyImportant))
            contextParts.Add($"Важно: {news.WhyImportant}");
        if (!string.IsNullOrWhiteSpace(news.Consequences))
            contextParts.Add($"Последствия: {news.Consequences}");

        if (contextParts.Count > 0)
            return $"{dynamicText} {string.Join(" ", contextParts)}";

        return dynamicText;
    }
}