
const axios = require('axios');

async function testMlFetch() {
    // Attempting to fetch the SAME item but replacing MLBU with MLB
    // Item: Moldura Interna Retrovisor Direito Fiat 5962226
    // ID from link: MLBU1768796674 -> MLB1768796674

    // Also testing a known public item from ML (random valid ID if possible, but let's stick to this one)
    const ids = ['MLB1768796674'];
    const mlApiUrl = 'https://api.mercadolibre.com';

    console.log(`Testing IDs: ${ids.join(', ')}`);

    try {
        const response = await axios.get(`${mlApiUrl}/items?ids=${ids.join(',')}`);
        console.log('Response status:', response.status);

        response.data.forEach(item => {
            console.log(`ID: ${item.body.id}, Code: ${item.code}`);
            if (item.code === 200) {
                console.log(` > Price: ${item.body.price}`);
            } else {
                console.log(` > Body:`, JSON.stringify(item.body));
            }
        });

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Date:', JSON.stringify(error.response.data));
        }
    }
}

testMlFetch();
