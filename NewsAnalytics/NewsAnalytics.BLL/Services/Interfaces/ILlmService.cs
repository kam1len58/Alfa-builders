namespace NewsAnalytics.BLL.Services.Interfaces;

public interface ILlmService
{
    Task<string> ChatAsync(string systemPrompt, string userMessage, CancellationToken ct = default);
}

public record ChatMessage(string Role, string Content);