from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class BankProducts(BaseModel):
    has_rko: int = 0
    has_loans: int = 0
    has_leasing: int = 0
    has_factoring: int = 0
    has_deposit: int = 0
    has_payroll: int = 0
    has_guarantees: int = 0


class Ved(BaseModel):
    has_ved: int = 0
    country: Optional[str] = None  # Может быть null!


class Counterparty(BaseModel):
    id: str
    okved_code: Optional[str] = None
    okved_name: Optional[str] = None
    region: Optional[str] = None
    amount: float
    payments_count: int
    share: float


class Counterparties(BaseModel):
    top_suppliers: List[Counterparty] = []
    top_customers: List[Counterparty] = []
    suppliers_count: int = 0
    customers_count: int = 0
    payments_out_total: float = 0.0
    payments_in_total: float = 0.0
    top_supplier_share: Optional[float] = None
    top_customer_share: Optional[float] = None
    supplier_concentration_critical: bool = False
    customer_concentration_critical: bool = False
    partners_okved_sections: List[str] = []


class IndustryPosition(BaseModel):
    rank_by_revenue_in_okved: Optional[int] = None
    companies_in_okved: Optional[int] = None
    share_of_okved_revenue_in_dataset: Optional[float] = None


class Affiliation(BaseModel):
    group_id: Optional[str] = None
    group_companies: List[str] = []
    group_size: int = 1
    linked_persons_count: int = 0
    intra_group_counterparties: List[str] = []


class ClientProfile(BaseModel):
    synthetic_u: str
    industry: str
    okved_code: str
    revenue: float
    is_large_business: bool
    region: str
    city: Optional[str] = None
    client_type: str  # "CLIENT" | "PROSPECT" | "CLOSE_CLIENT"
    org_type: Optional[str] = None
    ownership: Optional[str] = None
    company_age: Optional[str] = None
    eco_stage: Optional[str] = None
    workers: Optional[str] = None
    negative_owner_mark: int = 0
    bank_products: BankProducts
    ved: Ved
    industry_position: Optional[IndustryPosition] = None
    counterparties: Optional[Counterparties] = None
    affiliation: Optional[Affiliation] = None
    demo_scenario: Optional[str] = None  # Есть только в demo_profiles


# --- Модели для бизнес-матрицы (правил) ---

class RuleCondition(BaseModel):
    field: str
    eq: Optional[Any] = None
    gte: Optional[float] = None
    in_: Optional[List[str]] = Field(None, alias="in")  # "in" — reserved word в Python
    okved_prefix: Optional[List[str]] = None
    matches_news_industry: Optional[bool] = None


class Rule(BaseModel):
    id: str
    event: str
    triggers: List[str]
    direction: Optional[str] = None
    condition: List[RuleCondition] = []
    parameter: Optional[str] = None
    effect: str  # "риск" | "возможность" | "риск/возможность"
    weight: float
    bank_products: List[str] = []
    alfa_source: Optional[str] = None
    prompt_hint: Optional[str] = None


class Modifier(BaseModel):
    condition: str
    effect: str


class BusinessMatrix(BaseModel):
    version: str
    field_map_csv_to_profile: Dict[str, str]
    formula: str
    modifiers: List[Modifier]
    okved_groups: Dict[str, List[str]]
    rules: List[Rule]
    alfa_sources_extra: Optional[List[dict]] = []


# --- Модели для эталонных новостей ---

class GoldenNews(BaseModel):
    id: str
    what_happened: str
    why_important: str
    consequences: str
    actions: str
    alfa_view: Optional[str] = None
    sources: Optional[str] = None
    date: str
    matched_rules: List[str] = []


# --- Быстрая самопроверка ---

if __name__ == "__main__":
    print("Models OK:", list(ClientProfile.model_fields.keys()))
    print("Rule fields:", list(Rule.model_fields.keys()))
    print("GoldenNews fields:", list(GoldenNews.model_fields.keys()))