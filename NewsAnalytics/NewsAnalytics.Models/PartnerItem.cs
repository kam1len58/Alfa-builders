namespace NewsAnalytics.Models;

public class PartnerItem
{
    public string Id { get; set; } = string.Empty;
    public string? OkvedCode { get; set; }
    public string? OkvedName { get; set; }
    public string? Region { get; set; }
    public decimal Amount { get; set; }
    public int PaymentsCount { get; set; }
    public double Share { get; set; }
}

