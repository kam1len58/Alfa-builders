using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Services.Interfaces;

public interface IAlfaAnalyticsService
{
    Task<IReadOnlyList<AlfaAnalyticsItem>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<AlfaAnalyticsItem?> GetByIdAsync(string id, CancellationToken cancellationToken = default);
}
