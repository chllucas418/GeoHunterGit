const fs = require('fs');
const filePath = 'c:\\Users\\cheun\\Desktop\\Lucas\\Antigravity_workspaces\\GeoHunterGit\\app\\routes\\admin.mass-add.tsx';

let content = fs.readFileSync(filePath, 'utf8');

const modalStart = content.indexOf(`export function EditModal({ editingId, files, setFiles, setEditingId, isLoaded, mapSets, onSave }: any) {`);

if (modalStart === -1) {
    console.error("Could not find EditModal");
    process.exit(1);
}

// Extract the original function correctly
const modalEndPattern = /\n    \);\n}\n/g;
modalEndPattern.lastIndex = modalStart;
const endMatch = modalEndPattern.exec(content);

if (!endMatch) {
    console.error("Could not find end of EditModal");
    process.exit(1);
}
const modalEnd = endMatch.index + endMatch[0].length;
const originalEditModalCode = content.substring(modalStart, modalEnd);

// Modify the EditModal content into SingleLocationEditor
let singleEditorCode = originalEditModalCode
    .replace(
        "export function EditModal({ editingId, files, setFiles, setEditingId, isLoaded, mapSets, onSave }: any) {",
        "export function SingleLocationEditor({ item, idx: editingId, files, setFiles, isLoaded, mapSets, onSave, isMulti }: any) {"
    )
    .replace("if (editingId === null) return null;\n    const item = files[editingId];", "if (!item) return null;")
    .replace('<div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center overflow-hidden">', '')
    .replace(
        '<div className="bg-gray-900 rounded-2xl w-full h-[95vh] mx-4 max-w-[98vw] flex flex-col border border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)]">',
        '<div className={isMulti ? "relative w-full h-[85vh] shrink-0 mb-8 bg-gray-900 rounded-2xl flex flex-col border border-gray-700 shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden" : "bg-gray-900 rounded-2xl w-full h-[95vh] mx-4 max-w-[98vw] flex flex-col border border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden"}>'
    );

// Replace the header to remove prev/next and the exit button if isMulti is true
singleEditorCode = singleEditorCode.replace(
    /<div className="flex items-center gap-6">[\s\S]*?<\/div>\s*<\/div>/,
    `<div className="flex items-center gap-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <span className="p-1.5 bg-blue-600/20 rounded-lg text-blue-400">#{editingId + 1}</span>
                            <span className="text-blue-400 font-mono ml-2">{item.file?.name || item.photographer || "Unnamed"}</span>
                        </h2>
                    </div>`
);

// Remove the standalone Exit button inside the inner modal
singleEditorCode = singleEditorCode.replace(
    `<button onClick={() => setEditingId(null)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-bold border border-gray-700 text-xs uppercase tracking-widest">\n                            Exit\n                        </button>`,
    ""
);

// Remove the two inner closing divs from the very end of the SingleLocationEditor
// Original ends with:
//                 </div>
//             </div>
//         </div>
//     );
// }
singleEditorCode = singleEditorCode.replace(
    /\s*<\/div>\n\s*<\/div>\n\s*\);\n}/,
    `\n            </div>\n        );\n}`
);


const newEditModalCode = `
export function EditModal({ editingId, files, setFiles, setEditingId, isLoaded, mapSets, onSave }: any) {
    if (editingId === null) return null;

    const renderMode = editingId === 'all' ? 'all' : 'single';
    const activeFiles = renderMode === 'all' 
        ? files.map((f: any, i: number) => ({...f, __idx: i})) 
        : [{...files[editingId], __idx: editingId}];

    return (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center px-4 pt-24 pb-8 overflow-hidden">
            <div className="fixed top-0 left-0 right-0 bg-gray-900/95 backdrop-blur-md border-b border-gray-800 z-[60] p-4 flex justify-between items-center shadow-2xl">
                <div className="flex items-center gap-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <span className="p-1.5 bg-blue-600/20 rounded-lg text-blue-400">🚀</span>
                        {renderMode === 'all' ? \`Editing \${files.length} Locations Concurrently\` : \`Edit Location: \${activeFiles[0]?.file?.name || activeFiles[0]?.photographer || "Unnamed"}\`}
                    </h2>
                    {renderMode !== 'all' && (
                        <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 overflow-hidden shadow-inner">
                            <button
                                onClick={() => setEditingId(Math.max(0, editingId - 1))}
                                disabled={editingId === 0}
                                className="px-4 py-2 hover:bg-gray-700 disabled:opacity-20 text-xs font-bold border-r border-gray-700 transition-colors"
                            >
                                ← PREV
                            </button>
                            <span className="px-4 py-2 text-xs font-mono text-gray-400 bg-black/20">
                                {editingId + 1} / {files.length}
                            </span>
                            <button
                                onClick={() => setEditingId(Math.min(files.length - 1, editingId + 1))}
                                disabled={editingId === files.length - 1}
                                className="px-4 py-2 hover:bg-gray-700 disabled:opacity-20 text-xs font-bold transition-colors"
                            >
                                NEXT →
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    <button onClick={() => setEditingId(null)} className="px-6 py-2 bg-red-600/20 hover:bg-red-600 hover:text-white rounded-lg text-red-400 font-black border border-red-500/50 text-xs uppercase tracking-widest shadow-lg transition-all active:scale-95 flex items-center gap-2">
                        <span>×</span> Exit Editor
                    </button>
                </div>
            </div>

            <div className="w-full flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-10 max-w-[98vw] rounded-xl">
                {activeFiles.map((file: any) => (
                    <SingleLocationEditor 
                        key={file.id} 
                        item={file} 
                        idx={file.__idx} 
                        files={files} 
                        setFiles={setFiles} 
                        isLoaded={isLoaded} 
                        mapSets={mapSets} 
                        onSave={onSave}
                        isMulti={renderMode === 'all'}
                    />
                ))}
            </div>
        </div>
    );
}
`;

const newContent = content.substring(0, modalStart) + singleEditorCode + "\n\n" + newEditModalCode + content.substring(modalEnd);
fs.writeFileSync(filePath, newContent);
console.log("Successfully refactored EditModal into MultiEditModal and SingleLocationEditor.");
