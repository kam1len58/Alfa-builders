using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Ranking;

public class ScoringRule
{
    public required string Code { get; init; }
    public required double Weight { get; init; }
    public required string Explanation { get; init; }
    public required string[] BankProducts { get; init; }
    public required Func<CompanyProfile, bool> AppliesTo { get; init; }
}
