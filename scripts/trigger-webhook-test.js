
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Tenta carregar .env se existir
try {
    const envPath = path.resolve(__dirname, '../.env');
    console.log('Procurando .env em:', envPath);
    if (fs.existsSync(envPath)) {
        console.log('.env encontrado! Lendo variáveis...');
        const envConfig = require('dotenv').parse(fs.readFileSync(envPath));
        for (const k in envConfig) {
            process.env[k] = envConfig[k];
        }
    } else {
        console.log('.env NÃO encontrado em:', envPath);
        // Tenta listar o diretório pai para debug
        try {
            console.log('Arquivos na raiz:', fs.readdirSync(path.resolve(__dirname, '..')));
        } catch (e) {
            console.log('Não foi possível listar arquivos da raiz');
        }
    }
} catch (e) {
    console.error('Erro ao processar .env:', e);
}

const secret = process.env.MERCADO_LIVRE_WEBHOOK_SECRET;

if (!secret) {
    console.warn('AVISO: MERCADO_LIVRE_WEBHOOK_SECRET não encontrado. Usando assinatura simulada (o backend deve estar configurado para aceitar sem validação).');
}

const payload = {
    _id: 'test-notification-' + Date.now(),
    resource: '/questions/123456789',
    user_id: 123456789,
    topic: 'questions',
    application_id: 123456789,
    sent: new Date().toISOString(),
    attempts: 1,
    received: new Date().toISOString(),
};

const payloadString = JSON.stringify(payload);

// Calcular assinatura HMAC SHA-256
// Calcular assinatura HMAC SHA-256 se houver secret, senão envia string vazia ou dummy
let signature = '';
if (secret) {
    const hmac = crypto.createHmac('sha256', secret);
    signature = hmac.update(payloadString).digest('hex');
} else {
    signature = 'dummy-signature-no-secret';
}

// Suporte a URL via argumento ou default localhost
const targetUrl = process.argv[2] || 'http://localhost:3000/webhooks/mercadolivre';

console.log('Enviando webhook de teste...');
console.log('URL:', targetUrl);
// console.log('Payload:', payloadString); 
// console.log('Signature:', signature);

axios.post(targetUrl, payload, {
    headers: {
        'x-signature': signature
    }
})
    .then(response => {
        console.log('✅ Sucesso! Resposta do servidor:', response.data);
        console.log('>> Verifique o aplicativo agora. A notificação deve chegar em breve.');
    })
    .catch(error => {
        console.error('❌ Erro ao enviar webhook:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else if (error.code === 'ECONNREFUSED') {
            process.stdout.write('\n⚠️ Conexão recusada! O backend está rodando na porta 3000?\n');
        }
    });
