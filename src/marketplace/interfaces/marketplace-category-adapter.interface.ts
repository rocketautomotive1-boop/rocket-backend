export interface IMarketplaceCategoryAdapter {
    domainDiscovery?(title: string): Promise<any>;
    getCategory?(categoryId: string): Promise<any>;
    getCategoryAttributes?(categoryId: string): Promise<any>;
    getCategoryAttributesWithValues?(categoryId: string, productId: number): Promise<any>;
    getDomainAndCategories?(title: string): Promise<any>;
    getDomainWithCategoryAndAttributes?(title: string): Promise<any>;
}
