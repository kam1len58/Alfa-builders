using Microsoft.EntityFrameworkCore;
using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Data;

public class AppDbContext : DbContext
{
    public DbSet<CompanyProfile> Companies { get; set; } = null!;
    public DbSet<NewsItem> News { get; set; } = null!;
    public DbSet<AlfaAnalyticsItem> AlfaAnalytics { get; set; } = null!;

    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<CompanyProfile>().HasKey(c => c.SyntheticU);
        modelBuilder.Entity<NewsItem>().HasKey(n => n.Id);
        modelBuilder.Entity<AlfaAnalyticsItem>().HasKey(a => a.Id);

        modelBuilder.Entity<CompanyProfile>().OwnsOne(c => c.BankProducts, b => b.ToJson());
        modelBuilder.Entity<CompanyProfile>().OwnsOne(c => c.Ved, b => b.ToJson());
        modelBuilder.Entity<CompanyProfile>().OwnsOne(c => c.IndustryPosition, b => b.ToJson());
        modelBuilder.Entity<CompanyProfile>().OwnsOne(c => c.Affiliation, b => b.ToJson());
        modelBuilder.Entity<CompanyProfile>().OwnsOne(c => c.Counterparties, b =>
        {
            b.ToJson();
            b.OwnsMany(x => x.TopSuppliers);
            b.OwnsMany(x => x.TopCustomers);
        });
    }
}
