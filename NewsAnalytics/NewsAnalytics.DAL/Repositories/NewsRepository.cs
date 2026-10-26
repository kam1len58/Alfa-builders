using Microsoft.EntityFrameworkCore;
using NewsAnalytics.DAL.Contracts;
using NewsAnalytics.DAL.Data;
using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Repositories;

public class NewsRepository(AppDbContext context) : INewsRepository
{
    private readonly AppDbContext _context = context;

    public async Task<List<NewsItem>> GetAllNewsAsync() => await _context.News.ToListAsync();

    public async Task<List<NewsItem>> GetNewsByCategoryAsync(string category) =>
        await _context.News
        .Where(n => EF.Functions.Like(n.Category, $"%{category}%"))
        .ToListAsync();

    public async Task<NewsItem?> GetNewsByIdAsync(string id) => await _context.News.FirstOrDefaultAsync(n => n.Id == id);
}
