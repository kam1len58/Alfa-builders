using System.Text.Json.Serialization;

namespace NewsAnalytics.BLL.Dto;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum FeedTierDto
{
    Hidden,
    All,
    Focus
}
