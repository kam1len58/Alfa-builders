using Microsoft.Extensions.Configuration;
using NewsAnalytics.BLL.Services.Interfaces;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace NewsAnalytics.BLL.Services;

public class LlmService : ILlmService
{
    private readonly HttpClient _httpClient;
    private readonly string _model;
    private readonly bool _enabled;

    public LlmService(HttpClient httpClient, IConfiguration configuration)
    {
        var endpoint = configuration["Llm:Endpoint"] ?? "https://changelenge.up.railway.app/v1";
        var apiKey = configuration["Llm:ApiKey"];

        _model = configuration["Llm:Model"] ?? "deepseek/deepseek-v4.1-flash";

        _enabled = !string.IsNullOrEmpty(apiKey);

        _httpClient = httpClient;
        _httpClient.BaseAddress = new Uri(endpoint);
        _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");
    }

    public async Task<string> ChatAsync(string systemPrompt, string userMessage, CancellationToken ct = default)
    {
        if (!_enabled)
            return "LLM_UNAVAILABLE";

        var requestBody = new
        {
            model = _model,
            messages = new[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user", content = userMessage }
            },

            temperature = 0.3,
            max_tokens = 4096
        };

        try
        {
            var response = await _httpClient.PostAsJsonAsync("chat/completions", requestBody, ct);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(ct);

                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests ||
                    (int)response.StatusCode == 429 ||
                    errorBody.Contains("Budget", StringComparison.OrdinalIgnoreCase) ||
                    errorBody.Contains("limit", StringComparison.OrdinalIgnoreCase) ||
                    errorBody.Contains("quota", StringComparison.OrdinalIgnoreCase))
                {
                    return "LLM_BUDGET_EXCEEDED";
                }

                return $"LLM_ERROR: HTTP {(int)response.StatusCode} - {errorBody}";
            }

            var result = await response.Content.ReadFromJsonAsync<ChatCompletionResponse>(ct);
            return result?.Choices?.FirstOrDefault()?.Message?.Content
                   ?? "LLM_EMPTY_RESPONSE";
        }
        catch (Exception ex)
        {
            return $"LLM_EXCEPTION: {ex.Message}";
        }
    }
}

internal class ChatCompletionResponse
{
    [JsonPropertyName("choices")]
    public List<Choice>? Choices { get; set; }
}

internal class Choice
{
    [JsonPropertyName("message")]
    public ChatMessageDto? Message { get; set; }
}

internal class ChatMessageDto
{
    [JsonPropertyName("content")]
    public string? Content { get; set; }
}