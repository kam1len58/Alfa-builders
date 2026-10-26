namespace NewsAnalytics.BLL.Dto;

public record RuleHitDto(
    string Rule,
    double Weight,
    string Explanation,
    IReadOnlyList<string> BankProducts);
