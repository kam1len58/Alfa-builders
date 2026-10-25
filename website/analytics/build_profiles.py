"""Build company profiles from the three original CSVs; no third-party packages."""
import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

DEMO = ['U_9250', 'U_258064', 'U_258131', 'U_276153']
PRODUCTS = {'hasRko': 'RKO', 'hasLoans': 'LOA', 'hasLeasing': 'LEA',
            'hasDeposit': 'DEP', 'hasPayroll': 'ZPP', 'hasGuarantees': 'GAR'}


def number(value):
    if value is None or str(value).strip().lower() in ('', 'nan', 'null', 'none'):
        return None
    result = float(str(value).replace(',', '.'))
    if not math.isfinite(result):
        raise ValueError('Non-finite numeric field')
    return result


def rows(path):
    # Sources are UTF-8; strict decoding catches damaged input instead of replacing letters.
    with open(path, encoding='utf-8-sig', newline='') as source:
        yield from csv.DictReader(source, delimiter=';')


def fingerprint(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return {'name': Path(path).name, 'sha256': digest.hexdigest()}


class ProfileBuilder:
    def __init__(self, companies, payments, links, selected=None, min_revenue=15e9):
        self.paths = [companies, payments, links]
        self.companies = {}
        self.company_rows = 0
        self.conflicts = 0
        self.quarantined = set()
        for row in rows(companies):
            self.company_rows += 1
            uid = row['SYNTHETIC_U'].strip()
            if not uid:
                raise ValueError('Missing company identifier')
            # Merge compatible duplicates; incompatible identifiers are quarantined below.
            if uid in self.companies:
                previous = self.companies[uid]
                for key, value in row.items():
                    if key != 'FTS_COUNTRY_NAME' and value and previous.get(key) and value != previous[key]:
                        self.conflicts += 1
                        self.quarantined.add(uid)
                countries = set(filter(None, (previous.get('FTS_COUNTRY_NAME', '') + ', ' + row.get('FTS_COUNTRY_NAME', '')).split(', ')))
                previous['FTS_COUNTRY_NAME'] = ', '.join(sorted(countries))
                continue
            self.companies[uid] = row
        self.unique_ids = len(self.companies)
        for uid in self.quarantined:
            del self.companies[uid]
        self.selected = set(selected) if selected is not None else {
            uid for uid, row in self.companies.items()
            if (number(row['REVENUE_COMPANY']) or 0) > min_revenue
        }
        missing = self.selected - self.companies.keys()
        if missing:
            raise ValueError('Unknown companies: ' + ', '.join(sorted(missing)))
        self.groups, self.industries = defaultdict(list), defaultdict(list)
        for uid, row in self.companies.items():
            if row['GROUP_ID']:
                self.groups[row['GROUP_ID']].append(uid)
            self.industries[row['MAINOKVED_CODE']].append(uid)
        self.positions = {}
        self.group_context = {}
        for group_id, members in self.groups.items():
            sectors = defaultdict(lambda: {'companies': 0, 'revenueSum': 0.0, 'name': None})
            for member in members:
                company = self.companies[member]
                sector = sectors[company['MAINOKVED_CODE']]
                sector['companies'] += 1
                sector['revenueSum'] += number(company['REVENUE_COMPANY']) or 0
                sector['name'] = company['MAINOKVED_NAME'] or None
            self.group_context[group_id] = {'companies': len(members),
                'revenueSum': sum(s['revenueSum'] for s in sectors.values()),
                'industries': [{'okved': code, **s} for code, s in sorted(sectors.items(), key=lambda item: (-item[1]['revenueSum'], item[0]))[:5]],
                'note': 'Наблюдаемые участники по GROUP_ID, не консолидированная отчётность.'}
        for code, ids in self.industries.items():
            total = sum(number(self.companies[uid]['REVENUE_COMPANY']) or 0 for uid in ids)
            ordered = sorted(ids, key=lambda uid: (-(number(self.companies[uid]['REVENUE_COMPANY']) or 0), uid))
            last_revenue, rank = None, 0
            for index, uid in enumerate(ordered, 1):
                revenue = number(self.companies[uid]['REVENUE_COMPANY'])
                if index == 1 or revenue != last_revenue:
                    rank = index
                last_revenue = revenue
                self.positions[uid] = {'rankByRevenueInOkved': rank if revenue is not None else None, 'companiesInOkved': len(ids),
                    'shareOfOkvedRevenueInDataset': revenue / total if total and revenue is not None else None,
                    'note': 'Доля выручки среди компаний датасета с тем же ОКВЭД; не доля реального рынка.'}
        self.outgoing, self.incoming = defaultdict(dict), defaultdict(dict)
        self.payment_rows = 0
        self.negative_payment_rows = 0
        for row in rows(payments):
            self.payment_rows += 1
            payer, receiver = row['PAYER'], row['BENEFICIARY']
            amount, count = number(row['PAY_AMT']), number(row['PAY_CNT'])
            if amount is None or count is None or count < 0 or amount < 0:
                self.negative_payment_rows += 1
                continue
            for owner, partner, book in [(payer, receiver, self.outgoing), (receiver, payer, self.incoming)]:
                if owner in self.selected:
                    entry = book[owner].setdefault(partner, [0.0, 0])
                    entry[0] += amount
                    entry[1] += int(count)
        self.persons, self.person_companies = defaultdict(set), defaultdict(set)
        self.link_rows = 0
        for row in rows(links):
            self.link_rows += 1
            uid, person = row['SYNTHETIC_U'], row['SYNTHETIC_F']
            if uid and person:
                self.person_companies[person].add(uid)
                self.persons[uid].add(person)

    def profile(self, uid):
        if uid not in self.selected:
            raise ValueError('Request this identifier with --ids to include its payment aggregation')
        row = self.companies[uid]
        group_id = row['GROUP_ID'] or None
        group = set(self.groups.get(group_id, []))
        def partners(book):
            values = book.get(uid, {})
            total = sum(value[0] for value in values.values())
            top = []
            for other, (amount, count) in sorted(values.items(), key=lambda item: (-item[1][0], item[0]))[:3]:
                partner = self.companies.get(other, {})
                top.append({'id': other, 'okvedCode': partner.get('MAINOKVED_CODE'),
                    'okvedName': partner.get('MAINOKVED_NAME'), 'region': partner.get('REGION'),
                    'amount': amount, 'paymentsCount': count, 'share': amount / total if total else 0,
                    'inSameGroup': other in group and other != uid})
            return top, total, len(values)
        outgoing, out_total, out_count = partners(self.outgoing)
        incoming, in_total, in_count = partners(self.incoming)
        affiliates = set().union(*(self.person_companies[p] for p in self.persons[uid])) - {uid}
        out_share = outgoing[0]['share'] if outgoing else None
        in_share = incoming[0]['share'] if incoming else None
        counterparties = {
            'topSuppliers': outgoing, 'topCustomers': incoming,
            'suppliersCount': out_count, 'customersCount': in_count,
            'paymentsOutTotal': out_total, 'paymentsInTotal': in_total,
            'topSupplierShare': out_share, 'topCustomerShare': in_share,
            'supplierConcentrationCritical': out_share > .3 if out_share is not None else None,
            'customerConcentrationCritical': in_share > .3 if in_share is not None else None,
            'partnersOkvedSections': sorted({p['okvedCode'].split('.')[0] for p in outgoing + incoming if p['okvedCode']}),
            'note': 'Поставщик/покупатель — условные названия направлений платежей. Назначение и период неизвестны; концентрация платежей не доказывает зависимость поставок.'}
        return {'syntheticU': uid, 'industry': row['MAINOKVED_NAME'], 'okvedCode': row['MAINOKVED_CODE'],
            'revenue': number(row['REVENUE_COMPANY']), 'isLargeBusiness': (number(row['REVENUE_COMPANY']) or 0) > 15e9,
            'region': row['REGION'] or None, 'city': row['CITY'] or None, 'clientType': row['CL_TYPE'] or None,
            'orgType': row['ORG_TYPE'] or None, 'ownership': row['OKFS_NAME'] or None,
            'companyAge': row['COMPANY_AGE_YEARS_GRADATION'] or None, 'ecoStage': row['ECO_MARK_LABEL'] or None,
            'workers': row['AMOUNT_WORKERS_FNS_GRADATION'] or row['AMOUNT_WORKERS_SPARK_GRADATION'] or None,
            'negativeOwnerMark': number(row['NEGATIVEMARK']),
            'bankProducts': {**{key: number(row['CL_PRODUCT_' + col + '_MARK']) for key, col in PRODUCTS.items()},
                             'hasFactoring': number(row['FACTORING_MARK'])},
            'ved': {'hasVed': number(row['FTS_FLAG']), 'country': row['FTS_COUNTRY_NAME'] or None},
            'industryPosition': self.positions[uid], 'counterparties': counterparties,
            'affiliation': {'groupId': group_id, 'groupCompanies': sorted(group - {uid}), 'groupSize': len(group),
                'groupContext': self.group_context.get(group_id),
                'linkedPersonsCount': len(self.persons[uid]), 'affiliatedViaPersons': sorted(affiliates),
                'affiliatedCount': len(affiliates),
                'intraGroupCounterparties': sorted((self.outgoing[uid].keys() | self.incoming[uid].keys()) & (group - {uid}))},
            'demoScenario': 'Профиль из исходных CSV', 'profileOrigin': 'csv',
            'dataNotes': ['Пустой продукт означает отсутствие данных, а не отсутствие продукта.',
                          'ФТС не различает импорт и экспорт.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['companies', 'payments', 'links']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--output', required=True, help='JSON path outside the repository')
    parser.add_argument('--ids', nargs='+', help='Select arbitrary identifiers instead of the revenue threshold')
    parser.add_argument('--min-revenue', type=float, default=15e9)
    args = parser.parse_args()
    builder = ProfileBuilder(args.companies, args.payments, args.links, args.ids, args.min_revenue)
    ordered = sorted(builder.selected, key=lambda uid: (uid not in DEMO, DEMO.index(uid) if uid in DEMO else 0,
        -(number(builder.companies[uid]['REVENUE_COMPANY']) or 0), uid))
    result = {'schemaVersion': 1, 'builtAt': datetime.now(timezone.utc).isoformat(),
        'sources': [fingerprint(path) for path in builder.paths],
        'stats': {'companyRows': builder.company_rows, 'uniqueCompanies': builder.unique_ids,
            'usableCompanies': len(builder.companies), 'quarantinedIds': sorted(builder.quarantined),
            'duplicateRows': builder.company_rows - builder.unique_ids, 'paymentRows': builder.payment_rows,
            'invalidPaymentRows': builder.negative_payment_rows, 'linkRows': builder.link_rows,
            'profiles': len(ordered), 'minRevenue': args.min_revenue, 'selectedIds': args.ids},
        'profiles': [builder.profile(uid) for uid in ordered]}
    output = Path(args.output).resolve()
    project = Path(__file__).resolve().parents[1]
    if output == project or project in output.parents:
        raise ValueError('Keep generated profiles outside the project repository')
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    temporary.replace(output)
    print(json.dumps(result['stats']))


if __name__ == '__main__':
    main()
