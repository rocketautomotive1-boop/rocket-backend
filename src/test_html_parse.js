const fs = require('fs');
const html = fs.readFileSync('ml_test.html', 'utf-8');

const breadcrumbRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
let match;
while ((match = breadcrumbRegex.exec(html)) !== null) {
    if (match[1].includes('BreadcrumbList')) {
        console.log('Found BreadcrumbList JSON-LD!');
        try {
            const json = JSON.parse(match[1]);
            const graph = json['@graph'] || [json];
            const list = graph.find(g => g['@type'] === 'BreadcrumbList');
            if (list && list.itemListElement) {
                console.log('Categories:', list.itemListElement.map(i => i.item.name || i.name).join(' > '));
            }
        } catch (e) { console.error('Parse error', e.message); }
    }
}

// Fallback HTML parsing
const linksRegex = /<a[^>]*class="[^"]*andes-breadcrumb__link[^"]*"[^>]*>(.*?)<\/a>/g;
let l;
const fallbacks = [];
while ((l = linksRegex.exec(html)) !== null) {
    fallbacks.push(l[1].replace(/<[^>]+>/g, '').trim());
}
console.log('HTML links fallback:', fallbacks);

const title = html.match(/<title>(.*?)<\/title>/);
console.log('Title:', title ? title[1] : 'none');
