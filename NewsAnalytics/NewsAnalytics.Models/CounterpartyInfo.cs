namespace NewsAnalytics.Models;

public class CounterpartyInfo
{
    public List<PartnerItem> TopSuppliers { get; set; } = new();
    public List<PartnerItem> TopCustomers { get; set; } = new();
    public int SuppliersCount { get; set; }
    public int CustomersCount { get; set; }
    public decimal PaymentsOutTotal { get; set; }
    public decimal PaymentsInTotal { get; set; }
    public double TopSupplierShare { get; set; }
    public double TopCustomerShare { get; set; }
    public bool SupplierConcentrationCritical { get; set; }
    public bool CustomerConcentrationCritical { get; set; }
    public List<string> PartnersOkvedSections { get; set; } = new();
    public string? Note { get; set; }
};
