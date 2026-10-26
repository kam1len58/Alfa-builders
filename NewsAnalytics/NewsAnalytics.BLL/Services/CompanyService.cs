using Microsoft.EntityFrameworkCore;
using NewsAnalytics.BLL.Dto;
using NewsAnalytics.BLL.Services.Interfaces;
using NewsAnalytics.DAL.Data;
using NewsAnalytics.Models;

namespace NewsAnalytics.BLL.Services;

public class CompanyService(AppDbContext context) : ICompanyService
{
    public async Task<IReadOnlyList<CompanyListItemDto>> GetAllAsync(CancellationToken ct = default)
    {
        return await context.Companies
            .AsNoTracking()
            .Select(c => new CompanyListItemDto(
                c.SyntheticU,
                c.Industry,
                c.OkvedCode,
                c.Revenue,
                c.Region,
                c.City,
                c.ClientType,
                c.DemoScenario))
            .ToListAsync(ct);
    }

    public async Task<CompanyProfile?> GetByIdAsync(string syntheticU, CancellationToken ct = default)
    {
        return await context.Companies
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.SyntheticU == syntheticU);
    }
}
