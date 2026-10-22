namespace NewsAnalytics.Models;

public class CompanyProfile
{
    public string SyntheticU { get; set; } = string.Empty;
    public string Industry { get; set; } = string.Empty;
    public string OkvedCode { get; set; } = string.Empty;
    public decimal Revenue { get; set; }
    public bool IsLargeBusiness { get; set; }
    public string Region { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string ClientType { get; set; } = string.Empty;
    public string OrgType { get; set; } = string.Empty;
    public string Ownership { get; set; } = string.Empty;
    public string CompanyAge { get; set; } = string.Empty;
    public string EcoStage { get; set; } = string.Empty;
    public string Workers { get; set; } = string.Empty;
    public int NegativeOwnerMark { get; set; }
    public string DemoScenario { get; set; } = string.Empty;

    public BankProducts BankProducts { get; set; } = new();
    public Ved Ved { get; set; } = new();
    public IndustryPosition IndustryPosition { get; set; } = new();
    public CounterpartyInfo Counterparties { get; set; } = new();
    public AffiliationInfo Affiliation { get; set; } = new();
}