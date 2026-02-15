const fs = require('fs');
const path = require('path');

// Função para corrigir imports em um arquivo
function fixImportsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Corrigir imports que começam com @/
    const importRegex = /import\s+.*\s+from\s+['"]@\/([^'"]+)['"]/g;
    content = content.replace(importRegex, (match, importPath) => {
      modified = true;
      // Calcular caminho relativo
      const relativePath = path.relative(path.dirname(filePath), path.join('src', importPath));
      return match.replace(`@/${importPath}`, relativePath.replace(/\\/g, '/'));
    });

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Corrigido: ${filePath}`);
    }
  } catch (error) {
    console.error(`❌ Erro ao processar ${filePath}:`, error.message);
  }
}

// Função para processar todos os arquivos .ts recursivamente
function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      processDirectory(filePath);
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      fixImportsInFile(filePath);
    }
  }
}

// Processar diretório src
console.log('🔧 Corrigindo imports...');
processDirectory('src');
console.log('✅ Correção de imports concluída!');
