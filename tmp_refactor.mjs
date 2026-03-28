import fs from 'fs';

let content = fs.readFileSync('c:/Users/cheun/Desktop/Lucas/Antigravity_workspaces/GeoHunterGit/app/routes/admin.mass-add.tsx', 'utf8');

const targetIdx = content.indexOf('export function EditModal(');
if (targetIdx === -1) {
    console.error("Could not find EditModal");
    process.exit(1);
}

const beforeEditModal = content.substring(0, targetIdx);
let editModalString = content.substring(targetIdx);

// 1. Rename to LocationEditorCard and switch props
editModalString = editModalString.replace(
    /export function EditModal\(\{ editingId, files, setFiles, setEditingId, isLoaded, mapSets, onSave \}: any\) \{/,
    `export function LocationEditorCard({ id, item, index, files, setFiles, isLoaded, mapSets, onSave }: any) {`
);

// 2. Remove editingId checks and early returns
editModalString = editModalString.replace('    if (editingId === null) return null;\r\n', '');
editModalString = editModalString.replace('    const item = files[editingId];\r\n', '');
editModalString = editModalString.replace('if (editingId === null) return null;\r\n', '');
editModalString = editModalString.replace('const item = files[editingId];\r\n', '');
editModalString = editModalString.replace('    if (editingId === null) return null;\n', '');
editModalString = editModalString.replace('    const item = files[editingId];\n', '');
editModalString = editModalString.replace('if (editingId === null) return null;\n', '');
editModalString = editModalString.replace('const item = files[editingId];\n', '');

// 3. Replace all state updates that use editingId MUST ALWAYS NOT USE REPLACE ALL BLINDLY. We must protect against setEditingId.
let wordsToReplace = ['editingId'];
for (const word of wordsToReplace) {
    // editingId followed by anything except letters
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    editModalString = editModalString.replace(regex, 'index');
}

// 4. Update the outer wrapper
const outerMatchString = '<div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center overflow-hidden">\r\n                <div className="bg-gray-900 rounded-2xl w-full h-[95vh] mx-4 max-w-[98vw] flex flex-col border border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)]">';
const outerMatchFallback = '<div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center overflow-hidden">\n                <div className="bg-gray-900 rounded-2xl w-full h-[95vh] mx-4 max-w-[98vw] flex flex-col border border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)]">';
let toReplace = `<div id={id} className={\`relative z-10 flex flex-col items-center justify-center shrink-0 transition-all snap-center h-full \${isEvidenceFullscreen ? 'fixed inset-0 z-[120] w-full p-4 bg-gray-950/90' : 'w-[900px] pb-4 px-2'}\`}>
        <div className={\`bg-gray-900 rounded-3xl w-full flex flex-col transition-all overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.5)] h-full min-h-0 \${item.status === 'saved' ? 'border-4 border-emerald-500/50 opacity-60 hover:opacity-100 grayscale-[0.3]' : 'border-2 border-gray-800'}\`}>
`;

if (editModalString.indexOf(outerMatchString) !== -1) {
    editModalString = editModalString.replace(outerMatchString, toReplace);
} else if (editModalString.indexOf(outerMatchFallback) !== -1) {
    editModalString = editModalString.replace(outerMatchFallback, toReplace);
}

// Strip fixed inset-0 from the child panel
editModalString = editModalString.replace(
    "className={`flex-1 overflow-y-auto p-8 custom-scrollbar bg-gray-900/30 transition-all ${isEvidenceFullscreen ? 'fixed inset-0 z-[60] bg-gray-950 p-0' : ''}`}",
    "className={`flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar bg-gray-900/40 transition-all overflow-x-hidden ${isEvidenceFullscreen ? 'bg-gray-950 p-0' : ''}`}"
);

// 5. Remove Exit button
const exitBtn1 = '<button onClick={() => setEditingId(null)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-bold border border-gray-700 text-xs uppercase tracking-widest">\r\n                                Exit\r\n                            </button>';
const exitBtn2 = '<button onClick={() => setEditingId(null)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-bold border border-gray-700 text-xs uppercase tracking-widest">\n                                Exit\n                            </button>';
const delBtn = `<button onClick={() => setFiles((prev: any[]) => prev.filter((_: any, i: number) => i !== index))} className="px-5 py-2 bg-red-900/20 hover:bg-red-600 rounded-lg text-red-300 font-bold border border-red-700/50 text-xs uppercase tracking-widest transition-all shadow-md active:scale-95">
                                Delete Option
                            </button>`;
if (editModalString.indexOf(exitBtn1) !== -1) {
    editModalString = editModalString.replace(exitBtn1, delBtn);
} else if (editModalString.indexOf(exitBtn2) !== -1) {
    editModalString = editModalString.replace(exitBtn2, delBtn);
}

// Remove PREV NEXT
const navStringR = '{/* Navigation */}\r\n                            <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">\r\n                                <button\r\n                                    onClick={() => setEditingId(Math.max(0, index - 1))}\r\n                                    disabled={index === 0}\r\n                                    className="px-3 py-1.5 hover:bg-gray-700 disabled:opacity-20 text-xs font-bold border-r border-gray-700 transition-colors"\r\n                                >\r\n                                    ← PREV\r\n                                </button>\r\n                                <span className="px-3 py-1.5 text-[10px] font-mono text-gray-400">\r\n                                    {index + 1} / {files.length}\r\n                                </span>\r\n                                <button\r\n                                    onClick={() => setEditingId(Math.min(files.length - 1, index + 1))}\r\n                                    disabled={index === files.length - 1}\r\n                                    className="px-3 py-1.5 hover:bg-gray-700 disabled:opacity-20 text-xs font-bold transition-colors"\r\n                                >\r\n                                    NEXT →\r\n                                </button>\r\n                            </div>';

const navStringN = '{/* Navigation */}\n                            <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">\n                                <button\n                                    onClick={() => setEditingId(Math.max(0, index - 1))}\n                                    disabled={index === 0}\n                                    className="px-3 py-1.5 hover:bg-gray-700 disabled:opacity-20 text-xs font-bold border-r border-gray-700 transition-colors"\n                                >\n                                    ← PREV\n                                </button>\n                                <span className="px-3 py-1.5 text-[10px] font-mono text-gray-400">\n                                    {index + 1} / {files.length}\n                                </span>\n                                <button\n                                    onClick={() => setEditingId(Math.min(files.length - 1, index + 1))}\n                                    disabled={index === files.length - 1}\n                                    className="px-3 py-1.5 hover:bg-gray-700 disabled:opacity-20 text-xs font-bold transition-colors"\n                                >\n                                    NEXT →\n                                </button>\n                            </div>';
if (editModalString.indexOf(navStringR) !== -1) {
    editModalString = editModalString.replace(navStringR, '');
} else if (editModalString.indexOf(navStringN) !== -1) {
    editModalString = editModalString.replace(navStringN, '');
}

// Clean up any rogue setEditingId calls inside LocationEditorCard
// Because we used string replace strictly, we didn't touch other setEditingIds.
// Wait! `onClick={() => setEditingId(null)}` was the only one? What about `setEditingId(prev => ...)`?
// We stripped out the Navigation div which contained the other two! So zero setEditingId calls remain.


// 7. Change Save button text
editModalString = editModalString.replace(
    `{isSaving ? "SAVING..." : "💾 Save"}`,
    `{isSaving ? "SAVING..." : item.status === 'saved' ? "✅ RE-SAVE" : "💾 SAVE & COMPLETE"}`
);

// We need to restore `setFiles` back to `setEditingId` for the exit button (since step 3 blindly replaced editingId -> index and setEditingId -> setFiles for some reason if there was a regex problem. Wait, `editingId` replacement using boundary \\b is totally safe!)


// Write workspace definition EXACTLY
const workspaceDefinition = 
'export function MultiEditWorkspace({ editingId, files, setFiles, setEditingId, isLoaded, mapSets, onSave }: any) {\n' +
'    if (editingId === null) return null;\n' +
'\n' +
'    useEffect(() => {\n' +
"        document.body.style.overflow = 'hidden';\n" +
"        return () => { document.body.style.overflow = ''; };\n" +
'    }, []);\n' +
'\n' +
'    useEffect(() => {\n' +
"        if (typeof editingId === 'number' && editingId >= 0 && editingId < files.length) {\n" +
"            const el = document.getElementById(`editor-card-${editingId}`);\n" +
"            if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center' });\n" +
'        }\n' +
'    }, [editingId, files.length]);\n' +
'\n' +
'    return (\n' +
'        <div className="fixed inset-0 bg-gray-950/95 backdrop-blur-md z-[100] flex flex-col h-screen overflow-hidden animate-in fade-in zoom-in-95 duration-200">\n' +
'            <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900 shadow-2xl shrink-0 z-10 w-full">\n' +
'                <div className="flex items-center gap-4">\n' +
'                    <h2 className="text-xl font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">\n' +
'                        <span>🚀</span> Workspace Editor\n' +
'                    </h2>\n' +
'                    <span className="px-3 py-1 bg-gray-800 rounded-full text-xs font-bold font-mono text-emerald-300 border border-emerald-500/30">\n' +
"                        {files.filter((f: any) => f.status !== 'saved').length} Pending\n" +
'                    </span>\n' +
"                    {files.filter((f: any) => f.status === 'saved').length > 0 && (\n" +
'                        <span className="px-3 py-1 bg-emerald-900/40 rounded-full text-xs font-bold font-mono text-emerald-400 border border-emerald-500/30">\n' +
"                            {files.filter((f: any) => f.status === 'saved').length} Saved\n" +
'                        </span>\n' +
'                    )}\n' +
'                </div>\n' +
'                <button onClick={() => setEditingId(null)} className="px-6 py-2 bg-gray-800 hover:bg-emerald-600 hover:text-white rounded-xl text-gray-400 font-bold border border-gray-700 text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95">\n' +
'                    Return to Grid ✕\n' +
'                </button>\n' +
'            </div>\n' +
'            <div className="flex-1 overflow-x-auto overflow-y-hidden p-6 custom-scrollbar relative bg-gray-950 h-full flex flex-col">\n' +
'                <div className="flex flex-row items-stretch gap-6 px-6 pb-2 w-max snap-x snap-mandatory h-full min-h-[400px] flex-1">\n' +
'                    {files.map((file: any, idx: number) => {\n' +
"                        if (editingId !== 'all' && editingId !== idx) return null;\n" +
'                        return (\n' +
'                            <LocationEditorCard \n' +
'                                key={file.id} \n' +
"                                id={`editor-card-${idx}`}\n" +
'                                item={file} \n' +
'                                index={idx} \n' +
'                                files={files} \n' +
'                                setFiles={setFiles} \n' +
'                                isLoaded={isLoaded} \n' +
'                                mapSets={mapSets} \n' +
'                                onSave={onSave} \n' +
'                            />\n' +
'                        );\n' +
'                    })}\n' +
'                    {files.length === 0 && (\n' +
'                        <div className="text-center w-full mx-auto text-gray-500 mt-32 space-y-4">\n' +
'                            <h3 className="text-2xl font-bold text-gray-300">All caught up! 🎉</h3>\n' +
'                            <button onClick={() => setEditingId(null)} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-bold transition-colors">\n' +
'                                Go Back\n' +
'                            </button>\n' +
'                        </div>\n' +
'                    )}\n' +
'                </div>\n' +
'            </div>\n' +
'        </div>\n' +
'    );\n' +
'}\n\n';

let newContent = beforeEditModal + workspaceDefinition + editModalString;

// 1. Swap EditModal with MultiEditWorkspace in the original component
newContent = newContent.replace(
    `<EditModal editingId={editingId} files={files} setFiles={setFiles} setEditingId={setEditingId} isLoaded={isLoaded} mapSets={mapSets} onSave={saveLocation} />`,
    `<MultiEditWorkspace editingId={editingId} files={files} setFiles={setFiles} setEditingId={setEditingId} isLoaded={isLoaded} mapSets={mapSets} onSave={saveLocation} />`
);

// 2. Change `editingId` to accept `'all'`
newContent = newContent.replace(
    `const [editingId, setEditingId] = useState<number | null>(null);`,
    `const [editingId, setEditingId] = useState<number | 'all' | null>(null);`
);

// 3. Update saveLocation to change status to 'saved' instead of removing
newContent = newContent.replace(
    `setFiles(prev => prev.filter((_, i) => i !== index));`,
    `setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'saved' } : f));`
);
newContent = newContent.replace(
    `setEditingId(null);`,
    `// setEditingId(null); // Let them clear manually or continue editing`
);

// 4. Grid Add 'Edit All' and 'Clear Completed' header buttons
const headerSearchArea = '<div className="flex-1 max-w-xl">\r\n                        <p className="text-sm text-gray-400 mb-2">';
const headerSearchAreaFallback = '<div className="flex-1 max-w-xl">\n                        <p className="text-sm text-gray-400 mb-2">';
let hdrReplace = `<div className="flex-1 max-w-xl flex gap-4">
            <button 
                onClick={() => setEditingId('all')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg whitespace-nowrap shadow-lg active:scale-95 transition-all flex items-center gap-2"
                disabled={files.length === 0}
            >
                🚀 EDIT ALL LOCATIONS
            </button>
            {files.some(f => f.status === 'saved') && (
                <button 
                    onClick={() => setFiles(prev => prev.filter(f => f.status !== 'saved'))}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 hover:text-red-400 rounded-lg text-sm text-gray-300 flex items-center gap-2 border border-gray-700 transition-colors whitespace-nowrap"
                >
                    Clear Completed
                </button>
            )}
        </div>
        <div className="flex-1 max-w-xl">
            <p className="text-sm text-gray-400 mb-2">`;
if (newContent.indexOf(headerSearchArea) !== -1) {
    newContent = newContent.replace(headerSearchArea, hdrReplace);
} else {
    newContent = newContent.replace(headerSearchAreaFallback, hdrReplace);
}

// 5. Update Grid item mapping to visually show deployed status
const gridItemStartMatch = '                {files.map((file, idx) => (\r\n                    <div key={file.id} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col">\r\n                        <div className="relative h-48 bg-gray-800">\r\n                            <img src={file.preview} className="w-full h-full object-cover opacity-80" />\r\n                            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">\r\n                                {file.lat ? (';
const gridItemStartMatchFallback = '                {files.map((file, idx) => (\n                    <div key={file.id} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col">\n                        <div className="relative h-48 bg-gray-800">\n                            <img src={file.preview} className="w-full h-full object-cover opacity-80" />\n                            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">\n                                {file.lat ? (';

const gridItemReplacement = `                {files.map((file, idx) => (
                    <div key={file.id} className={\`bg-gray-900 border rounded-lg overflow-hidden flex flex-col transition-all \${file.status === 'saved' ? 'border-emerald-500 scale-[0.98] opacity-80' : 'border-gray-800'}\`}>
                        <div className="relative h-48 bg-gray-800">
                            <img src={file.preview} className="w-full h-full object-cover opacity-80" />
                            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                                {file.status === 'saved' && (
                                    <span className="bg-emerald-600 text-white font-black text-xs px-2 py-1 rounded shadow-lg uppercase tracking-widest border border-emerald-400 mb-1">
                                        ✅ DEPLOYED
                                    </span>
                                )}
                                {file.lat ? (`
if (newContent.indexOf(gridItemStartMatch) !== -1) {
    newContent = newContent.replace(gridItemStartMatch, gridItemReplacement);
} else {
    newContent = newContent.replace(gridItemStartMatchFallback, gridItemReplacement);
}

// 6. Grid item default Save button change text
const saveBtnInnerMatch = '<button\r\n                                    onClick={() => saveLocation(idx)}\r\n                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm text-white"\r\n                                >\r\n                                    Save\r\n                                </button>';
const saveBtnInnerMatchFallback = '<button\n                                    onClick={() => saveLocation(idx)}\n                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm text-white"\n                                >\n                                    Save\n                                </button>';
const saveBtnRep = `<button
                                    onClick={() => saveLocation(idx)}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm text-white font-bold"
                                >
                                    {file.status === 'saved' ? 'Re-Save' : 'Save'}
                                </button>`;
if (newContent.indexOf(saveBtnInnerMatch) !== -1) {
    newContent = newContent.replace(saveBtnInnerMatch, saveBtnRep);
} else {
    newContent = newContent.replace(saveBtnInnerMatchFallback, saveBtnRep);
}

fs.writeFileSync('c:/Users/cheun/Desktop/Lucas/Antigravity_workspaces/GeoHunterGit/app/routes/admin.mass-add.tsx', newContent, 'utf8');
console.log('REFACTOR SUCCESS!');
