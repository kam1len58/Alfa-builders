using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Data.Dto;

public class RootDataDto
{
    public List<CompanyProfile>? Companies { get; set; }
    public List<PartnerItem>? Partners { get; set; }
    public List<NewsItem>? News { get; set; }
    public List<AlfaAnalyticsItem>? AlfaAnalytics { get; set; }
}
