using Microsoft.AspNetCore.Mvc;
using NewsAnalytics.BLL.Services.Interfaces;
using NewsAnalytics.Models;

namespace NewsAnalytics.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NewsAnalytics(IAlfaAnalyticsService analyticsService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AlfaAnalyticsItem>>> GetAll(CancellationToken cancellationToken)
    {
        var items = await analyticsService.GetAllAsync(cancellationToken);
        return Ok(items);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<AlfaAnalyticsItem>> GetById(string id, CancellationToken ct)
    {
        var item = await analyticsService.GetByIdAsync(id, ct);
        return item is null ? NotFound() : Ok(item);
    }
}
