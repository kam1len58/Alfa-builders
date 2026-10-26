using NewsAnalytics.BLL.Dto;
using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Services.Interfaces;

public interface ICompanyService
{
    Task<IReadOnlyList<CompanyListItemDto>> GetAllAsync(CancellationToken ct = default);
    Task<CompanyProfile?> GetByIdAsync(string id, CancellationToken ct = default);
}
