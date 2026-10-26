using NewsAnalytics.BLL.Dto;

namespace NewsAnalytics.BLL.Services.Interfaces;

public interface IFeedService
{
    Task<IReadOnlyList<ScoredNewsDto>?> GetFeedAsync(string companyId, CancellationToken ct = default);
}
