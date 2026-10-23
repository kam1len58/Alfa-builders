using NewsAnalytics.BLL.Dto;
using NewsAnalytics.BLL.Ranking;
using NewsAnalytics.BLL.Services.Interfaces;
namespace NewsAnalytics.BLL.Services;

public class FeedService(
    ICompanyService companyService,
    INewsService newsService,
    IAlfaAnalyticsService alfaAnalyticsService,
    NewsScorer newsScorer) : IFeedService
{
    public async Task<IReadOnlyList<ScoredNewsDto>?> GetFeedAsync(string companyId, CancellationToken ct = default)
    {
        var company = await companyService.GetByIdAsync(companyId);
        if (company is null)
            return null;

        var news = await newsService.GetAllAsync(ct);
        var analytics = await alfaAnalyticsService.GetAllAsync(ct);

        return newsScorer.Rank(company, news, analytics);
    }
}