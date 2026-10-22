using Microsoft.EntityFrameworkCore;
using NewsAnalytics.BLL.Services.Interfaces;
using NewsAnalytics.DAL.Data;
using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Services;

public class AlfaAnalyticsService(AppDbContext context) : IAlfaAnalyticsService
{
    public async Task<IReadOnlyList<AlfaAnalyticsItem>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        return await context.AlfaAnalytics.ToListAsync(cancellationToken);
    }

    public async Task<AlfaAnalyticsItem?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        return await context.AlfaAnalytics.FindAsync([id], cancellationToken);
    }
}
