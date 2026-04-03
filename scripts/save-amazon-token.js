/**
 * Troca o refresh token LWA da Amazon por um access token e salva no MongoDB.
 * Executar: node scripts/save-amazon-token.js
 */
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const REFRESH_TOKEN = 'Atzr|IwEBIOFUiN0EWqeYYCvkHJOuUjzF5xFaqCblz82q5TmnfzCnqHxqH5AglBvUU-73ADI0W-zF5LKXxNRL5kpP0Psm4Kp9NtEfFPqLrvMSCp8uX8jOVmiioD-6-oRlGtVuQ7iNMS-zFMLhDEtytiXS5rLGLlkzzbZlogxPwVrs53_jJiLdgOZQRf-g_PplHVFGjTYA-L0eRehb5tfLR3KKuRKdosF-SSgJY19fv2G_aM9gCG-zUA5tPMBSiQsWDkW608vRAXM2atPiFQB3Rlpa3X66FcjgFy2PLHNlLSITfYtwViAXDu39j7B1iiEQFVwrAF9RriR9RzvCafkjdwUNqIkQeT5B';

async function main() {
    const clientId = process.env.AMAZON_APP_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET;
    const mongoUri = process.env.MONGO_URI;

    if (!clientId || !clientSecret) {
        throw new Error('AMAZON_APP_ID ou AMAZON_CLIENT_SECRET não configurados no .env');
    }

    // 1. Trocar refresh_token por access_token na Amazon LWA
    console.log('Trocando refresh token por access token...');
    const response = await axios.post('https://api.amazon.com/auth/o2/token', {
        grant_type: 'refresh_token',
        refresh_token: REFRESH_TOKEN,
        client_id: clientId,
        client_secret: clientSecret,
    });

    const { access_token, refresh_token, expires_in, token_type } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    console.log(`Access token obtido. Expira em: ${expiresAt.toISOString()}`);

    // 2. Salvar no MongoDB
    await mongoose.connect(mongoUri);
    const col = mongoose.connection.collection('marketplaces');

    const result = await col.updateOne(
        { tag: 'amazon' },
        {
            $pull: { tokens: {} }  // limpa tokens antigos primeiro
        }
    );

    await col.updateOne(
        { tag: 'amazon' },
        {
            $push: {
                tokens: {
                    accessToken: access_token,
                    refreshToken: refresh_token || REFRESH_TOKEN,
                    expiresAt,
                    tokenType: token_type || 'bearer',
                    isActive: true,
                    additionalData: {
                        sellerId: process.env.AMAZON_SELLER_ID,
                    },
                }
            }
        }
    );

    console.log('Token salvo no MongoDB com sucesso!');
    console.log(`  accessToken: ${access_token.substring(0, 20)}...`);
    console.log(`  expiresAt:   ${expiresAt.toISOString()}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Erro:', err.response?.data || err.message);
    process.exit(1);
});
