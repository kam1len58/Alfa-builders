using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Contracts;

public interface ICompanyRepository
{
    Task<List<CompanyProfile>> GetAllCompaniesAsync();
    Task<CompanyProfile?> GetCompanyByIdAsync(string syntheticU);
    Task<List<CompanyProfile>> GetCompaniesByIndustriesAsync(string industry);
}
