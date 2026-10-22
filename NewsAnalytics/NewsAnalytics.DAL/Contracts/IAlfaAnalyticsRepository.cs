using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Contracts;

public interface IAlfaAnalyticsRepository
{
    Task<List<AlfaAnalyticsItem>> GetAllAnalyticsItemsAsync();
    Task<AlfaAnalyticsItem?> GetAnalyticsByIdAsync(string id);
    Task<List<AlfaAnalyticsItem>> SearchAnalyticsAsync(string query);
}
