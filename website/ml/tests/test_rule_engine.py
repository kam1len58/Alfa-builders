import pytest
from src.data_loader import load_all_profiles, load_business_matrix, load_golden_news
from src.rule_engine import RuleEngine


@pytest.fixture(scope="module")
def engine():
    matrix = load_business_matrix()
    return RuleEngine(matrix)


@pytest.fixture(scope="module")
def profiles():
    return load_all_profiles()


@pytest.fixture(scope="module")
def news():
    return {n.id: n for n in load_golden_news()}


def test_n1_infl_costs(engine, profiles, news):
    result = engine.evaluate(news["N1"].what_happened, profiles["U_258064"])
    assert "INFL_COSTS" in [m.rule_id for m in result.matches]


def test_n2_pmi_only_wholesale(engine, profiles, news):
    # У оптовика срабатывает
    result = engine.evaluate(news["N2"].what_happened, profiles["U_258064"])
    assert "PMI_ORDERS" in [m.rule_id for m in result.matches]
    # У стройки — нет
    result = engine.evaluate(news["N2"].what_happened, profiles["U_9250"])
    assert "PMI_ORDERS" not in [m.rule_id for m in result.matches]


def test_n3_sanctions(engine, profiles, news):
    # У клиента с ВЭД срабатывает
    result = engine.evaluate(news["N3"].what_happened, profiles["U_9250"])
    assert "SANCTIONS" in [m.rule_id for m in result.matches]
    # У клиента без ВЭД — нет
    result = engine.evaluate(news["N3"].what_happened, profiles["U_276153"])
    assert "SANCTIONS" not in [m.rule_id for m in result.matches]


def test_n4_fuel(engine, profiles, news):
    result = engine.evaluate(news["N4"].what_happened, profiles["U_9250"])
    assert "FUEL" in [m.rule_id for m in result.matches]
    result = engine.evaluate(news["N4"].what_happened, profiles["U_258064"])
    assert "FUEL" not in [m.rule_id for m in result.matches]


def test_n5_gov_procurement(engine, profiles, news):
    result = engine.evaluate(news["N5"].what_happened, profiles["U_9250"])
    assert "GOV_PROCUREMENT" in [m.rule_id for m in result.matches]


def test_score_formula(engine):
    assert abs(engine._compute_score([0.95, 0.8, 0.7]) - 0.997) < 0.001
    assert engine._compute_score([]) == 0.0
