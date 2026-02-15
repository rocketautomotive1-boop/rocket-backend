const mysql = require('mysql2/promise');

async function checkDatabase() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'rocket_marketplace'
  });

  try {
    console.log('🔍 Verificando estrutura do banco de dados...');
    
    // Verificar se a tabela boxes existe
    const [tables] = await connection.execute('SHOW TABLES LIKE "boxes"');
    if (tables.length > 0) {
      console.log('✅ Tabela boxes existe');
      
      // Verificar estrutura da tabela
      const [columns] = await connection.execute('DESCRIBE boxes');
      console.log('📋 Estrutura da tabela boxes:');
      columns.forEach(col => {
        console.log(`  - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${col.Default ? `DEFAULT ${col.Default}` : ''}`);
      });
      
      // Verificar se há dados
      const [rows] = await connection.execute('SELECT COUNT(*) as count FROM boxes');
      console.log(`📊 Total de boxes: ${rows[0].count}`);
      
      if (rows[0].count > 0) {
        const [sampleBoxes] = await connection.execute('SELECT id, code, description FROM boxes LIMIT 5');
        console.log('📦 Exemplos de boxes:');
        sampleBoxes.forEach(box => {
          console.log(`  - ID: ${box.id}, Code: ${box.code}, Description: ${box.description}`);
        });
      }
    } else {
      console.log('❌ Tabela boxes não existe');
    }
    
  } catch (error) {
    console.error('❌ Erro ao verificar banco:', error.message);
  } finally {
    await connection.end();
  }
}

checkDatabase();
