namespace NewsAnalytics.DAL.Data.Dto;

public class GoldenNewsDto
{
    public string Id { get; set; } = "";
    public string WhatHappened { get; set; } = "";
    public string Date { get; set; } = "";
    public List<string> MatchedRules { get; set; } = new();
    public string AlfaView { get; set; } = "";
}
