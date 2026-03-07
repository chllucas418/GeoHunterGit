const fs = require('fs');
const file = 'c:/Users/cheun/Desktop/Lucas/Antigravity_workspaces/GeoHunterGit/app/routes/admin.mass-add.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace setFiles(prev => with setFiles((prev: any[]) =>
content = content.replace(/setFiles\(prev =>/g, 'setFiles((prev: any[]) =>');

fs.writeFileSync(file, content);
console.log('Fixed implicit any types for prev.');
