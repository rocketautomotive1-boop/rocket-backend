const https = require('https');
const url = 'https://produto.mercadolivre.com.br/MLB-3532326759-motor-ventilador-para-palio-2010-a-2019-oem-51836362';

https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        // try to match breadcrumbs
        const regex = /<li class="andes-breadcrumb__item">.*?<a.*?>(.*?)<\/a>.*?<\/li>/g;
        let match;
        const breadcrumbs = [];
        while ((match = regex.exec(data)) !== null) {
            breadcrumbs.push(match[1].trim());
        }
        console.log('Breadcrumbs:', breadcrumbs);

        if (breadcrumbs.length === 0) {
            // sometimes it's locked behind a 404 or different DOM
            console.log('Status code:', res.statusCode);
            const titleMatch = data.match(/<title>(.*?)<\/title>/);
            console.log('Title:', titleMatch ? titleMatch[1] : 'No title');
        }
    });
}).on('error', (err) => {
    console.log('Error: ' + err.message);
});
