using NewsAnalytics.BLL.Dto;
using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Ranking;

public class NewsScorer
{
    private const double FocusThreshold = 0.6;

    public ScoredNewsDto Score(CompanyProfile company, NewsItem news)
    {
        var hits = RuleCatalog.All
            .Where(r => news.Tags.Contains(r.Code) && r.AppliesTo(company))
            .Select(r => new RuleHitDto(r.Code, r.Weight, r.Explanation, r.BankProducts))
            .ToList();

        var score = hits.Count == 0
            ? 0
            : 1 - hits.Aggregate(1.0, (acc, h) => acc * (1 - h.Weight));
        score = Math.Round(score, 3);

        var tier = score == 0 ? FeedTierDto.Hidden
                 : score >= FocusThreshold ? FeedTierDto.Focus
                 : FeedTierDto.All;

        return new ScoredNewsDto(news, score, tier, hits);
    }

    public IReadOnlyList<ScoredNewsDto> Rank(CompanyProfile company, IEnumerable<NewsItem> news)
    {
        return news
            .Select(n => Score(company, n))
            .Where(s => s.Tier != FeedTierDto.Hidden)
            .OrderByDescending(s => s.Score)
            .ToList();
    }
}