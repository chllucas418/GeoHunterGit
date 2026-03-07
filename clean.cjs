const fs = require('fs');
const file = 'c:/Users/cheun/Desktop/Lucas/Antigravity_workspaces/GeoHunterGit/app/routes/admin.mass-add.tsx';
let content = fs.readFileSync(file, 'utf8');

// The file has a duplicate return statement at the bottom because of the git conflict.
// Look for lines 586 to the end and just remove them.
const conflictStart = content.indexOf('<<<<<<< Updated upstream');
if (conflictStart !== -1) {
    console.log("Found conflict start at " + conflictStart);
    // The first return is correct, we just need to cap off the MassAdd function.
    content = content.substring(0, conflictStart) + '}\n';
}

// Now extract renderEditModal.
const modalStartStr = '    // Edit Modal rendering';
const startIndex = content.indexOf(modalStartStr);

if (startIndex !== -1) {
    const fnStart = content.indexOf('{', startIndex);
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

    // Replace {renderEditModal()} with <EditModal ... />
    // Note: Since renderEditModal was a function call, we might have multiple
    content = content.replace('{renderEditModal()}', '<EditModal editingId={editingId} files={files} setFiles={setFiles} setEditingId={setEditingId} isLoaded={isLoaded} mapSets={mapSets} />');

    // Add EditModal to the end
    content += '\n' + newComponent;

    fs.writeFileSync(file, content);
    console.log("Refactored and cleaned successfully.");
} else {
    console.log("Could not find Edit Modal rendering comments. Maybe already extracted?");
    // If it's already extracted, just save the file after removing conflict markers
    fs.writeFileSync(file, content);
    console.log("Saved without extracting EditModal.");
}
