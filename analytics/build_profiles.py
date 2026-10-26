"""JSON-профили компаний для ML-агента из трёх таблиц кейса + отбор демо-компаний.

Запуск:
  python build_profiles.py \
      --companies df_Uid_data_hack.csv \
      --payments  df_Uid_payment_hack.csv \
      --links     df_Fid_Uid_link_hack.csv

Результат (в --out, по умолчанию рядом со скриптом):
  profiles_all.json     — профиль каждой КРУПНОЙ компании (>15 млрд); любую другую — pb.profile(u): {SYNTHETIC_U: профиль}
  demo_profiles.json    — 4 демо-компании (кредиты / ВЭД-Китай / сеть контрагентов / группа)
  demo_candidates.xlsx  — топ-5 кандидатов по каждому сценарию, чтобы выбрать руками
Свой выбор демо:  --pick loans=U_1 ved=U_2 network=U_3 group=U_4

Как функция для бэкенда:
  from build_profiles import ProfileBuilder
  pb = ProfileBuilder("df_Uid_data_hack.csv", "df_Uid_payment_hack.csv", "df_Fid_Uid_link_hack.csv")
  pb.profile("U_2222")
"""
import argparse, json, sys
from pathlib import Path
import pandas as pd

MIN_REVENUE = 15e9          # крупный бизнес по условию кейса
CONCENTRATION_CRITICAL = 0.30
TOP_N = 3
MAX_AFFILIATES = 20
FLAGS = ["CL_PRODUCT_RKO_MARK", "CL_PRODUCT_GAR_MARK", "CL_PRODUCT_LOA_MARK", "CL_PRODUCT_LEA_MARK",
         "CL_PRODUCT_DEP_MARK", "CL_PRODUCT_ZPP_MARK", "FTS_FLAG", "FACTORING_MARK", "NEGATIVEMARK"]
TRUE_VALUES = {"1", "1.0", "true", "y", "yes", "да", "д", "t"}


# ---------- чтение и чистка ----------
def read_any(path):
    for sep in [",", ";", "\t", "|"]:
        for enc in ["utf-8", "utf-8-sig", "cp1251"]:
            try:
                df = pd.read_csv(path, sep=sep, encoding=enc, low_memory=False)
                if df.shape[1] >= 2:
                    df.columns = [c.strip().upper() for c in df.columns]
                    return df
            except Exception:
                continue
    sys.exit(f"Не смог прочитать {path}")


def to_flag(s):
    """1 / 0 / <NA>. Пустое значение = нет данных, а не «нет продукта»."""
    return s.map(lambda v: pd.NA if pd.isna(v) or str(v).strip() == ""
                 else (1 if str(v).strip().lower() in TRUE_VALUES else 0)).astype("Int64")


def to_num(s):
    return pd.to_numeric(s.astype(str).str.replace(r"[\s ]", "", regex=True).str.replace(",", "."), errors="coerce")


def clean(v):
    if v is None or (not isinstance(v, (list, dict)) and pd.isna(v)):
        return None
    if hasattr(v, "item"):
        return v.item()
    return v


