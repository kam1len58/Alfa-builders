'use strict';

window.NewsTools = (() => {
  const feedbackLabels = { useful: 'Полезно', irrelevant: 'Не подходит', error: 'Есть ошибка' };

  function eventCount(count) {
    const last = count % 10;
    const teen = count % 100 >= 11 && count % 100 <= 14;
    return `${count} ${teen ? 'событий' : last === 1 ? 'событие' : last >= 2 && last <= 4 ? 'события' : 'событий'}`;
  }

  function matches(event, assignment, filters) {
    if (filters.from && filters.to && filters.from > filters.to) return false;
    if (filters.from && (!event.isoDate || event.isoDate < filters.from)) return false;
    if (filters.to && (!event.isoDate || event.isoDate > filters.to)) return false;
    if (filters.topic && event.category !== filters.topic) return false;
    return !filters.product || assignment.products.includes(filters.product);
  }

  function evidence(profile, rules) {
    return rules.map((rule) => {
      let value;
      let label;
      switch (rule) {
        case 'SANCTIONS':
        case 'CUSTOMS':
          label = 'Внешнеэкономическая деятельность';
          value = `Признак ВЭД: ${profile.ved.has_ved ? 'есть' : 'нет'}. Страны ФТС: ${profile.ved.country || 'не указаны'}.`;
          break;
        case 'PMI_ORDERS':
        case 'FUEL':
        case 'OIL':
          label = 'Отрасль компании';
          value = `${profile.industry}. ОКВЭД ${profile.okved_code}.`;
          break;
        case 'SUPPLIER_CONCENTRATION':
          label = 'Концентрация платежей';
          value = `Крупнейший получатель: ${new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 2 }).format(profile.counterparties.top_supplier_share)} исходящих платежей. Это не доля закупок.`;
          break;
        case 'GOV_PROCUREMENT':
          label = 'Банковские гарантии';
          value = `Продуктовый признак: ${profile.bank_products.has_guarantees ? 'есть' : 'нет'}. Участие в госзаказе этим не подтверждается.`;
          break;
        case 'INFL_COSTS':
          label = 'Общий экономический фактор';
          value =
            'Правило относится ко всем компаниям. Величина ФОТ и условия индексации контрактов в профиле не переданы.';
          break;
        default:
          label = rule;
          value = 'Сервис передал правило без описания использованного признака.';
      }
      return { rule, label, value };
    });
  }

  function exportRows(items, company, feedback) {
    return items.map((event) => {
      const a = event.assignments[company.id];
      const f = feedback[`${company.id}:${event.id}`];
      return {
        companyId: company.id,
        company: company.name,
        newsId: event.id,
        title: event.title,
        date: event.isoDate || null,
        topic: event.category,
        text: event.rawText,
        score: a.score,
        tier: a.placement,
        explanation: a.explanation,
        rules: a.rules,
        suggestedProducts: a.products,
        source: event.source,
        sourceUrl: event.sourceUrl,
        analysisSummary: event.insight?.analysis.summary.text || null,
        personalizedInterpretation: event.insight?.analysis.whyImportant.text || null,
        analysisSources: event.insight?.sources || null,
        risksAndOpportunities: event.insight
          ? {
              risks: event.insight.analysis.risks,
              opportunities: event.insight.analysis.opportunities,
            }
          : null,
        recommendedActions: event.insight?.analysis.actions || null,
        bankPosition:
          event.insight?.bankView.status === 'available' ? event.insight.bankView : null,
        analysisModel: event.insight?.model || null,
        analysisGeneratedAt: event.insight?.generatedAt || null,
        feedback: f
          ? { rating: feedbackLabels[f.rating], comment: f.comment, updatedAt: f.updatedAt }
          : null,
      };
    });
  }

  function csv(rows) {
    const columns = {
      companyId: 'ID компании',
      company: 'Компания',
      newsId: 'ID новости',
      title: 'Заголовок',
      date: 'Дата',
      topic: 'Тема',
      text: 'Текст',
      score: 'Релевантность',
      tier: 'Раздел',
      explanation: 'Причины отбора',
      rules: 'Правила',
      suggestedProducts: 'Продукты для обсуждения',
      source: 'Источник',
      sourceUrl: 'Ссылка',
      analysisSummary: 'Краткий разбор модели',
      personalizedInterpretation: 'Персональный вывод модели',
      analysisSources: 'Основания разбора',
      risksAndOpportunities: 'Риски и возможности',
      recommendedActions: 'Действия',
      bankPosition: 'Позиция банка',
      feedback: 'Обратная связь',
      analysisModel: 'Модель анализа',
      analysisGeneratedAt: 'Дата анализа',
    };
    const cell = (value) => {
      let text =
        value == null
          ? ''
          : Array.isArray(value)
            ? value.join('; ')
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
      // Кавычки CSV сами по себе не защищают Excel от формул в недоверенном тексте.
      if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return (
      '\uFEFF' +
      [Object.values(columns), ...rows.map((row) => Object.keys(columns).map((key) => row[key]))]
        .map((row) => row.map(cell).join(';'))
        .join('\r\n')
    );
  }

  return { matches, evidence, exportRows, csv, feedbackLabels, eventCount };
})();
