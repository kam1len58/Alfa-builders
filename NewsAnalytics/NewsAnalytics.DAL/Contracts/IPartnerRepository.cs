using NewsAnalytics.Models;

namespace NewsAnalytics.DAL.Contracts;

public interface IPartnerRepository
{
    Task<List<PartnerItem>> GetAllPartnerItemsAsync();
    Task<PartnerItem?> GetPartnerItemByIdAsync(string id);
    Task<List<PartnerItem>> GetPartnersByOkvedAsync(string okvedCode);
    Task<List<PartnerItem>> GetPartnersByRegionAsync(string region);
}
