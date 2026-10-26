using Microsoft.AspNetCore.Mvc;
using NewsAnalytics.BLL.Agents;
using NewsAnalytics.BLL.Dto;

namespace NewsAnalytics.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NewsInterpretationController : ControllerBase
{
    private readonly NewsAnalysisAgent _agent;

    public NewsInterpretationController(NewsAnalysisAgent agent)
    {
        _agent = agent;
    }

    [HttpGet("{companyId}/news/{newsId}")]
    public async Task<ActionResult<NewsInterpretationDto>> GetInterpretation(
        string companyId,
        string newsId,
        CancellationToken ct)
    {
        try
        {
            var interpretation = await _agent.AnalyzeAsync(companyId, newsId, ct);
            return Ok(interpretation);
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }
}