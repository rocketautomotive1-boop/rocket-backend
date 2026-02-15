const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Configuration
const MONGODB_URI = process.env.MONGO_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_SAMPLES = 10; // Process only 10 for prototype

// Helper to slugify
function slugify(text) {
    return text.toString().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function connectDB() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
}

async function getRocketPath(model, meliPath, contextPaths) {
    const prompt = `
    Você é um especialista em taxonomia de autopeças.
    
    TAREFA: Transformar a categoria do Mercado Livre em uma categoria "Rocket Automotive" (Loja especializada).
    
    CATEGORIA ORIGINAL (MELI): "${meliPath}"
    
    OBJETIVO:
    1. Remover redundâncias (ex: "Acessórios para Veículos", "Peças de Carros e Caminhonetes").
    2. Criar uma árvore lógica e direta.
    3. Exemplo: "Acessórios para Veículos > Peças... > Motor > Cabeçotes" -> "Peças de Reposição > Motor > Cabeçotes"
    4. Exemplo: "Acessórios... > Som Automotivo > Alto-falantes" -> "Som e Vídeo > Alto-falantes"
    
    CONTEXTO (Outras categorias já existentes na Rocket):
    ${contextPaths.join('\n')}
    
    Retorne APENAS um JSON:
    {
        "rocketPath": ["Raiz", "Subcategoria", "Final"],
        "synonyms": ["sinônimo 1", "sinônimo 2"],
        "usage": "Explicação breve de uso",
        "relevance": 85, // 0-100
        "attributes": ["Atributo 1", "Atributo 2"], // Ex: Voltagem, Material, Lado
        "reason": "Explicação curta"
    }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
}

async function run() {
    try {
        if (!GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is missing in .env');
        }

        await connectDB();

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });

        const CategorySchema = new mongoose.Schema({
            name: String,
            slug: String,
            parentId: mongoose.Schema.Types.ObjectId,
            ancestors: [mongoose.Schema.Types.ObjectId],
            marketplaceMappings: Array
        }, { collection: 'categories' });
        const CategoryModel = mongoose.model('Category', CategorySchema);

        const samples = await CategoryModel.find({
            "marketplaceMappings.0": { $exists: true },
            parentId: { $ne: null }
        }).limit(MAX_SAMPLES).lean();

        console.log(`Processing ${samples.length} samples...`);

        // Create/Clear file
        require('fs').writeFileSync('refactor_preview.txt', '');

        for (const cat of samples) {
            const meliMapping = cat.marketplaceMappings.find(m => m.externalName);
            if (!meliMapping) continue;

            const meliPath = meliMapping.path || `${meliMapping.externalName}`;

            console.log(`\nOriginal: ${meliPath}`);

            try {
                const context = ["Peças de Reposição", "Som e Vídeo", "Acessórios Externos", "Acessórios Internos", "Ferramentas"];

                const rawResult = await getRocketPath(model, meliPath, context);
                const suggestedPath = rawResult.rocketPath.join(' > ');

                const output = `
Original: ${meliPath}
Suggested: ${suggestedPath}
Synonyms: ${rawResult.synonyms?.join(', ')}
Usage: ${rawResult.usage}
Relevance: ${rawResult.relevance}
Attributes: ${rawResult.attributes?.join(', ')}
Reason: ${rawResult.reason}
----------------------------------------
`;
                console.log(output);
                require('fs').appendFileSync('refactor_preview.txt', output);

            } catch (err) {
                const errorMsg = `Error processing ${meliPath}: ${err.message}\n`;
                console.error(errorMsg);
                require('fs').appendFileSync('refactor_preview.txt', errorMsg);
            }
        }

    } catch (error) {
        console.error('Script failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

run();
