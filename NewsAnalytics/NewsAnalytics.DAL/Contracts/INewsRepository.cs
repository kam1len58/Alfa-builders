using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Contracts;

public interface INewsRepository
{
    Task<List<NewsItem>> GetAllNewsAsync();
    Task<NewsItem?> GetNewsByIdAsync(string id);
    Task<List<NewsItem>> GetNewsByCategoryAsync(string category);
}
