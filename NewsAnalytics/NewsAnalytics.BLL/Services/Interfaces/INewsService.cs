using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Services.Interfaces;

public interface INewsService
{
    Task<IReadOnlyList<NewsItem>> GetAllAsync(CancellationToken ct = default);
    Task<NewsItem?> GetByIdAsync(string id, CancellationToken ct = default);
    Task AddRangeAsync(IEnumerable<NewsItem> news, CancellationToken ct = default);
}
