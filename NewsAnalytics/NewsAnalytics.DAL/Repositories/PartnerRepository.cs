using Microsoft.EntityFrameworkCore;
using NewsAnalytics.DAL.Contracts;
using NewsAnalytics.DAL.Data;
using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Repositories;

public class PartnerRepository(AppDbContext context) : IPartnerRepository
{
    private readonly AppDbContext _context = context;

    public async Task<List<PartnerItem>> GetAllPartnerItemsAsync()
    {
        var suppliers = await _context.Companies
            .SelectMany(c => c.Counterparties.TopSuppliers)
            .ToListAsync();

        var customers = await _context.Companies
            .SelectMany(c => c.Counterparties.TopCustomers)
            .ToListAsync();

        return suppliers.Concat(customers).DistinctBy(p => p.Id).ToList();
    }

    public async Task<PartnerItem?> GetPartnerItemByIdAsync(string id)
    {
        var partner = await _context.Companies
            .SelectMany(c => c.Counterparties.TopSuppliers)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (partner != null) return partner;

        return await _context.Companies
            .SelectMany(c => c.Counterparties.TopCustomers)
            .FirstOrDefaultAsync(p => p.Id == id);
    }

    public async Task<List<PartnerItem>> GetPartnersByOkvedAsync(string okvedCode)
    {
        var suppliers = await _context.Companies
            .SelectMany(c => c.Counterparties.TopSuppliers)
            .Where(p => p.OkvedCode == okvedCode)
            .ToListAsync();

        var customers = await _context.Companies
            .SelectMany(c => c.Counterparties.TopCustomers)
            .Where(p => p.OkvedCode == okvedCode)
            .ToListAsync();

        return suppliers.Concat(customers).DistinctBy(p => p.Id).ToList();
    }

    public async Task<List<PartnerItem>> GetPartnersByRegionAsync(string region)
    {
        var suppliers = await _context.Companies
            .SelectMany(c => c.Counterparties.TopSuppliers)
            .Where(p => p.Region != null && EF.Functions.Like(p.Region, $"%{region}%"))
            .ToListAsync();

        var customers = await _context.Companies
            .SelectMany(c => c.Counterparties.TopCustomers)
            .Where(p => p.Region != null && EF.Functions.Like(p.Region, $"%{region}%"))
            .ToListAsync();

        return suppliers.Concat(customers).DistinctBy(p => p.Id).ToList();
    }
}