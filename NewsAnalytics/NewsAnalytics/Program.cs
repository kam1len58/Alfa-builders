using Microsoft.EntityFrameworkCore;
using NewsAnalytics.BLL.Ranking;
using NewsAnalytics.BLL.Services;
using NewsAnalytics.BLL.Services.Interfaces;
using NewsAnalytics.DAL.Contracts;
using NewsAnalytics.DAL.Data;
using NewsAnalytics.DAL.Repositories;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite("Data Source=news_analytics.db"));
builder.Services.AddScoped<ICompanyRepository, CompanyRepository>();
builder.Services.AddScoped<INewsRepository, NewsRepository>();
builder.Services.AddScoped<IAlfaAnalyticsRepository, AlfaAnalyticsRepository>();
builder.Services.AddScoped<IPartnerRepository, PartnerRepository>();
builder.Services.AddScoped<ICompanyService, CompanyService>();
builder.Services.AddScoped<INewsService, NewsService>();
builder.Services.AddScoped<IFeedService, FeedService>();
builder.Services.AddSingleton<NewsScorer>();
builder.Services.AddScoped<IAlfaAnalyticsService, AlfaAnalyticsService>();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;

    try
    {
        var context = services.GetRequiredService<AppDbContext>();

        string jsonPath = Path.Combine(app.Environment.ContentRootPath, "demo_profiles.json");
        string goldenPath = Path.Combine(app.Environment.ContentRootPath, "golden_news.json");

        await DbInitializer.SeedAsync(context, jsonPath);
        await DbInitializer.SeedGoldenNewsAsync(context, goldenPath);
        await DbInitializer.SeedAlfaAnalyticsAsync(context, goldenPath);
    }
    catch (Exception ex)
    {
        var logger = services.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "Ошибка при сидинге базы данных.");
    }

}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.Run();
