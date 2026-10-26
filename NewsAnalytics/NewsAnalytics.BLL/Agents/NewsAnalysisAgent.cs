using NewsAnalytics.BLL.Dto;
using NewsAnalytics.BLL.Ranking;
using NewsAnalytics.BLL.Services;
using NewsAnalytics.BLL.Services.Interfaces;
using NewsAnalytics.Models;
using System.Text.Json;

namespace NewsAnalytics.BLL.Agents;

public class NewsAnalysisAgent
{
    private readonly ICompanyService _companyService;
    private readonly INewsService _newsService;
    private readonly IAlfaAnalyticsService _analyticsService;
    private readonly NewsScorer _scorer;
    private readonly NewsClassifier _classifier;
    private readonly ILlmService _llmService;

    public NewsAnalysisAgent(
        ICompanyService companyService,
        INewsService newsService,
        IAlfaAnalyticsService analyticsService,
        NewsScorer scorer,
        NewsClassifier classifier,
        ILlmService llmService)
    {
        _companyService = companyService;
        _newsService = newsService;
        _analyticsService = analyticsService;
        _scorer = scorer;
        _classifier = classifier;
        _llmService = llmService;
    }

    public async Task<NewsInterpretationDto> AnalyzeAsync(
        string companyId,
        string newsId,
        CancellationToken ct = default)
    {
        var analysisLog = new List<string>();

        analysisLog.Add("Шаг 1: Загрузка профиля компании и новости");
        var company = await _companyService.GetByIdAsync(companyId, ct);
        var news = await _newsService.GetByIdAsync(newsId, ct);

        if (company == null || news == null)
            throw new InvalidOperationException($"Компания {companyId} или новость {newsId} не найдены");

        analysisLog.Add("Шаг 2: Автоматическая классификация новости");
        var matchedRules = _classifier.Classify(news, company);
        analysisLog.Add($"  Найдено правил: {matchedRules.Count}");

        analysisLog.Add("Шаг 3: Скоринг релевантности");
        var scoreResult = _scorer.Score(company, news);
        analysisLog.Add($"  Score: {scoreResult.Score}, Tier: {scoreResult.Tier}");

        analysisLog.Add("Шаг 4: Загрузка позиции Альфа-Банка");
        var analytics = await _analyticsService.GetAllAsync(ct);
        var bankStance = analytics
            .FirstOrDefault(a => a.Id == "A_" + newsId)?.ExpertStance ?? "Позиция банка не найдена";

        analysisLog.Add("Шаг 5: Генерация персонального разбора");
        var interpretation = await BuildInterpretationWithLlm(
            company, news, scoreResult, matchedRules, bankStance, analysisLog, ct);

        analysisLog.Add("Шаг 6: Самопроверка полноты разбора");
        ValidateInterpretation(interpretation, analysisLog);

        return interpretation with { AnalysisSteps = string.Join("\n", analysisLog) };
    }

    private async Task<NewsInterpretationDto> BuildInterpretationWithLlm(
        CompanyProfile company,
        NewsItem news,
        ScoredNewsDto scoreResult,
        List<string> matchedRules,
        string bankStance,
        List<string> analysisLog,
        CancellationToken ct)
    {
        var systemPrompt = @"Ты — AI-аналитик Альфа-Банка для крупного бизнеса. 
Твоя задача — дать персонализированную интерпретацию новости с учётом профиля компании.

КРИТИЧЕСКИ ВАЖНО:
1. Отвечай СТРОГО валидным JSON. Никаких markdown-обёрток, никаких ```json ... ```, никаких комментариев вне JSON.
2. НЕ ОБРЫВАЙ ОТВЕТ. Завершай все строки кавычками, все массивы скобками ].
3. Если не успеваешь завершить — лучше сократи текст, но заверши JSON корректно.";


        var userMessage = $@"
Профиль компании:
- Отрасль: {company.Industry}
- ОКВЭД: {company.OkvedCode}
- Регион: {company.Region}
- Выручка: {company.Revenue:N0} руб.
- ВЭД: {(company.Ved.HasVed == 1 ? $"Да, страна: {company.Ved.Country}" : "Нет")}
- Топ-поставщик: {company.Counterparties.TopSupplierShare:P0} от исходящих платежей
- Продукты банка: РКО={(company.BankProducts.HasRko == 1 ? "Да" : "Нет")}, 
  Кредиты={(company.BankProducts.HasLoans == 1 ? "Да" : "Нет")}, 
  Гарантии={(company.BankProducts.HasGuarantees == 1 ? "Да" : "Нет")}

Новость:
{news.Content}

Сработавшие правила: {string.Join(", ", matchedRules)}

Позиция Альфа-Банка:
{bankStance}

Сформируй JSON с полями:
- whyImportantForCompany: строка, почему это важно именно для этой компании
- risks: массив строк (риски)
- opportunities: массив строк (возможности)
- recommendedActions: массив строк (рекомендуемые действия)
- alfaBankStance: строка, используй предоставленную позицию банка";

