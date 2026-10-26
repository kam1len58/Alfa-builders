namespace NewsAnalytics.DAL.Data.Dto;

public class GoldenNewsDto
{
    public string Id { get; set; } = "";
    public string WhatHappened { get; set; } = "";
    public string WhyImportant { get; set; } = "";
    public string Consequences { get; set; } = "";
    public string Actions { get; set; } = "";
    public string Sources { get; set; } = "";
    public string Date { get; set; } = "";
    public List<string> MatchedRules { get; set; } = new();
    public string AlfaView { get; set; } = "";
}