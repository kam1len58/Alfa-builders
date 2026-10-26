using Microsoft.EntityFrameworkCore;
using NewsAnalytics.BLL.Services.Interfaces;
using NewsAnalytics.DAL.Data;
using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Services;

public class NewsService(AppDbContext context) : INewsService
{
    public async Task AddRangeAsync(IEnumerable<NewsItem> news, CancellationToken ct = default)
    {
        var incoming = news
            .GroupBy(n => n.Id)
            .Select(g => g.First())
            .ToList();

        var ids = incoming.Select(n => n.Id).ToList();
        var existing = await context.News
            .Where(n => ids.Contains(n.Id))
            .Select(n => n.Id)
            .ToListAsync(ct);

        var fresh = incoming.Where(n => !existing.Contains(n.Id)).ToList();

        if (fresh.Count == 0)
            return;

        await context.News.AddRangeAsync(fresh, ct);
        await context.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<NewsItem>> GetAllAsync(CancellationToken ct = default)
    {
        return await context.News
            .AsNoTracking()
            .OrderByDescending(n => n.PublishedAt)
            .ToListAsync(ct);
    }

    public async Task<NewsItem?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        return await context.News
            .AsNoTracking()
            .FirstOrDefaultAsync(n => n.Id == id, ct);
    }
}
