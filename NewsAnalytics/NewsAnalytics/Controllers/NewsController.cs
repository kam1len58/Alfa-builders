using Microsoft.AspNetCore.Mvc;
using NewsAnalytics.BLL.Services.Interfaces;
using NewsAnalytics.Models;

namespace NewsAnalytics.API.Controllers;


[ApiController]
[Route("api/[controller]")]
public class NewsController(INewsService newsService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<NewsItem>>> GetAll(CancellationToken cancellationToken)
    {
        return Ok(await newsService.GetAllAsync(cancellationToken));
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<NewsItem>> GetById(string id, CancellationToken cancellationToken)
    {
        var item = await newsService.GetByIdAsync(id, cancellationToken);
        return item is null ? NotFound() : Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> Add([FromBody] List<NewsItem> news, CancellationToken cancellationToken)
    {
        await newsService.AddRangeAsync(news, cancellationToken);
        return NoContent();
    }
}
