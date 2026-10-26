using Microsoft.EntityFrameworkCore;
using NewsAnalytics.DAL.Data.Dto;
using NewsAnalytics.Models;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NewsAnalytics.DAL.Data;

public static class DbInitializer
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    public static async Task SeedAsync(AppDbContext context, string jsonFilePath)
    {
        await context.Database.EnsureCreatedAsync();

        if (await context.Companies.AnyAsync())
            return;

        if (!File.Exists(jsonFilePath))
            return;

        await using var stream = File.OpenRead(jsonFilePath);
        var companies = await JsonSerializer.DeserializeAsync<List<CompanyProfile>>(stream, JsonOptions);

        if (companies is { Count: > 0 })
            await context.Companies.AddRangeAsync(companies);

        await context.SaveChangesAsync();
    }

    public static async Task SeedGoldenNewsAsync(AppDbContext context, string goldenFilePath)
    {
        if (await context.News.AnyAsync() || !File.Exists(goldenFilePath))
            return;
        await using var stream = File.OpenRead(goldenFilePath);
        var golden = await JsonSerializer.DeserializeAsync<GoldenFileDto>(stream, JsonOptions);
        if (golden is null || golden.News.Count == 0)
            return;
        var items = golden.News.Select(g => new NewsItem
        {
            Id = g.Id,
            Title = MakeTitle(g.WhatHappened),
            Content = g.WhatHappened,
            Source = "golden",
            PublishedAt = ParseDate(g.Date),
            Category = "golden",
            Tags = g.MatchedRules,
            WhyImportant = g.WhyImportant ?? "",
            Consequences = g.Consequences ?? "",
            Actions = g.Actions ?? "",
            Sources = g.Sources ?? "",
            AlfaView = g.AlfaView ?? ""
        });
        await context.News.AddRangeAsync(items);
        await context.SaveChangesAsync();
    }

    public static async Task SeedAlfaAnalyticsAsync(AppDbContext context, string goldenFilePath)
    {
        if (await context.AlfaAnalytics.AnyAsync() || !File.Exists(goldenFilePath))
            return;

        await using var stream = File.OpenRead(goldenFilePath);
        var golden = await JsonSerializer.DeserializeAsync<GoldenFileDto>(stream, JsonOptions);

        if (golden?.News is { Count: > 0 })
        {
            var analyticsItems = golden.News
                .Where(g => !string.IsNullOrEmpty(g.AlfaView))
                .Select(g => new AlfaAnalyticsItem
                {
                    Id = "A_" + g.Id,
                    Title = MakeTitle(g.WhatHappened),
                    Summary = g.WhatHappened,
                    ExpertStance = g.AlfaView!
                });

            await context.AlfaAnalytics.AddRangeAsync(analyticsItems);
            await context.SaveChangesAsync();
        }
    }

    private static string MakeTitle(string whatHappened)
    {
        var index = whatHappened.IndexOf(": ", StringComparison.Ordinal);
        var text = index >= 0 ? whatHappened[(index + 2)..] : whatHappened;
        return text.Length <= 120 ? text : text[..120].TrimEnd() + "…";
    }

    private static readonly Dictionary<string, int> Months = new()
    {
        ["января"] = 1,
        ["февраля"] = 2,
        ["марта"] = 3,
        ["апреля"] = 4,
        ["мая"] = 5,
        ["июня"] = 6,
        ["июля"] = 7,
        ["августа"] = 8,
        ["сентября"] = 9,
        ["октября"] = 10,
        ["ноября"] = 11,
        ["декабря"] = 12
    };

    private static string ParseDate(string text)
    {
        var m = Regex.Match(text, @"(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s+(\p{L}+)\s+(\d{4})");
        if (!m.Success || !Months.TryGetValue(m.Groups[3].Value.ToLowerInvariant(), out var month))
            return text;

        var day = int.Parse(m.Groups[2].Success ? m.Groups[2].Value : m.Groups[1].Value);
        var date = new DateOnly(int.Parse(m.Groups[4].Value), month, day);
        return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }
}