        var llmResponse = await _llmService.ChatAsync(systemPrompt, userMessage, ct);

        if (llmResponse.StartsWith("LLM_"))
        {
            analysisLog.Add($"  ⚠ LLM недоступен ({llmResponse}), переключаюсь на rule-based fallback");
            return BuildInterpretationFallback(company, news, scoreResult, matchedRules, bankStance);
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<LlmInterpretationResponse>(llmResponse,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            analysisLog.Add("  ✓ Успешный ответ от LLM");
            return new NewsInterpretationDto
            {
                NewsId = news.Id,
                WhatHappened = news.Content,
                PublishedAt = news.PublishedAt,
                WhyImportantForCompany = parsed?.WhyImportantForCompany ?? "Не удалось сгенерировать",
                CompanyContext = $"Отрасль: {company.Industry}, ОКВЭД: {company.OkvedCode}, Регион: {company.Region}",
                Risks = parsed?.Risks ?? new List<string>(),
                Opportunities = parsed?.Opportunities ?? new List<string>(),
                RecommendedActions = parsed?.RecommendedActions ?? new List<string>(),
                AlfaBankStance = parsed?.AlfaBankStance ?? bankStance,
                Sources = new List<string> { bankStance },
                TriggeredRules = scoreResult.Hits.ToList(),
                RelevanceScore = scoreResult.Score,
                Tier = scoreResult.Tier
            };
        }
        catch (JsonException ex)
        {
            analysisLog.Add($"  ⚠ Ошибка парсинга JSON: {ex.Message}. Пытаюсь восстановить...");

            var fixedJson = TryFixTruncatedJson(llmResponse);
            if (fixedJson != null)
            {
                try
                {
                    var parsed = JsonSerializer.Deserialize<LlmInterpretationResponse>(fixedJson,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    analysisLog.Add("  ✓ JSON восстановлен после обрезания");
                    return new NewsInterpretationDto
                    {
                        NewsId = news.Id,
                        WhatHappened = news.Content,
                        PublishedAt = news.PublishedAt,
                        WhyImportantForCompany = parsed?.WhyImportantForCompany ?? "Не удалось сгенерировать",
                        CompanyContext = $"Отрасль: {company.Industry}, ОКВЭД: {company.OkvedCode}, Регион: {company.Region}",
                        Risks = parsed?.Risks ?? new List<string>(),
                        Opportunities = parsed?.Opportunities ?? new List<string>(),
                        RecommendedActions = parsed?.RecommendedActions ?? new List<string>(),
                        AlfaBankStance = parsed?.AlfaBankStance ?? bankStance,
                        Sources = new List<string> { bankStance },
                        TriggeredRules = scoreResult.Hits.ToList(),
                        RelevanceScore = scoreResult.Score,
                        Tier = scoreResult.Tier
                    };
                }
                catch
                {
                    analysisLog.Add("  ⚠ Восстановление JSON не удалось, переключаюсь на fallback");
                }
            }

            return BuildInterpretationFallback(company, news, scoreResult, matchedRules, bankStance);
        }
    }

    private static string? TryFixTruncatedJson(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        json = json.Trim();
        if (json.StartsWith("```json"))
            json = json[7..];
        if (json.EndsWith("```"))
            json = json[..^3];
        json = json.Trim();

        int openBraces = 0, openBrackets = 0;
        bool inString = false;
        bool escaped = false;

        for (int i = 0; i < json.Length; i++)
        {
            char c = json[i];
            if (escaped) { escaped = false; continue; }
            if (c == '\\') { escaped = true; continue; }
            if (c == '"') { inString = !inString; continue; }
            if (!inString)
            {
                if (c == '{') openBraces++;
                else if (c == '}') openBraces--;
                else if (c == '[') openBrackets++;
                else if (c == ']') openBrackets--;
            }
        }

        if (inString)
            json += "\"";

        while (openBrackets > 0)
        {
            json += "]";
            openBrackets--;
        }

        while (openBraces > 0)
        {
            json += "}";
            openBraces--;
        }

        return json;
    }

    private NewsInterpretationDto BuildInterpretationFallback(
        CompanyProfile company, NewsItem news, ScoredNewsDto scoreResult,
        List<string> matchedRules, string bankStance)
    {
        var whyImportantParts = new List<string>();
        var risks = new List<string>();
        var opportunities = new List<string>();
        var actions = new List<string>();

        if (matchedRules.Contains("INFL_COSTS"))
        {
            whyImportantParts.Add("Инфляция напрямую влияет на операционные расходы компании.");
            risks.Add("Рост себестоимости и давление на маржинальность.");
            opportunities.Add("Возможность пересмотреть цены и условия договоров с поставщиками.");
            actions.Add("Пересчитать бюджет и маржинальность в нескольких сценариях.");
        }
        if (matchedRules.Contains("PMI_ORDERS"))
        {
            whyImportantParts.Add("Снижение деловой активности в отрасли может уменьшить спрос на продукцию.");
            risks.Add("Снижение заказов, загрузки мощностей и выручки.");
            opportunities.Add("Поиск клиентов в более устойчивых сегмents рынка.");
            actions.Add("Проверить динамику заказов и обновить прогноз продаж.");
        }
        if (matchedRules.Contains("SANCTIONS") || matchedRules.Contains("CUSTOMS"))
        {
            whyImportantParts.Add($"Компания с ВЭД (страна: {company.Ved.Country}) подвержена санкционным и таможенным рискам.");
            risks.Add("Риски перебоев в поставках, расчетах и рост логистических издержек.");
            opportunities.Add("Переориентация на альтернативные рынки и поставщиков.");
            actions.Add("Провести проверку контрагентов и обновить комплаенс-процедуры.");
        }
        if (matchedRules.Contains("FUEL"))
        {
            whyImportantParts.Add("Топливные расходы являются значимой статьёй для отрасли компании.");
            risks.Add("Рост затрат на топливо и логистику.");
            opportunities.Add("Хеджирование топливных рисков и оптимизация логистики.");
            actions.Add("Оценить долю топлива в себестоимости и сравнить предложения поставщиков.");
        }
        if (matchedRules.Contains("SUPPLIER_CONCENTRATION"))
        {
            whyImportantParts.Add($"Высокая концентрация поставщиков (топ-1: {company.Counterparties.TopSupplierShare:P0}) усиливает операционные риски.");
            risks.Add("Зависимость от ключевых контрагентов, риск сбоев в цепочке поставок.");
            opportunities.Add("Диверсификация базы поставщиков.");
            actions.Add("Проверить условия договоров с ключевыми поставщиками на наличие форс-мажоров.");
        }

        if (whyImportantParts.Count == 0)
        {
            whyImportantParts.Add("Новость может влиять на общий макроэкономический контекст компании.");
            actions.Add("Мониторить ситуацию и оценить влияние на бизнес-планы.");
        }

        return new NewsInterpretationDto
        {
            NewsId = news.Id,
            WhatHappened = news.Content,
            PublishedAt = news.PublishedAt,
            WhyImportantForCompany = string.Join(" ", whyImportantParts),
            CompanyContext = $"Отрасль: {company.Industry}, ОКВЭД: {company.OkvedCode}, Регион: {company.Region}",
            Risks = risks,
            Opportunities = opportunities,
            RecommendedActions = actions,
            AlfaBankStance = bankStance,
            Sources = new List<string> { bankStance },
            TriggeredRules = scoreResult.Hits.ToList(),
            RelevanceScore = scoreResult.Score,
            Tier = scoreResult.Tier
        };
    }

    private void ValidateInterpretation(NewsInterpretationDto interpretation, List<string> log)
    {
        var issues = new List<string>();

        if (string.IsNullOrEmpty(interpretation.WhyImportantForCompany))
            issues.Add("Не сформировано объяснение важности");

        if (interpretation.Risks.Count == 0 && interpretation.Opportunities.Count == 0)
            issues.Add("Не выявлены риски и возможности");

        if (interpretation.RecommendedActions.Count == 0)
            issues.Add("Не предложены действия");

        if (issues.Count > 0)
        {
            log.Add($"  ⚠ Найдено проблем: {issues.Count}");
            foreach (var issue in issues)
                log.Add($"    - {issue}");
        }
        else
        {
            log.Add("  ✓ Разбор полный и непротиворечивый");
        }
    }
}

internal class LlmInterpretationResponse
{
    [System.Text.Json.Serialization.JsonPropertyName("whyImportantForCompany")]
    public string? WhyImportantForCompany { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("risks")]
    public List<string>? Risks { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("opportunities")]
    public List<string>? Opportunities { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("recommendedActions")]
    public List<string>? RecommendedActions { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("alfaBankStance")]
    public string? AlfaBankStance { get; set; }
}