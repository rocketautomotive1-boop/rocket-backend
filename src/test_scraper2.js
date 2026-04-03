const https = require('https');
const url = 'https://www.mercadolivre.com.br/almofada-alca-de-seguranca-ford-cargo-direita-3c46e001k17ab/up/MLBU3768260414';

https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const regex = /<li class="andes-breadcrumb__item">.*?<a.*?>(.*?)<\/a>.*?<\/li>/g;
        let match;
        const breadcrumbs = [];
        while ((match = regex.exec(data)) !== null) {
            breadcrumbs.push(match[1].trim());
        }
        console.log('Status:', res.statusCode);
        console.log('Breadcrumbs:', breadcrumbs);
        if (breadcrumbs.length === 0) {
            let titleMatch = data.match(/<title>(.*?)<\/title>/);
            console.log('Title:', titleMatch ? titleMatch[1] : 'No title');

            // try looking for JSON-LD
            let scriptRegex = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
            let sMatch;
            while ((sMatch = scriptRegex.exec(data)) !== null) {
                if (sMatch[1].includes('BreadcrumbList')) {
                    console.log('Found BreadcrumbList JSON-LD!');
                    try {
                        const json = JSON.parse(sMatch[1]);
                        const items = json.itemListElement || (json['@graph'] ? json['@graph'].find(g => g['@type'] === 'BreadcrumbList')?.itemListElement : []) || [];
                        const names = items.map(i => i.item ? i.item.name : i.name);
                        console.log('Names from JSON-LD:', names);
                    } catch (e) { }
                }
            }
        }
    });
}).on('error', console.error);
