using Microsoft.AspNetCore.Mvc;
using NewsAnalytics.BLL.Dto;
using NewsAnalytics.BLL.Services.Interfaces;
using NewsAnalytics.Models;

namespace NewsAnalytics.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CompaniesController(ICompanyService companyService, IFeedService feedService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CompanyListItemDto>>> GetAll(CancellationToken ct)
    {
        return Ok(await companyService.GetAllAsync(ct));
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<CompanyProfile>> GetById(string id, CancellationToken ct)
    {
        var company = await companyService.GetByIdAsync(id, ct);
        return company is null ? NotFound() : Ok(company);
    }

    [HttpGet("{id}/feed")]
    public async Task<ActionResult<IReadOnlyList<ScoredNewsDto>>> GetFeed(string id, CancellationToken ct)
    {
        var feed = await feedService.GetFeedAsync(id, ct);
        return feed is null ? NotFound() : Ok(feed);
    }
}