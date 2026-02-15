const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Configuration
const MONGODB_URI = process.env.MONGO_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_RETRIES = 3;

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
    1. Otimizar a árvore para uma loja especializada (Rocket Automotive).
    2. IMPORTANTE: MANTER a distinção entre tipos de veículos. NÃO misture peças de barco, moto e carro na mesma categoria genérica.
    3. Use a raiz "Peças de Reposição" para a maioria das peças mecânicas, dividindo por tipo de veículo:
       - "Peças de Reposição > Carros e Caminhonetes"
       - "Peças de Reposição > Motos e Quadriciclos"
       - "Peças de Reposição > Náutica"
       - "Peças de Reposição > Linha Pesada"
       - "Ferramentas"
       - "Acessórios"
    4. Exemplo MOTO: "Acessórios... > Peças de Motos > Motor > Bielas" -> "Peças de Reposição > Motos e Quadriciclos > Motor > Bielas"
    5. Exemplo NÁUTICA: "Acessórios... > Peças Náuticas > Motor..." -> "Peças de Reposição > Náutica > Motor..."
    6. Exemplo CARRO: "Acessórios... > Peças de Carros... > Motor > Bielas" -> "Peças de Reposição > Carros e Caminhonetes > Motor > Bielas"
    
    CONTEXTO (Outras categorias já existentes na Rocket):
    ${contextPaths.join('\n')}
    
    Retorne APENAS um JSON:
    {
        "rocketPath": ["Raiz", "Subcategoria", "Final"],
        "synonyms": ["sinônimo 1", "sinônimo 2"],
        "usage": "Explicação breve de uso",
        "relevance": 85, // 0-100
        "attributes": ["Atributo 1", "Atributo 2"],
        "reason": "Explicação curta"
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error("AI Error:", e.message);
        return null;
    }
}

