import csv
import tempfile
import unittest
from pathlib import Path
from build_profiles import ProfileBuilder, number


class ProfilesTest(unittest.TestCase):
    def test_payment_directions_nulls_links_and_conflicting_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # Minimal source rows use the actual CSV schema, not generated JSON.
            columns = ['SYNTHETIC_U', 'GROUP_ID', 'MAINOKVED_CODE', 'MAINOKVED_NAME', 'REVENUE_COMPANY',
                'FTS_COUNTRY_NAME', 'REGION', 'CITY', 'CL_TYPE', 'ORG_TYPE', 'OKFS_NAME',
                'COMPANY_AGE_YEARS_GRADATION', 'ECO_MARK_LABEL', 'AMOUNT_WORKERS_FNS_GRADATION',
                'AMOUNT_WORKERS_SPARK_GRADATION', 'NEGATIVEMARK', 'FTS_FLAG', 'FACTORING_MARK']
            columns += ['CL_PRODUCT_' + p + '_MARK' for p in ['RKO', 'LOA', 'LEA', 'DEP', 'ZPP', 'GAR']]
            def write(name, fields, values):
                path = root / name
                with path.open('w', encoding='utf-8', newline='') as stream:
                    writer = csv.DictWriter(stream, fieldnames=fields, delimiter=';')
                    writer.writeheader()
                    for value in values: writer.writerow({**dict.fromkeys(fields, ''), **value})
                return path
            companies = write('companies.csv', columns, [
                {'SYNTHETIC_U': 'U_1', 'GROUP_ID': 'G', 'MAINOKVED_CODE': '46', 'REVENUE_COMPANY': '20000000000'},
                {'SYNTHETIC_U': 'U_2', 'GROUP_ID': 'G', 'MAINOKVED_CODE': '46', 'REVENUE_COMPANY': '10000000000'},
                {'SYNTHETIC_U': 'U_3', 'MAINOKVED_CODE': '41', 'REVENUE_COMPANY': '100'},
                {'SYNTHETIC_U': 'U_3', 'MAINOKVED_CODE': '62', 'REVENUE_COMPANY': '200'}])
            payments = write('payments.csv', ['PAYER','BENEFICIARY','PAY_AMT','PAY_CNT'], [
                {'PAYER':'U_1','BENEFICIARY':'U_2','PAY_AMT':'60','PAY_CNT':'2'},
                {'PAYER':'U_1','BENEFICIARY':'U_2','PAY_AMT':'20','PAY_CNT':'1'},
                {'PAYER':'U_1','BENEFICIARY':'U_9','PAY_AMT':'20','PAY_CNT':'1'},
                {'PAYER':'U_9','BENEFICIARY':'U_1','PAY_AMT':'200','PAY_CNT':'4'}])
            links = write('links.csv', ['SYNTHETIC_U','SYNTHETIC_F'], [
                {'SYNTHETIC_U':'U_1','SYNTHETIC_F':'F_1'}, {'SYNTHETIC_U':'U_9','SYNTHETIC_F':'F_1'}])
            builder = ProfileBuilder(companies,payments,links)
            self.assertEqual(builder.selected, {'U_1'})
            self.assertEqual(builder.quarantined, {'U_3'})
            profile = builder.profile('U_1')
            self.assertIsNone(profile['bankProducts']['hasLoans'])
            self.assertAlmostEqual(profile['industryPosition']['shareOfOkvedRevenueInDataset'], 2/3)
            self.assertEqual(profile['counterparties']['topSuppliers'][0]['share'], .8)
            self.assertEqual(profile['counterparties']['topSuppliers'][0]['paymentsCount'], 3)
            self.assertEqual(profile['counterparties']['topCustomers'][0]['amount'], 200)
            self.assertEqual(profile['affiliation']['intraGroupCounterparties'], ['U_2'])
            self.assertEqual(profile['affiliation']['affiliatedViaPersons'], ['U_9'])
            self.assertEqual(profile['affiliation']['groupContext']['companies'], 2)
            self.assertEqual(profile['affiliation']['groupContext']['revenueSum'], 30000000000)
    def test_missing_and_invalid_numbers(self):
        self.assertIsNone(number(''))
        self.assertIsNone(number('NaN'))
        self.assertEqual(number('0.0'), 0)
        with self.assertRaises(ValueError): number('Infinity')


if __name__ == '__main__': unittest.main()
