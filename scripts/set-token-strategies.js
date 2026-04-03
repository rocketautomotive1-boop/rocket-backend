/**
 * Script de migração: define tokenStrategy em marketplaces existentes.
 * Executar uma única vez: node scripts/set-token-strategies.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const STRATEGIES = [
    { tag: 'amazon',        strategy: 'hybrid'  }, // LWA (OAuth) + AWS SigV4
    { tag: 'mercado-livre', strategy: 'oauth2'  },
    { tag: 'shopee',        strategy: 'oauth2'  },
    { tag: 'olx',           strategy: 'oauth2'  },
    { tag: 'magalu',        strategy: 'oauth2'  },
    { tag: 'viavarejo',     strategy: 'oauth2'  },
    { tag: 'yampi',         strategy: 'api_key' },
];

async function main() {
    const uri = process.env.MONGO_URI;
    await mongoose.connect(uri);

    const col = mongoose.connection.collection('marketplaces');

    for (const { tag, strategy } of STRATEGIES) {
        const result = await col.updateOne(
            { tag },
            { $set: { tokenStrategy: strategy } }
        );
        console.log(`[${tag}] strategy=${strategy} — matched=${result.matchedCount} modified=${result.modifiedCount}`);
    }

    await mongoose.disconnect();
    console.log('Done.');
}

main().catch(console.error);
