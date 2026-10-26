namespace NewsAnalytics.Models;

public class AffiliationInfo
{
    public string? GroupId { get; set; }
    public List<string> GroupCompanies { get; set; } = new();
    public int GroupSize { get; set; }
    public int LinkedPersonsCount { get; set; }
    public List<string> AffiliatedViaPersons { get; set; } = new();
    public int AffiliatedCount { get; set; }
    public List<string> IntraGroupCounterparties { get; set; } = new();
}