class ProfileBuilder:
    def __init__(self, companies, payments, links=None):
        co = read_any(companies)
        for f in FLAGS:
            if f in co.columns:
                co[f] = to_flag(co[f])
        co["REVENUE_COMPANY"] = to_num(co["REVENUE_COMPANY"])
        co["MAINOKVED_CODE"] = co["MAINOKVED_CODE"].astype(str).str.strip().replace({"nan": None})
        self.co = co.drop_duplicates("SYNTHETIC_U").set_index("SYNTHETIC_U")

        pay = read_any(payments)
        miss = {"PAYER", "BENEFICIARY", "PAY_AMT"} - set(pay.columns)
        if miss:
            sys.exit(f"В {payments} нет колонок {miss} — это точно файл платежей?")
        pay["PAY_AMT"] = to_num(pay["PAY_AMT"]).fillna(0)
        pay["PAY_CNT"] = to_num(pay["PAY_CNT"]).fillna(0) if "PAY_CNT" in pay else 0
        pay = pay[pay["PAYER"] != pay["BENEFICIARY"]]
        # одна строка на пару плательщик→получатель
        self.pairs = pay.groupby(["PAYER", "BENEFICIARY"], as_index=False)[["PAY_AMT", "PAY_CNT"]].sum()
        srt = self.pairs.sort_values("PAY_AMT", ascending=False)
        self.out_tot = srt.groupby("PAYER")["PAY_AMT"].agg(["sum", "size"])
        self.in_tot = srt.groupby("BENEFICIARY")["PAY_AMT"].agg(["sum", "size"])
        self.out_top = {k: g for k, g in srt.groupby("PAYER").head(TOP_N).groupby("PAYER")}
        self.in_top = {k: g for k, g in srt.groupby("BENEFICIARY").head(TOP_N).groupby("BENEFICIARY")}

        # аффилированность через физлиц: компании с общим SYNTHETIC_F
        self.persons_of, self.companies_of = {}, {}
        if links:
            ln = read_any(links)
            miss = {"SYNTHETIC_F", "SYNTHETIC_U"} - set(ln.columns)
            if miss:
                sys.exit(f"В {links} нет колонок {miss}")
            ln = ln.dropna(subset=["SYNTHETIC_F", "SYNTHETIC_U"]).drop_duplicates(["SYNTHETIC_F", "SYNTHETIC_U"])
            self.persons_of = ln.groupby("SYNTHETIC_U")["SYNTHETIC_F"].apply(list).to_dict()
            self.companies_of = ln.groupby("SYNTHETIC_F")["SYNTHETIC_U"].apply(list).to_dict()

        self.group_members = (self.co.reset_index().dropna(subset=["GROUP_ID"]).groupby("GROUP_ID")["SYNTHETIC_U"]
                              .apply(list).to_dict()) if "GROUP_ID" in self.co else {}
        self.okved5 = self.co["MAINOKVED_CODE"].fillna("").str[:5]
        rv = self.co["REVENUE_COMPANY"]
        self.peer_rank = rv.groupby(self.okved5).rank(ascending=False, method="min")
        self.peer_n = rv.groupby(self.okved5).transform("count")
        self.peer_sum = rv.groupby(self.okved5).transform("sum")

    # ---------- части профиля ----------
    def _get(self, row, f):
        if f not in row.index:
            return None
        v = row[f]
        if pd.isna(v):
            return None
        return int(v) if f in FLAGS else clean(v)

    def _partner(self, pid, amount, cnt, total):
        known = pid in self.co.index
        return {"id": pid,
                "okved_code": clean(self.co.at[pid, "MAINOKVED_CODE"]) if known else None,
                "okved_name": clean(self.co.at[pid, "MAINOKVED_NAME"]) if known and "MAINOKVED_NAME" in self.co else None,
                "region": clean(self.co.at[pid, "REGION"]) if known and "REGION" in self.co else None,
                "amount": float(amount), "payments_count": int(cnt),
                "share": round(float(amount) / total, 3) if total else None}

    def _side(self, top_tbl, tot_tbl, u, other_col):
        if u not in tot_tbl.index:
            return 0.0, [], 0
        total, n = float(tot_tbl.at[u, "sum"]), int(tot_tbl.at[u, "size"])
        g = top_tbl[u]
        top = [self._partner(p, a, c, total) for p, a, c in zip(g[other_col], g["PAY_AMT"], g["PAY_CNT"])]
        return total, top, n

    def _affiliates(self, u):
        persons = self.persons_of.get(u, [])
        aff = sorted({c for f in persons for c in self.companies_of.get(f, []) if c != u})
        return persons, aff

    def profile(self, u):
        if u not in self.co.index:
            return None
        row = self.co.loc[u]
        g = lambda f: self._get(row, f)

        out_total, suppliers, n_sup = self._side(self.out_top, self.out_tot, u, "BENEFICIARY")
        in_total, customers, n_cus = self._side(self.in_top, self.in_tot, u, "PAYER")
        sup_share = suppliers[0]["share"] if suppliers else None
        cus_share = customers[0]["share"] if customers else None

        persons, affiliates = self._affiliates(u)
        grp = g("GROUP_ID")
        group = [c for c in self.group_members.get(grp, []) if c != u] if grp is not None else []
        related = set(affiliates) | set(group)
        intra = [p["id"] for p in suppliers + customers if p["id"] in related]

        code = g("MAINOKVED_CODE") or ""
        rev = g("REVENUE_COMPANY")
        psum = self.peer_sum.get(u)
        partners_okved = sorted({p["okved_code"][:2] for p in suppliers + customers if p["okved_code"]})

        return {
            "synthetic_u": u,
            "industry": g("MAINOKVED_NAME"), "okved_code": code or None,
            "revenue": rev, "is_large_business": bool(rev and rev > MIN_REVENUE),
            "region": g("REGION"), "city": g("CITY"),
            "client_type": g("CL_TYPE"), "org_type": g("ORG_TYPE"), "ownership": g("OKFS_NAME"),
            "company_age": g("COMPANY_AGE_YEARS_GRADATION"), "eco_stage": g("ECO_MARK_LABEL"),
            "workers": g("AMOUNT_WORKERS_FNS_GRADATION") or g("AMOUNT_WORKERS_SPARK_GRADATION"),
            "negative_owner_mark": g("NEGATIVEMARK"),
            "bank_products": {  # null = нет данных
                "has_rko": g("CL_PRODUCT_RKO_MARK"), "has_loans": g("CL_PRODUCT_LOA_MARK"),
                "has_leasing": g("CL_PRODUCT_LEA_MARK"), "has_factoring": g("FACTORING_MARK"),
                "has_deposit": g("CL_PRODUCT_DEP_MARK"), "has_payroll": g("CL_PRODUCT_ZPP_MARK"),
                "has_guarantees": g("CL_PRODUCT_GAR_MARK"),
            },
            "ved": {"has_ved": g("FTS_FLAG"), "country": g("FTS_COUNTRY_NAME")},
            "industry_position": {
                "rank_by_revenue_in_okved": int(self.peer_rank[u]) if rev else None,
                "companies_in_okved": int(self.peer_n[u]),
                "share_of_okved_revenue_in_dataset": round(rev / psum, 4) if rev and psum else None,
            },
            "counterparties": {
                "top_suppliers": suppliers, "top_customers": customers,
                "suppliers_count": n_sup, "customers_count": n_cus,
                "payments_out_total": out_total, "payments_in_total": in_total,
                "top_supplier_share": sup_share, "top_customer_share": cus_share,
                "supplier_concentration_critical": bool(sup_share and sup_share > CONCENTRATION_CRITICAL),
                "customer_concentration_critical": bool(cus_share and cus_share > CONCENTRATION_CRITICAL),
                "partners_okved_sections": partners_okved,
                "note": "Доли — от суммы платежей в датасете (период PAY_AMT не указан), а не от выручки",
            },
            "affiliation": {
                "group_id": grp, "group_companies": group[:MAX_AFFILIATES], "group_size": len(group) + 1 if grp else 1,
                "linked_persons_count": len(persons),
                "affiliated_via_persons": affiliates[:MAX_AFFILIATES], "affiliated_count": len(affiliates),
                "intra_group_counterparties": intra,
            },
        }

    # ---------- отбор демо ----------
    def demo_candidates(self, profiles=None):
        rows = []
        for u in self.co.index[self.co["REVENUE_COMPANY"] > MIN_REVENUE]:
            p = profiles[u] if profiles else self.profile(u)
            c, bp, a = p["counterparties"], p["bank_products"], p["affiliation"]
            rows.append({"SYNTHETIC_U": u, "okved": p["okved_code"], "industry": p["industry"], "revenue_bn": round(p["revenue"] / 1e9, 1),
                         "region": p["region"], "ved": p["ved"]["has_ved"], "ved_country": p["ved"]["country"],
                         "loans": bp["has_loans"], "leasing": bp["has_leasing"], "deposit": bp["has_deposit"],
                         "guarantees": bp["has_guarantees"], "factoring": bp["has_factoring"],
                         "partners": c["suppliers_count"] + c["customers_count"],
                         "top_sup_share": c["top_supplier_share"], "top_cus_share": c["top_customer_share"],
                         "critical": c["supplier_concentration_critical"] or c["customer_concentration_critical"],
                         "group_size": max(a["group_size"], a["affiliated_count"] + 1)})
        d = pd.DataFrame(rows)
        if d.empty:
            sys.exit("Нет компаний с выручкой > 15 млрд — проверь единицы REVENUE_COMPANY (может, в тыс. руб.?)")
        n = lambda c: d[c].fillna(0).astype(float)
        has_pay = (d["partners"] > 0).astype(int)
        china = d["ved_country"].fillna("").astype(str).str.lower().str.contains("кита|china|кнр").astype(int)
        rank_rev = d["revenue_bn"].rank(pct=True)
        out = {
            "loans": d[n("loans") == 1].assign(_score=n("leasing") + n("deposit") + n("guarantees") + has_pay + rank_rev - n("ved")),
            "ved": d[n("ved") == 1].assign(_score=china * 3 + has_pay + n("factoring") + rank_rev),
            "network": d[d["partners"] > 0].assign(_score=d["partners"].rank(pct=True) * 2 + d["critical"].astype(int)),
            "group": d[d["group_size"] >= 3].assign(_score=d["group_size"].rank(pct=True) + has_pay),
        }
        return {k: v.sort_values("_score", ascending=False) for k, v in out.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--companies", required=True)
    ap.add_argument("--payments", required=True)
    ap.add_argument("--links", help="df_Fid_Uid_link_hack.csv (аффилированность через физлиц)")
    ap.add_argument("--pick", nargs="*", default=[])
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data"))
    a = ap.parse_args()
    out = Path(a.out)

    pb = ProfileBuilder(a.companies, a.payments, a.links)
    if not a.links:
        print("Файл связей не указан, группы определяются только по GROUP_ID")

    large = pb.co.index[pb.co["REVENUE_COMPANY"] > MIN_REVENUE]
    allp = {u: pb.profile(u) for u in large}  # остальные — по запросу через pb.profile(u)
    json.dump(allp, open(out / "profiles_all.json", "w", encoding="utf-8"), ensure_ascii=False, default=clean)

    cand = pb.demo_candidates(allp)
    with pd.ExcelWriter(out / "demo_candidates.xlsx") as xw:
        for k, df in cand.items():
            df.head(5).to_excel(xw, sheet_name=k, index=False)
    forced = dict(p.split("=", 1) for p in a.pick)
    titles = {"ved": "ВЭД (Китай) → валюта и таможня", "loans": "Кредитная нагрузка → ключевая ставка",
              "network": "Сеть контрагентов → граф платежей", "group": "Группа компаний / холдинг"}
    demo, used = [], set()
    for k in ["ved", "loans", "network", "group"]:
        u = forced.get(k)
        if not u:
            rest = cand[k][~cand[k]["SYNTHETIC_U"].isin(used)]
            if rest.empty:
                print(f"Для сценария «{titles[k]}» нет подходящих компаний"); continue
            u = rest.iloc[0]["SYNTHETIC_U"]
        used.add(u)
        demo.append({**allp[u], "demo_scenario": titles[k]})
    json.dump(demo, open(out / "demo_profiles.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2, default=clean)

    print(f"Компаний в датасете: {len(pb.co)}, профилей крупных (>15 млрд): {len(allp)}\n")
    for p in demo:
        c, af = p["counterparties"], p["affiliation"]
        bp = ", ".join(k[4:] for k, v in p["bank_products"].items() if v == 1) or "—"
        print(f"{p['demo_scenario']:<38} {p['synthetic_u']:<10} {p['revenue']/1e9:>7.1f} млрд | {str(p['industry'])[:35]:<35} | "
              f"{bp} | ВЭД: {p['ved']['country'] if p['ved']['has_ved'] else '—'} | "
              f"топ-покупатель {c['top_customer_share']} {'(>30%)' if c['customer_concentration_critical'] else ''} | "
              f"связанных компаний: {max(af['group_size'] - 1, af['affiliated_count'])}")
    print(f"\nСохранено в {out}: profiles_all.json, demo_profiles.json, demo_candidates.xlsx")


if __name__ == "__main__":
    main()