async function run() {
    try {
        if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');

        await connectDB();

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });

        const CategorySchema = new mongoose.Schema({
            name: String,
            slug: String,
            parentId: mongoose.Schema.Types.ObjectId,
            ancestors: [mongoose.Schema.Types.ObjectId],
            marketplaceMappings: Array,
            // New Rocket Fields
            rocketSynced: Boolean,
            synonyms: [String],
            usage: String,
            relevance: Number,
            attributes: [String],
            aiReason: String
        }, { collection: 'categories' });
        const CategoryModel = mongoose.model('Category', CategorySchema);

        // Check for specific ID argument
        const specificId = process.argv[2];
        const query = {
            "marketplaceMappings.0": { $exists: true }
        };

        if (specificId) {
            console.log(`Processing specific ID: ${specificId}`);
            query._id = new mongoose.Types.ObjectId(specificId);
            // Ignore rocketSynced status when force-processing specific ID
        } else {
            query.rocketSynced = { $ne: true };
        }

        const cursor = CategoryModel.find(query).cursor();

        console.log(`Starting processing...`);
        let processed = 0;

        const context = ["Peças de Reposição", "Som e Vídeo", "Acessórios Externos", "Acessórios Internos", "Ferramentas"];
        const parentCache = new Map();

        // Helper to find/create path with Global Slug Uniqueness
        async function ensureParentPath(pathArray) {
            let currentParentId = null;
            let currentAncestors = [];
            let fullSlugPath = "";

            for (const segmentName of pathArray) {
                const segmentSlug = slugify(segmentName);
                if (fullSlugPath) fullSlugPath += "/";
                fullSlugPath += segmentSlug;

                if (parentCache.has(fullSlugPath)) {
                    const cached = parentCache.get(fullSlugPath);
                    currentParentId = cached.id;
                    currentAncestors = [...cached.ancestors, cached.id];
                    continue;
                }

                // Check DB for structural parent (by path logic essentially)
                // We check if a category with this slug exists under the current parent.
                // But wait, slug must be globally unique in Rocket? 
                // If the schema enforces unique slug, we must respect it globally.
                // If we want "Peças de Reposição > Motor", and "Barcos > Motor", they can't both have slug "motor" if index is global unique.
                // Typically Rocket seems to have a global unique constraint on slug based on error "E11000 duplicate key error collection: rocket_db.categories index: slug_1".

                // So we need to find if there is ANY category with this slug.
                // If it exists, does it match our parent?
                // If yes, use it.
                // If no (same slug, different parent), we must create a NEW one with a varied slug (e.g. "motor-1").

                let cat = await CategoryModel.findOne({ slug: segmentSlug });

                // If cat exists but parent doesn't match, we have a collision.
                // If cat exists and parent matches, we found our node.

                let found = false;
                if (cat) {
                    // Check parent match
                    const catParentIdStr = cat.parentId ? String(cat.parentId) : "null";
                    const currentParentIdStr = currentParentId ? String(currentParentId) : "null";

                    if (catParentIdStr === currentParentIdStr) {
                        found = true;
                    }
                }

                if (!found) {
                    // We need to create it OR find the correct one if we used a suffixed slug before?
                    // Actually let's just create/find with slug auto-resolution.

                    // 1. Check if we already created this specific path node but with a different slug?
                    // Hard to know without keeping track. But `parentCache` tracks by logic path.

                    // Create logic:
                    let finalSlug = segmentSlug;
                    let counter = 1;
                    while (await CategoryModel.findOne({ slug: finalSlug })) {
                        // Check if this existing one IS the one we want (same parent)
                        const existing = await CategoryModel.findOne({ slug: finalSlug });
                        const exParentStr = existing.parentId ? String(existing.parentId) : "null";
                        const curParentStr = currentParentId ? String(currentParentId) : "null";

                        if (exParentStr === curParentStr && existing.name === segmentName) {
                            cat = existing;
                            found = true;
                            break;
                        }

                        finalSlug = `${segmentSlug}-${counter}`;
                        counter++;
                    }

                    if (!found) {
                        cat = new CategoryModel({
                            name: segmentName,
                            slug: finalSlug, // Unique
                            parentId: currentParentId,
                            ancestors: currentAncestors,
                            active: true,
                            rocketSynced: true,
                            aiReason: "Structural Parent created by AI Refactor"
                        });
                        await cat.save();
                        console.log(`Created new parent: ${segmentName} (slug: ${finalSlug})`);
                    }
                }

                currentParentId = cat._id;
                currentAncestors = [...(cat.ancestors || []), cat._id];
                parentCache.set(fullSlugPath, { id: cat._id, ancestors: cat.ancestors });
            }

            return { parentId: currentParentId, ancestors: currentAncestors };
        }

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            const meliMapping = doc.marketplaceMappings.find(m => m.externalName);
            if (!meliMapping) continue;

            const meliPath = meliMapping.path || `${meliMapping.externalName}`;
            console.log(`Processing: ${meliPath}`);

            const aiResult = await getRocketPath(model, meliPath, context);

            if (aiResult && aiResult.rocketPath && aiResult.rocketPath.length > 0) {
                const newName = aiResult.rocketPath[aiResult.rocketPath.length - 1];
                const parentPath = aiResult.rocketPath.slice(0, -1);

                try {
                    const { parentId, ancestors } = await ensureParentPath(parentPath);

                    doc.name = newName;
                    doc.parentId = parentId;
                    doc.ancestors = ancestors;

                    doc.synonyms = aiResult.synonyms;
                    doc.usage = aiResult.usage;
                    doc.relevance = aiResult.relevance;
                    doc.attributes = aiResult.attributes;
                    doc.aiReason = aiResult.reason;

                    doc.rocketSynced = true;

                    // Handle slug collision for leaf (Global Uniqueness)
                    const baseSlug = slugify(newName);
                    let finalSlug = baseSlug;
                    let counter = 1;

                    // Check if slug is taken by ANOTHER category
                    while (await CategoryModel.findOne({ _id: { $ne: doc._id }, slug: finalSlug })) {
                        finalSlug = `${baseSlug}-${counter}`;
                        counter++;
                    }
                    doc.slug = finalSlug;

                    await doc.save();
                    console.log(`  -> Updated to: ${aiResult.rocketPath.join(' > ')} (slug: ${finalSlug})`);

                } catch (err) {
                    console.error(`  -> Failed to update ${doc._id}: ${err.message}`);
                }
            } else {
                console.warn(`  -> AI returned invalid result for ${meliPath}`);
            }

            processed++;
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log(`Finished processing ${processed} categories.`);

    } catch (error) {
        console.error('Script failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

run();
