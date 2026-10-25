const scalar = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
function partnerContext(partners = []) {
  return Object.fromEntries(
    partners.slice(0, 3).map((p, i) => [
      'partner' + (i + 1),
      {
        industry: p.okvedName || null,
        okved: p.okvedCode || null,
        region: p.region || null,
        paymentShare: scalar(p.share),
        sameGroup: typeof p.inSameGroup === 'boolean' ? p.inSameGroup : null,
        note: 'Направление платежей, не подтверждённая роль поставщика или покупателя.',
      },
    ])
  );
}
export function companyContext(p) {
  const position = p.industryPosition || {},
    group = p.affiliation?.groupContext;
  return {
    id: p.syntheticU,
    industry: p.industry,
    okved: p.okvedCode,
    region: p.region,
    workers: p.workers,
    bankProducts: p.bankProducts,
    ved: p.ved,
    datasetPosition: {
      rank: scalar(position.rankByRevenueInOkved),
      companies: scalar(position.companiesInOkved),
      revenueShare: scalar(position.shareOfOkvedRevenueInDataset),
      note: 'Положение среди компаний датасета с тем же ОКВЭД. Объём реального рынка неизвестен; рыночная доля не вычислена.',
    },
    group: {
      size: scalar(p.affiliation?.groupSize),
      observedCompanies: scalar(group?.companies),
      observedRevenueSum: scalar(group?.revenueSum),
      industries: Object.fromEntries(
        (group?.industries || []).slice(0, 5).map((x, i) => ['industry' + (i + 1), x])
      ),
      note: 'Связь по GROUP_ID. Сумма выручки наблюдаемых участников не консолидирована и может включать внутригрупповой оборот.',
    },
    payments: {
      recipientsCount: scalar(p.counterparties?.suppliersCount),
      sendersCount: scalar(p.counterparties?.customersCount),
      largestRecipientShare: scalar(p.counterparties?.topSupplierShare),
      largestSenderShare: scalar(p.counterparties?.topCustomerShare),
      note: 'Доли от платежей соответствующего направления. Период, назначение и зависимость поставок неизвестны.',
    },
    partners: {
      outgoing: partnerContext(p.counterparties?.topSuppliers),
      incoming: partnerContext(p.counterparties?.topCustomers),
    },
  };
}
