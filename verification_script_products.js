
const axios = require('axios');

// Hardcoded token for local testing - User needs to provide this or I'll try to use a placeholder
// Since I can't easily get a token here, I will verify the LOGIC by assuming 401 means "exists but needs auth"
// vs 404 which means "does not exist".
// The previous log showed 401 for /products/MLBU... which is promising!
// GET /items/MLBU... returned 404 (implied by "Failed" without 401 in my previous output interpretation? 
// Wait, output snapshot was truncated. 
// "Testing MLBU ID: MLBU2822287052: 401 - undefined" implies 401 for /items too?

// Let's refine the script to print STATUS clearly.

async function testMlProducts() {
    const mlbuId = 'MLBU2822287052';
    const mlApiUrl = 'https://api.mercadolibre.com';

    console.log(`Testing with ID: ${mlbuId}`);

    try {
        await axios.get(`${mlApiUrl}/items/${mlbuId}`);
        console.log(`GET /items/${mlbuId} -> 200 OK`);
    } catch (e) {
        console.log(`GET /items/${mlbuId} -> ${e.response?.status}`);
    }

    try {
        await axios.get(`${mlApiUrl}/products/${mlbuId}`);
        console.log(`GET /products/${mlbuId} -> 200 OK`);
    } catch (e) {
        console.log(`GET /products/${mlbuId} -> ${e.response?.status}`);
    }
}

testMlProducts();
