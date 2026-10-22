using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Dto;

public record ScoredNewsDto(
    NewsItem News,
    double Score,
    FeedTierDto Tier,
    IReadOnlyList<RuleHitDto> Hits);
