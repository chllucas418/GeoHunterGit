const fs = require('fs');
const file = 'c:/Users/cheun/Desktop/Lucas/Antigravity_workspaces/GeoHunterGit/app/routes/admin.mass-add.tsx';
let content = fs.readFileSync(file, 'utf8');

const startIndex = content.indexOf('    // Edit Modal rendering');
if (startIndex !== -1) {
    const fnStart = content.indexOf('{', startIndex);

    // Find matching closing brace
    let braceCount = 1;
    let endIndex = fnStart + 1;
    while (braceCount > 0 && endIndex < content.length) {
        if (content[endIndex] === '{') braceCount++;
        if (content[endIndex] === '}') braceCount--;
        endIndex++;
    }

    const modalBodyFull = content.substring(startIndex, endIndex);
    const bodyInside = content.substring(content.indexOf('        // Local state for evidence', fnStart), endIndex - 1);

    const newComponent = `
export function EditModal({ editingId, files, setFiles, setEditingId, isLoaded, mapSets }: any) {
    if (editingId === null) return null;
    const item = files[editingId];

${bodyInside}
}
`;

    content = content.replace(modalBodyFull, '');
    content = content.replace('{renderEditModal()}', '<EditModal editingId={editingId} files={files} setFiles={setFiles} setEditingId={setEditingId} isLoaded={isLoaded} mapSets={mapSets} />');
    content += '\n' + newComponent;

    fs.writeFileSync(file, content);
    console.log("Refactored successfully.");
} else {
    console.log("Could not find start index");
}
