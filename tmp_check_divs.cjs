const fs = require('fs');
const code = fs.readFileSync('app/routes/admin.mass-add.tsx', 'utf8');
const lines = code.split('\n');

let divCount = 0;
// We know EditModal starts at line 427 (index 426)
let startLine = 426;

console.log("Starting balance check from line " + (startLine + 1));

for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    
    // Count opening divs
    const openMatches = line.match(/<div/g);
    if (openMatches) {
        divCount += openMatches.length;
    }
    
    // Count closing divs
    const closeMatches = line.match(/<\/div/g);
    if (closeMatches) {
        divCount -= closeMatches.length;
    }
    
    // Print the line and current balance if it has a div tag
    if (openMatches || closeMatches) {
        console.log(`Line ${i + 1} | Balance: ${divCount} | ${line.trim()}`);
    }
    
    // If we hit 0 balance after opening the first one, we've found the end of the root div
    if (divCount === 0 && closeMatches && i > startLine) {
        console.log(`\n=> ROOT MODAL CLOSED at line ${i + 1}`);
        break;
    }
}

// In EditModal, the return statement ends around line 980-990.
// If the balance doesn't reach 0 by then, we have an unclosed tag.
if (divCount > 0) {
    console.log(`\n=> END OF FILE REACHED. Unclosed divs: ${divCount}`);
} else if (divCount < 0) {
    console.log(`\n=> END OF FILE REACHED. Extra closing divs: ${Math.abs(divCount)}`);
}
