using Microsoft.EntityFrameworkCore;
using NewsAnalytics.DAL.Contracts;
using NewsAnalytics.DAL.Data;
using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Repositories;

public class CompanyRepository(AppDbContext context) : ICompanyRepository
{
    private readonly AppDbContext _context = context;

    public async Task<List<CompanyProfile>> GetAllCompaniesAsync() => await _context.Companies.ToListAsync();

    public async Task<CompanyProfile?> GetCompanyByIdAsync(string syntheticU) => await _context.Companies.FirstOrDefaultAsync(c => c.SyntheticU == syntheticU);

    public async Task<List<CompanyProfile>> GetCompaniesByIndustriesAsync(string industry) =>
        await _context.Companies
        .Where(c => EF.Functions.Like(c.Industry, $"%{industry}%"))
        .ToListAsync();
}


