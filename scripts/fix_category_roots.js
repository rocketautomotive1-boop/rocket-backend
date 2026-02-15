const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI;

function slugify(text) {
    return text.toString().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function run() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        const CategorySchema = new mongoose.Schema({
            name: String,
            slug: String,
            parentId: mongoose.Schema.Types.ObjectId,
            ancestors: [mongoose.Schema.Types.ObjectId],
            marketplaceMappings: Array,
            rocketSynced: Boolean,
            active: Boolean,
            aiReason: String
        }, { collection: 'categories' });
        const CategoryModel = mongoose.model('Category', CategorySchema);

        // Nested universe rules
        const UNIVERSE_RULES = [
            { contains: 'Peças Náuticas', targetPath: ['Peças de Reposição', 'Náutica'] },
            { contains: 'Peças de Motos e Quadriciclos', targetPath: ['Peças de Reposição', 'Motos e Quadriciclos'] },
            { contains: 'Acessórios de Linha Pesada', targetPath: ['Peças de Reposição', 'Linha Pesada'] },
            // Generic fallback logic could be added here if needed
        ];

        const parentCache = new Map();

        async function ensurePath(pathArray) {
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

                // Try to find strict match (name + parent) first
                let query = { slug: segmentSlug };
                if (currentParentId) {
                    query.parentId = currentParentId;
                } else {
                    query.parentId = null;
                }

                let cat = await CategoryModel.findOne(query);

                if (!cat) {
                    // Create logic
                    let finalSlug = segmentSlug;
                    let counter = 1;

                    // Check global collision
                    while (await CategoryModel.findOne({ slug: finalSlug })) {
                        // If it's the same category (same parent), we found it.
                        // But query above failed, so we didn't find strictly.
                        // So collision must be different parent.
                        const existing = await CategoryModel.findOne({ slug: finalSlug });
                        // Double check just in case logic is racy
                        if (String(existing.parentId || null) === String(currentParentId || null)) {
                            cat = existing;
                            break;
                        }
                        finalSlug = `${segmentSlug}-${counter}`;
                        counter++;
                    }

                    if (!cat) {
                        cat = new CategoryModel({
                            name: segmentName,
                            slug: finalSlug,
                            parentId: currentParentId,
                            ancestors: currentAncestors,
                            active: true,
                            rocketSynced: true,
                            aiReason: "Structural Parent (Deterministic Fix)"
                        });
                        await cat.save();
                        console.log(`  -> Created structural node: ${segmentName} (${finalSlug})`);
                    }
                }

                currentParentId = cat._id;
                currentAncestors = [...(cat.ancestors || []), cat._id];
                parentCache.set(fullSlugPath, { id: cat._id, ancestors: cat.ancestors });
            }

            return { parentId: currentParentId, ancestors: currentAncestors };
        }

        const cursor = CategoryModel.find({
            rocketSynced: true,
            "marketplaceMappings.0": { $exists: true }
        }).cursor();

        let processed = 0;
        let moved = 0;

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            processed++;
            const meliMapping = doc.marketplaceMappings.find(m => m.externalName);
            if (!meliMapping) continue;

            const meliPath = meliMapping.path || meliMapping.externalName;

            let matchedRule = null;
            for (const rule of UNIVERSE_RULES) {
                if (meliPath.includes(rule.contains)) {
                    matchedRule = rule;
                    break;
                }
            }

            if (matchedRule) {
                if (doc.ancestors && doc.ancestors.length > 0) {
                    const ancestorDocs = await CategoryModel.find({ _id: { $in: doc.ancestors } }).lean();
                    ancestorDocs.sort((a, b) => (a.ancestors?.length || 0) - (b.ancestors?.length || 0));

                    const ancestorNames = ancestorDocs.map(a => a.name);

                    // Filter out generic roots to avoid "Peças de Reposição > Peças de Reposição"
                    const currentRootName = ancestorNames[0];
                    let suffixPath = ancestorNames;

                    if (["Peças de Reposição", "Acessórios", "Ferramentas", "Peças Náuticas", "Peças de Motos e Quadriciclos", "Linha Pesada", "Peças de Carros e Caminhonetes"].includes(currentRootName)) {
                        suffixPath = ancestorNames.slice(1);
                    }

                    // Build new path: Target + (Original - Root)
                    const newPathNames = [...matchedRule.targetPath, ...suffixPath];

                    // Exiting parents + New Target Parents
                    const { parentId, ancestors } = await ensurePath(newPathNames);

                    if (String(parentId) !== String(doc.parentId)) {
                        doc.parentId = parentId;
                        doc.ancestors = ancestors;
                        await doc.save();
                        console.log(`Moved "${doc.name}" to "${newPathNames.join(' > ')}"`);
                        moved++;
                    }
                }
            }
        }

        console.log(`Fix Complete. Processed: ${processed}, Moved: ${moved}`);

    } catch (error) {
        console.error('Script failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

run();
