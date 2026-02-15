import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProductCategoryService } from '../services/product-category.service';
import { ProductService } from '../product.service';

@ApiTags('seo')
@Controller('sitemap.xml')
export class SitemapController {
    constructor(
        private readonly categoryService: ProductCategoryService,
        private readonly productService: ProductService,
    ) { }

    @Get()
    @Header('Content-Type', 'application/xml')
    @ApiOperation({ summary: 'Generate Sitemap XML' })
    async getSitemap(): Promise<string> {
        const baseUrl = 'https://rocketautomotive.com.br'; // Should be env var
        const categories = await this.categoryService.findAll();
        // Fetch limited recent products or all? For sitemap usually all, but scalable?
        // Let's just do categories and top 1000 products for now or simple logic.
        const products = await this.productService.findForStore(1, 1000);

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        // Static pages
        xml += `
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`;

        // Categories
        categories.forEach(cat => {
            if (cat.slug) {
                xml += `
  <url>
    <loc>${baseUrl}/c/${cat.slug}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
            }
        });

        // Products
        products.data.forEach(prod => {
            if (prod.slug) {
                xml += `
  <url>
    <loc>${baseUrl}/p/${prod.slug}</loc>
    <lastmod>${(prod as any).updatedAt ? new Date((prod as any).updatedAt).toISOString() : new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
            }
        });

        xml += `
</urlset>`;

        return xml;
    }
}
