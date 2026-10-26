namespace NewsAnalytics.Models;

public record NewsInterpretationResult
{
    public string WhatHappened { get; set; } = string.Empty;
    public string WhyImportant { get; set; } = string.Empty;
    public string RisksAndOpportunities { get; set; } = string.Empty;
    public string RecommendedActions { get; set; } = string.Empty;
    public string AlfaBankExpertise { get; set; } = string.Empty;
    public List<string> SourcesTrace { get; set; } = new();
}

