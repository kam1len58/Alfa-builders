namespace NewsAnalytics.Models;

public class NewsItem
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string PublishedAt { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public List<string> Tags { get; set; } = new();
    public List<string> OkvedSections { get; set; } = new();
    public string WhyImportant { get; set; } = string.Empty;
    public string Consequences { get; set; } = string.Empty;
    public string Actions { get; set; } = string.Empty;
    public string Sources { get; set; } = string.Empty;
    public string AlfaView { get; set; } = string.Empty;
}