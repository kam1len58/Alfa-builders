using Microsoft.EntityFrameworkCore;
using NewsAnalytics.DAL.Contracts;
using NewsAnalytics.DAL.Data;
using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Repositories;

public class AlfaAnalyticsRepository(AppDbContext context) : IAlfaAnalyticsRepository
{
    private readonly AppDbContext _context = context;

    public async Task<List<AlfaAnalyticsItem>> GetAllAnalyticsItemsAsync() => await _context.AlfaAnalytics.ToListAsync();

    public async Task<AlfaAnalyticsItem?> GetAnalyticsByIdAsync(string id) => await _context.AlfaAnalytics.FirstOrDefaultAsync(a => a.Id == id);

    public async Task<List<AlfaAnalyticsItem>> SearchAnalyticsAsync(string query) =>
        await _context.AlfaAnalytics
        .Where(a => EF.Functions.Like(a.Title, $"%{query}") ||
                    EF.Functions.Like(a.Summary, $"%{query}") ||
                    EF.Functions.Like(a.ExpertStance, $"%{query}"))
        .ToListAsync();
}
