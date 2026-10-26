namespace NewsAnalytics.BLL.Dto;

public record NewsInterpretationDto
{
    public string NewsId { get; init; } = "";
    public string WhatHappened { get; init; } = "";
    public string PublishedAt { get; init; } = "";
    public string WhyImportantForCompany { get; init; } = "";
    public string CompanyContext { get; init; } = "";
    public List<string> Risks { get; init; } = new();
    public List<string> Opportunities { get; init; } = new();
    public List<string> RecommendedActions { get; init; } = new();
    public string AlfaBankStance { get; init; } = "";
    public List<string> Sources { get; init; } = new();
    public List<RuleHitDto> TriggeredRules { get; init; } = new();
    public double RelevanceScore { get; init; }
    public FeedTierDto Tier { get; init; }
    public string AnalysisSteps { get; set; } = "";
}