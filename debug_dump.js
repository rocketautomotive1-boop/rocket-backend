const fs = require('fs');
const path = 'c:/Users/gusta/Documents/Projetos/rocket/marketplace-integration/tecdoc_click_fail_dump.html';
try {
    const content = fs.readFileSync(path, 'utf8');
    const rowIdx = content.indexOf('row-index="0"');
    if (rowIdx >= 0) {
        console.log('--- FOUND ROW 0 ---');
        // Extract 4000 chars to ensure we cover the row content
        const snippet = content.substring(rowIdx, rowIdx + 4000);
        fs.writeFileSync('c:/Users/gusta/Documents/Projetos/rocket/marketplace-integration/debug_snippet.html', snippet);
        console.log('Snippet written to debug_snippet.html');
    } else {
        console.log('Row 0 NOT FOUND');
    }
} catch (e) {
    console.error(e);
}
