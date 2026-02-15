const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'tecdoc_detail_missing_data.html');
const content = fs.readFileSync(filePath, 'utf8');
const outputPath = path.join(__dirname, 'debug_output_missing.txt');

let output = '';

function logContext(searchStr) {
    let index = 0;
    let count = 0;
    output += `\n\n=== Searching for: "${searchStr}" ===\n`;
    while ((index = content.indexOf(searchStr, index)) !== -1) {
        count++;
        // Look AROUND the match
        const start = Math.max(0, index - 300);
        const end = Math.min(content.length, index + 1000);
        output += `\n--- MATCH #${count} ---\n`;
        output += content.substring(start, end);
        index += searchStr.length;
        if (count >= 5) break;
    }
    if (count === 0) output += 'No matches found.\n';
}

// Search for Linkages content structure
logContext('part-detail-v2-linkages-tab');
logContext('linkage-row');
logContext('manufacturer-link');
logContext('model-series-link');
// Look for list items or rows inside the tab
logContext('<tr');
logContext('<li');

fs.writeFileSync(outputPath, output);
console.log('Debug output deep-links written.');
