import { useState, useRef, useEffect, useMemo, memo } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useSubmit, useNavigation, useLoaderData, useNavigate, Link } from 'react-router';
import { useDropzone } from 'react-dropzone';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { EvidenceCanvas } from '~/components/EvidenceCanvas';
import { ClassroomImportModal } from '~/components/ClassroomImportModal';
import JSZip from 'jszip';
import type { BoxCoordinates } from '~/types/shared';
import { requireTeacher } from '~/lib/auth.server';
// pdfjs-dist dynamically imported client-side to prevent SSR DOMMatrix errors




export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireTeacher(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const { results: mapSets } = await db.prepare("SELECT id, name FROM map_sets ORDER BY created_at DESC").all<any>();
    
    // Load existing draft
    const draftRow = await db.prepare("SELECT draft_data FROM mass_add_drafts WHERE id = 'global'").first<any>();
    const draft = draftRow ? JSON.parse(draftRow.draft_data) : null;

    return {
        mapsApiKey: env.GOOGLE_MAPS_API_KEY,
        googleDriveApiKey: env.GOOGLE_DRIVE_API_KEY,
        googleDriveClientId: env.GOOGLE_DRIVE_CLIENT_ID,
        mapSets,
        draft
    };
}

// Google Maps Libraries
const LIBRARIES: ("places" | "maps" | "marker")[] = ["places", "maps", "marker"];

// Client Component
export default function MassAdd() {
    const { mapsApiKey, googleDriveApiKey, googleDriveClientId, mapSets, draft } = useLoaderData<typeof loader>();
    const [files, setFiles] = useState<any[]>(draft || []);
    const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());
    const [editingId, setEditingId] = useState<number | 'all' | null>(null); // Index of file being edited
    const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'idle'>(draft ? 'synced' : 'idle');
    const [extractionQueue, setExtractionQueue] = useState<{name: string, items: {blob: Blob, url: string, name: string}[]}[]>([]);


    // Auto-prompt developer to add map evidence
    useEffect(() => {
        if (files.length === 0 || analyzingIds.size > 0 || editingId !== null) return;
        // Find first file that has AI desc but no evidence and hasn't been prompted
        const indexToPrompt = files.findIndex(f => f.description !== "" && f.evidence.length === 0 && !f.prompted);
        if (indexToPrompt !== -1) {
            setEditingId(indexToPrompt);
            setFiles((prev: any[]) => {
                const cp = [...prev];
                if (cp[indexToPrompt]) cp[indexToPrompt].prompted = true;
                return cp;
            });
        }
    }, [files, analyzingIds, editingId]);

    // Sync to Cloud Effect (Debounced)
    useEffect(() => {
        // We sync even if empty now to allow clearing drafts cross-device
        setSyncStatus('syncing');
        
        const timer = setTimeout(async () => {
            try {
                // Strip File objects which are not serializable
                const draftData = files.map(f => {
                    const { file, preview, ...rest } = f;
                    // If preview is a local blob URL, it's useless for sync
                    const safePreview = preview?.startsWith('http') ? preview : null;
                    return { ...rest, preview: safePreview };
                });
                
                const formData = new FormData();
                formData.append('intent', 'save_draft');
                formData.append('draft_data', JSON.stringify(draftData));
                
                const res = await fetch('/api/admin/mass-add', { method: 'POST', body: formData });
                if (res.ok) {
                    setSyncStatus('synced');
                                    } else {
                    setSyncStatus('error');
                }
            } catch (err) {
                console.error("Draft sync failed", err);
                setSyncStatus('error');
            }
        }, 1500); // 1.5 second debounce
        
        return () => clearTimeout(timer);
    }, [files]);

    const navigation = useNavigation();

    // Map Setup
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: mapsApiKey || "",
        libraries: LIBRARIES
    });

    const analyzeFile = async (fileId: number, fileObj: File) => {
        setAnalyzingIds(prev => new Set(prev).add(fileId));

        const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
            if (!file) {
                reject(new Error("No file to convert"));
                return;
            }
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
        });

        try {
            const formData = new FormData();
            formData.append('intent', 'analyze');
            
            const fileItem = files.find(f => f.id === fileId);
            if (!fileItem) throw new Error("File item not found");

            if (fileItem.preview && fileItem.preview.startsWith('http')) {
                formData.append('image_url', fileItem.preview);
            } else if (fileObj) {
                const dataUri = await toBase64(fileObj);
                formData.append('image_data', dataUri);
            } else {
                throw new Error("No valid image data or URL found for analysis");
            }

            // Send location data and evidence if available
            if (fileItem.lat && fileItem.lng) {
                formData.append('lat', String(fileItem.lat));
                formData.append('lng', String(fileItem.lng));
            }
            if (fileItem && fileItem.evidence && fileItem.evidence.length > 0) {
                formData.append('evidence', JSON.stringify(fileItem.evidence));
            }

            const res = await fetch('/api/admin/mass-add', { method: 'POST', body: formData });
                        const contentType = res.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const data = (await res.json()) as { success: boolean, aiData?: any, error?: string };
                                if (data.success && data.aiData) {
                    setFiles((prev: any[]) => prev.map(f => {
                        if (f.id === fileId) {
                            return {
                                ...f,
                                description: data.aiData.precontext || data.aiData.description || "",
                                difficulty: data.aiData.difficulty_rating || 5,
                                hints: Array.isArray(data.aiData.generated_hints) ? data.aiData.generated_hints :
                                    Array.isArray(data.aiData.hints) ? data.aiData.hints :
                                        ["", "", ""],
                                hint_pins: Array.isArray(data.aiData.hint_pins) ? data.aiData.hint_pins : [],
                                status: f.lat ? 'reviewed' : 'needs_gps'
                            };
                        }
                        return f;
                    }));
                } else if (data.error) {
                    throw new Error(data.error);
                }
            } else {
                const text = await res.text();
                throw new Error(`Server returned non-JSON response: ${res.status} ${res.statusText}. Response text partial: ${text.substring(0, 100)}`);
            }

        } catch (e) {
            console.error("AI Failed for", fileObj.name, e);
        } finally {
            setAnalyzingIds(prev => {
                const next = new Set(prev);
                next.delete(fileId);
                return next;
            });
        }
    };

    const addToFileList = async (file: File) => {
        const id = Date.now() + Math.random();
        
        // Preliminary item
        const newItem: any = {
            id,
            file,
            preview: URL.createObjectURL(file),
            lat: null,
            lng: null,
            photographer: file.name.split('.')[0],
            description: "",
            difficulty: 5,
            hints: ["", "", ""],
            hint_pins: [],
            evidence: [],
            addToSet: "",
            status: 'extracting',
            prompted: false
        };

        setFiles(prev => [...prev, newItem]);

        // Background processing
        (async () => {
            let lat = null, lng = null;
            try {
                const exifr = await import('exifr');
                const gps = await exifr.default.gps(file);
                if (gps) { lat = gps.latitude; lng = gps.longitude; }
            } catch {}

            // Upload to get R2 preview
            const fd = new FormData();
            fd.append('intent', 'upload_temp');
            fd.append('image', file);
            const upRes = await fetch('/api/admin/mass-add', { method: 'POST', body: fd });
            const upData = await upRes.json() as any;
            const r2Preview = upData.success ? upData.url : newItem.preview;

            setFiles(prev => prev.map(f => f.id === id ? { ...f, lat, lng, preview: r2Preview, status: lat ? 'analyzing' : 'needs_gps' } : f));
        })();
    };

    const processFile = async (file: File) => {
        const extension = file.name.split('.').pop()?.toLowerCase();
        
        if (extension === 'pptx' || extension === 'docx') {
            try {
                const zip = await JSZip.loadAsync(file);
                const mediaDir = extension === 'pptx' ? 'ppt/media/' : 'word/media/';
                const mediaFiles = Object.keys(zip.files).filter(path => path.startsWith(mediaDir));
                
                const items: {blob: Blob, url: string, name: string}[] = [];
                for (const path of mediaFiles) {
                    const zipFile = zip.files[path];
                    if (zipFile.dir) continue;
                    const blob = await zipFile.async('blob');
                    const fileName = path.split('/').pop() || 'image.jpg';
                    const type = fileName.endsWith('.png') ? 'image/png' : fileName.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
                    const typedBlob = new Blob([blob], { type: blob.type || type });
                    items.push({
                        blob: typedBlob,
                        url: URL.createObjectURL(typedBlob),
                        name: `${file.name.split('.')[0]}_${fileName}`
                    });
                }
                if (items.length > 0) {
                    setExtractionQueue(prev => [...prev, { name: file.name, items }]);
                } else {
                    alert(`No images found in ${file.name}`);
                }
            } catch (e) {
                console.error("Failed to extract from office doc:", e);
                alert(`Failed to read documents from ${file.name}`);
            }
        } else if (extension === 'pdf') {
            try {
                const pdfjsLib = await import('pdfjs-dist');
                pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const items: {blob: Blob, url: string, name: string}[] = [];
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 2.0 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    if (context) {
                        await page.render({ canvasContext: context, viewport } as any).promise;
                        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
                        if (blob) {
                            items.push({
                                blob,
                                url: URL.createObjectURL(blob),
                                name: `${file.name.split('.')[0]}_Page_${i}`
                            });
                        }
                    }
                }
                if (items.length > 0) {
                    setExtractionQueue(prev => [...prev, { name: file.name, items }]);
                } else {
                    alert(`No pages extracted from PDF ${file.name}`);
                }
            } catch (e) {
                console.error("Failed to extract PDF:", e);
                alert(`Failed to extract pages from ${file.name}.`);
            }
        } else {
            await addToFileList(file);
        }
    };

    const onDrop = async (acceptedFiles: File[]) => {
        for (const file of acceptedFiles) {
            await processFile(file);
        }
    };

    // Auto-Trash Janitor Effect
    useEffect(() => {
        const needsCleaning = files.filter(f => f.status === 'analyzing' && !f._cleaned);
        if (needsCleaning.length === 0) return;

        const cleaner = setTimeout(async () => {
            const toClean = needsCleaning.slice(0, 10);
            
            // Mark as cleaning in-progress to avoid double trigger
            setFiles(prev => prev.map(f => toClean.some(tc => tc.id === f.id) ? { ...f, _cleaned: true } : f));

            try {
                const toBase64Small = (file: File) => new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            const MAX_WIDTH = 200;
                            const scaleSize = MAX_WIDTH / img.width;
                            canvas.width = MAX_WIDTH;
                            canvas.height = img.height * scaleSize;
                            const ctx = canvas.getContext('2d');
                            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                            resolve(canvas.toDataURL('image/jpeg', 0.5).split(',')[1]);
                        };
                        img.src = reader.result as string;
                    };
                    reader.readAsDataURL(file);
                });

                const base64s = await Promise.all(toClean.map(f => toBase64Small(f.file)));
                const res = await fetch('/api/admin/mass-add', {
                    method: 'POST',
                    body: (() => {
                        const fd = new FormData();
                        fd.append('intent', 'classify_batch');
                        fd.append('images', JSON.stringify(base64s.map(data => ({ mimeType: 'image/jpeg', data }))));
                        return fd;
                    })()
                });
                const data = await res.json() as any;
                
                if (data.success && Array.isArray(data.validIndices)) {
                    const validIds = data.validIndices.map((idx: number) => toClean[idx].id);
                    const invalidIds = toClean.map(tc => tc.id).filter(id => !validIds.includes(id));
                    
                    if (invalidIds.length > 0) {
                                                setFiles(prev => prev.filter(f => !invalidIds.includes(f.id)));
                    }
                }
            } catch (e) {
                console.error("Janitor failed:", e);
            }
        }, 2000);

        return () => clearTimeout(cleaner);
    }, [files]);

    // Auto-Analyze when Location is pinned
    // DISABLED: This was causing 429 Too Many Requests errors by triggering Gemini on every location edit.
    // Users must now manually click the "AI Generate" or "✨ Auto-Generate Details" button.

    // Google Picker State & Logic
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [showClassroomModal, setShowClassroomModal] = useState(false);
    const tokenClientRef = useRef<any>(null);

    useEffect(() => {
        const loadScripts = async () => {
            // Load GAPI
            const gapiScript = document.createElement('script');
            gapiScript.src = 'https://apis.google.com/js/api.js';
            gapiScript.async = true;
            gapiScript.defer = true;
            document.body.appendChild(gapiScript);

            // Load GSI
            const gsiScript = document.createElement('script');
            gsiScript.src = 'https://accounts.google.com/gsi/client';
            gsiScript.async = true;
            gsiScript.defer = true;
            document.body.appendChild(gsiScript);

            gsiScript.onload = () => {
                const google = (window as any).google;
                if (google) {
                    tokenClientRef.current = google.accounts.oauth2.initTokenClient({
                        client_id: googleDriveClientId,
                        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.students.readonly https://www.googleapis.com/auth/classroom.rosters.readonly',
                        callback: (response: any) => {
                            if (response.access_token) {
                                setAccessToken(response.access_token);
                                createPicker(response.access_token);
                            }
                        },
                    });
                }
            };
        };
        loadScripts();
    }, [googleDriveClientId]);

    const handleImportFromCloud = () => {
        if (!accessToken) {
            tokenClientRef.current?.requestAccessToken({ prompt: 'consent' });
        } else {
            createPicker(accessToken);
        }
    };

    const handleImportFromClassroom = () => {
        if (!accessToken) {
            tokenClientRef.current?.requestAccessToken({ prompt: 'consent' });
        } else {
            setShowClassroomModal(true);
        }
    };

    const createPicker = (token: string) => {
        const gapi = (window as any).gapi;
        const google = (window as any).google;
        if (gapi) {
            gapi.load('picker', () => {
                // View for My Drive with folder navigation
                const docsView = new google.picker.DocsView(google.picker.ViewId.DOCS)
                    .setIncludeFolders(true)
                    .setMimeTypes('image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf');
                
                // View for Shared Drives
                const drivesView = new google.picker.DocsView(google.picker.ViewId.DOCS)
                    .setEnableDrives(true)
                    .setIncludeFolders(true)
                    .setMimeTypes('image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf');

                const picker = new google.picker.PickerBuilder()
                    .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
                    .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
                    .enableFeature(google.picker.Feature.SUPPORT_TEAM_DRIVES)
                    .setDeveloperKey(googleDriveApiKey)
                    .setAppId(googleDriveClientId)
                    .setOAuthToken(token)
                    .addView(docsView)
                    .addView(drivesView)
                    .setCallback(pickerCallback)
                    .build();
                picker.setVisible(true);
            });
        }
    };

    const pickerCallback = async (data: any) => {
        const google = (window as any).google;
        if (data.action === google.picker.Action.PICKED) {
            const docs = data.docs;
            for (const doc of docs) {
                const fileId = doc.id;
                const fileName = doc.name;
                const mimeType = doc.mimeType;

                try {
                    // Download file from Google Drive
                    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });
                    const blob = await res.blob();
                    const file = new File([blob], fileName, { type: mimeType });
                    
                    await processFile(file);
                } catch (e) {
                    console.error("Failed to import from Drive:", e);
                }
            }
        }
    };

    const { getRootProps, getInputProps } = useDropzone({
        onDrop,
        accept: { 
            'image/*': [],
            'application/pdf': ['.pdf'],
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
        }
    } as any);


    const removeFile = (index: number) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const saveLocation = async (index: number, autoAdvance: boolean = false) => {
        const item = files[index];
        if (!item.lat || !item.lng) {
            alert("Missing GPS!");
            return;
        }
        if (item.evidence.length === 0) {
            alert("Please add map evidence and a descriptive visual summary before saving!");
            setEditingId(index);
            return;
        }

        const formData = new FormData();
        formData.append('intent', 'save');
        if (item.file) {
            formData.append('image', item.file);
        }
        formData.append('metadata', JSON.stringify({
            preview: item.preview, // Pass pre-uploaded R2 URL to backend if file missing
            lat: item.lat,
            lng: item.lng,
            description: item.description,
            difficulty: item.difficulty,
            hints: item.hints,
            evidence: item.evidence,
            photographer: item.photographer,
            addToSet: item.addToSet,
            locationName: item.photographer // Use filename as default name
        }));

        const res = await fetch('/api/admin/mass-add', { method: 'POST', body: formData });
        if (res.ok) {
            const nextIdx = index < files.length - 1 ? index : (index > 0 ? index - 1 : null);
            
            // If all files are gone, clear metadata draft
            if (files.length <= 1) {
                const clearData = new FormData();
                clearData.append('intent', 'clear_draft');
                fetch('/api/admin/mass-add', { method: 'POST', body: clearData });
            }

            removeFile(index); // Remove from list on success
            if (autoAdvance && nextIdx !== null) {
                // If we were editing, potentially stay in modal for next item
                if (editingId !== null) {
                    setEditingId(nextIdx);
                }
            } else if (editingId === index) {
                setEditingId(null);
            }
        } else {
            alert("Failed to save");
        }
    };



    const downloadAllImages = async () => {
        if (files.length === 0) return;
        setSyncStatus('syncing');
        try {
            const zip = new JSZip();
            const folder = zip.folder("geohunter-extracted-images");
            
            for (let i = 0; i < files.length; i++) {
                const item = files[i];
                let blob;
                if (item.file) {
                    blob = item.file;
                } else if (item.preview && item.preview.startsWith('http')) {
                    // Use PROXY to bypass CORS
                    const fd = new FormData();
                    fd.append('intent', 'proxy_image');
                    fd.append('url', item.preview);
                    const res = await fetch('/api/admin/mass-add', { method: 'POST', body: fd });
                    blob = await res.blob();
                }
                
                if (blob) {
                    const ext = blob.type.split('/')[1] || 'jpg';
                    const name = item.photographer ? `${item.photographer}_${i}.${ext}` : `image_${i}.${ext}`;
                    folder?.file(name, blob);
                }
            }
            
            const content = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `geohunter_images_${Date.now()}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Bulk download failed", e);
            alert("Bulk download failed. Try individual downloads.");
        }
        setSyncStatus('synced');
    };

    const downloadSingleImage = async (idx: number) => {
        const item = files[idx];
        let blob;
        if (item.file) {
            blob = item.file;
        } else if (item.preview && item.preview.startsWith('http')) {
            // Use PROXY to bypass CORS
            const fd = new FormData();
            fd.append('intent', 'proxy_image');
            fd.append('url', item.preview);
            const res = await fetch('/api/admin/mass-add', { method: 'POST', body: fd });
            blob = await res.blob();
        }

        if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ext = blob.type.split('/')[1] || 'jpg';
            a.download = item.photographer ? `${item.photographer}.${ext}` : `image_${idx}.${ext}`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    return (
        <div className="admin-panel p-6 md:p-8">
            <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <Link
                        to="/admin"
                        className="px-4 py-2 bg-[#0a1210] hover:bg-[#0e1a14] text-teal border border-teal/30 hover:border-teal/50 rounded-sm text-sm font-mono uppercase tracking-widest transition-all flex items-center gap-2"
                    >
                        ← Back
                    </Link>
                    <h1 className="font-heading text-2xl md:text-3xl font-black bg-teal hover:bg-teal/90 text-charcoal">Deploy Targets</h1>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => window.location.reload()}
                        className="px-3 py-2 bg-[#0a1210] hover:bg-[#0e1a14] border border-brass/20 text-stone-light hover:bg-teal hover:bg-teal/90 text-charcoal rounded-sm text-sm font-mono uppercase tracking-widest transition-all flex items-center gap-2"
                        title="Reload page to fetch latest draft from other devices"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Refresh
                    </button>
                    {files.length > 0 && (
                        <button
                            onClick={downloadAllImages}
                            className="px-4 py-2 bg-brass hover:bg-brass/90 text-charcoal rounded-sm text-sm font-mono font-bold uppercase tracking-widest shadow-[0_4px_10px_rgba(201,168,76,0.3)] transition-all active:scale-95 flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            Download ({files.length})
                        </button>
                    )}
                    <div className={`px-3 py-1.5 rounded-sm text-xs font-mono font-bold border flex items-center gap-2 ${
                        syncStatus === 'synced' ? 'bg-teal/10 border-teal/50 text-teal' :
                        syncStatus === 'syncing' ? 'bg-amber/10 border-amber/50 text-amber animate-pulse' :
                        syncStatus === 'error' ? 'bg-rust/10 border-rust/50 text-rust' :
                        'bg-[#0a1210] border-brass/20 text-stone'
                    }`}>
                        <div className={`w-2 h-2 rounded-full ${
                            syncStatus === 'synced' ? 'bg-teal' :
                            syncStatus === 'syncing' ? 'bg-amber' :
                            syncStatus === 'error' ? 'bg-rust' :
                            'bg-stone'
                        }`} />
                        {syncStatus === 'synced' ? 'Synced' :
                         syncStatus === 'syncing' ? 'Syncing...' :
                         syncStatus === 'error' ? 'Sync failed' :
                         'Local draft'}
                    </div>
                </div>
            </div>

            <div {...getRootProps()} className="border-2 border-dashed border-brass/30 rounded-sm p-10 text-center hover:border-brass/50 transition-colors cursor-pointer bg-[#0a1210]/80 relative group">
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-3">
                    <p className="text-stone-light text-lg">Drop images or documents here</p>
                    <p className="text-sm text-stone">JPG, PNG, WEBP, PPTX, DOCX, PDF</p>

                    <div className="flex flex-wrap justify-center gap-4 mt-6">
                        <div className="px-6 py-3 bg-teal/10 border border-teal/30 text-teal rounded-sm text-sm font-mono font-bold flex items-center gap-2 group-hover:bg-teal/20 transition-all">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                            Browser Files
                        </div>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleImportFromCloud();
                            }}
                            className="px-6 py-3 bg-brass hover:bg-brass/90 text-charcoal rounded-sm text-sm font-mono font-bold shadow-[0_4px_15px_rgba(201,168,76,0.3)] transition-all active:scale-95 flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M11.2 5.25c.34-.58.85-1 1.45-1.23.6-.23 1.25-.26 1.88-.08s1.2.56 1.63 1.1c.43.54.67 1.22.67 1.91v.15a4.5 4.5 0 0 1 4 4.45c0 2.48-2.02 4.5-4.5 4.5h-5.4V5.25zM12 16.05v-5.22c-.67-.3-1.4-.41-2.12-.3a4.502 4.502 0 0 0-3.32 2.05A4.5 4.5 0 0 0 4.5 16.05c0 2.48 2.02 4.5 4.5 4.5h3zm2.5-12.8c-1.38 0-2.5 1.12-2.5 2.5v10.3h5.5c2.48 0 4.5-2.02 4.5-4.5 0-2.33-1.78-4.24-4.06-4.47.04-.17.06-.35.06-.53 0-1.93-1.57-3.5-3.5-3.5z"/>
                            </svg>
                            Import from Cloud
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleImportFromClassroom();
                            }}
                            className="px-6 py-3 bg-teal hover:bg-teal/90 text-charcoal rounded-sm text-sm font-mono font-bold shadow-[0_4px_15px_rgba(74,155,140,0.3)] transition-all active:scale-95 flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-1c0-.55-.45-1-1-1H9v-1c0-1.1-.9-2-2-2H5c-.55 0-1-.45-1-1v-1c0-.55.45-1 1-1h1c1.1 0 2 .9 2 2v2h2v-2h2v-2c0-.55.45-1 1-1H6V5c1.66-1.57 3.9-2.5 6.36-2.5 5.51 0 10 4.49 10 10 0 2.21-.71 4.26-1.92 5.91-.71-.85-1.58-1.55-2.58-2.07l-.76-.43c-.43-.24-.95-.23-1.37.03z"/>
                            </svg>
                            Import from Classroom
                        </button>
                    </div>

                    <div className="mt-6 p-3 bg-amber/10 border border-amber/30 rounded-sm max-w-lg mx-auto">
                        <p className="text-[10px] text-amber leading-tight">
                            Pro Tip: For Google Slides, Canva, or Google Docs, simply Download as PPTX or DOCX and drag that file here.
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex justify-between items-center mt-12 mb-4">
                <h2 className="font-heading text-xl font-black bg-teal hover:bg-teal/90 text-charcoal">Pending Targets</h2>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setEditingId('all')}
                        className="px-6 py-2.5 bg-amber hover:bg-amber/90 text-charcoal font-black rounded-sm shadow-[0_4px_15px_rgba(212,130,42,0.3)] transition-all flex items-center gap-2 tracking-widest uppercase active:scale-95"
                        disabled={files.length === 0}
                    >
                        Edit All
                    </button>
                    {files.some(f => f.status === 'saved') && (
                        <button
                            onClick={() => setFiles(prev => prev.filter(f => f.status !== 'saved'))}
                            className="px-4 py-2 bg-[#0a1210] hover:bg-rust/20 text-stone-light hover:text-rust border border-brass/20 rounded-sm text-sm font-mono uppercase tracking-widest transition-colors flex items-center gap-2"
                        >
                            Clear Saved
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {files.map((file, idx) => (
                    <div key={file.id} className={`bg-[#0a1210] border rounded-sm overflow-hidden flex flex-col transition-all ${file.status === 'saved' ? 'border-brass scale-[0.98] opacity-80 shadow-[0_0_15px_rgba(201,168,76,0.3)]' : 'border-brass/10'}`}>
                        <div className="relative h-48 bg-[#0e1a14]">
                            <img src={file.preview} className="w-full h-full object-cover opacity-80" />
                            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                                {file.status === 'saved' && (
                                    <span className="bg-brass text-charcoal font-black text-xs px-2 py-1 rounded shadow-lg uppercase tracking-widest border border-brass-light mb-1">
                                        DEPLOYED
                                    </span>
                                )}
                                {file.lat ? (
                                    <span className="bg-teal/20 text-teal text-xs px-2 py-1 rounded whitespace-nowrap">GPS OK</span>
                                ) : (
                                    <span className="bg-amber/20 text-amber text-xs px-2 py-1 rounded whitespace-nowrap">No GPS</span>
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        downloadSingleImage(idx);
                                    }}
                                    className="bg-[#0e1a14]/80 hover:bg-brass bg-teal hover:bg-teal/90 text-charcoal p-2 rounded-sm transition-all border border-brass/20"
                                    title="Download this image"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                </button>
                                {file.evidence.length > 0 && (
                                    <span className="bg-amber/90 text-charcoal font-black text-[10px] px-2 py-1 rounded shadow-lg animate-pulse uppercase tracking-tighter whitespace-nowrap border border-charcoal/10">
                                        {file.evidence.length} INTEL
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="p-4 flex-1 space-y-3">
                            <h3 className="font-heading font-bold truncate bg-teal hover:bg-teal/90 text-charcoal">{file.file?.name || file.photographer || "Unnamed"}</h3>
                            <p className="text-sm text-stone-light line-clamp-2">{file.description || "No description generated"}</p>

                            <div className="flex gap-2 text-sm font-mono">
                                <span className="bg-[#0e1a14] px-2 py-1 rounded-sm text-stone">Diff: {file.difficulty}</span>
                                <span className="bg-[#0e1a14] px-2 py-1 rounded-sm text-stone">Ev: {file.evidence.length}</span>
                            </div>
                        </div>

                        <div className="p-3 bg-[#0e1a14]/80 flex gap-2 border-t border-brass/10">
                            <button
                                onClick={() => analyzeFile(file.id, file.file)}
                                disabled={analyzingIds.has(file.id)}
                                className="flex-1 px-3 py-1.5 bg-teal/10 text-teal hover:bg-teal/20 rounded-sm text-sm font-mono disabled:opacity-50"
                            >
                                {analyzingIds.has(file.id) ? 'Processing...' : 'AI Analyze'}
                            </button>
                            <button
                                onClick={() => setEditingId(idx)}
                                className="px-3 py-1.5 bg-[#0a1210] hover:bg-brass/10 text-stone-light hover:bg-teal hover:bg-teal/90 text-charcoal rounded-sm text-sm font-mono border border-brass/20"
                            >
                                Edit
                            </button>
                            {file.evidence.length === 0 ? (
                                <button
                                    onClick={() => setEditingId(idx)}
                                    className="px-3 py-1.5 bg-amber/10 hover:bg-amber/20 text-amber rounded-sm text-sm font-mono font-bold animate-pulse"
                                >
                                    Add Intel
                                </button>
                            ) : (
                                <button
                                    onClick={() => saveLocation(idx)}
                                    className={`px-4 py-1.5 rounded-sm text-sm font-mono font-bold transition-colors shadow-md ${file.status === 'saved' ? 'bg-amber/20 text-amber hover:bg-amber/30 border border-amber/30' : 'bg-teal hover:bg-teal/90 text-charcoal hover:bg-teal/90 border border-teal/30'}`}
                                >
                                    {file.status === 'saved' ? 'Re-Save' : 'Save'}
                                </button>
                            )}
                            <button onClick={() => removeFile(idx)} className="px-2 text-stone hover:text-rust text-lg font-mono">×</button>
                        </div>
                    </div>
                ))}
            </div>
            </div>
        </div>
    );
}

            <EditModal editingId={editingId} files={files} setFiles={setFiles} setEditingId={setEditingId} isLoaded={isLoaded} mapSets={mapSets} onSave={saveLocation} />

            {extractionQueue.length > 0 && (
                <ExtractionModal
                    document={extractionQueue[0]}
                    onConfirm={async (selectedIndices) => {
                        const doc = extractionQueue[0];
                        for (const idx of selectedIndices) {
                            const item = doc.items[idx];
                            const file = new File([item.blob], `${item.name}.jpg`, { type: item.blob.type });
                            await addToFileList(file);
                        }
                        setExtractionQueue(prev => prev.slice(1));
                    }}
                    onCancel={() => {
                        setExtractionQueue(prev => prev.slice(1));
                    }}
                />
            )}

            {showClassroomModal && accessToken && (
                <ClassroomImportModal
                    accessToken={accessToken}
                    onClose={() => setShowClassroomModal(false)}
                    onAddFile={addToFileList}
                    onAddExtractionQueue={(queueItem: any) => setExtractionQueue((prev: any) => [...prev, queueItem])}
                />
            )}
        </div>
    );
}

export function ExtractionModal({ document, onConfirm, onCancel }: { document: { name: string, items: { blob: Blob, url: string, name: string }[] }, onConfirm: (indices: number[]) => void, onCancel: () => void }) {
    const [selected, setSelected] = useState<Set<number>>(new Set(document.items.map((_, i) => i)));

    const toggle = (idx: number) => {
        const next = new Set(selected);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        setSelected(next);
    };

    return (
        <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4">
            <div className="bg-[#0a1210] border border-brass/30 rounded-sm w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden shadow-2xl">
                <div className="p-4 border-b border-brass/10 flex justify-between items-center bg-[#0e1a14]">
                    <div>
                        <h2 className="font-heading text-xl font-black bg-teal hover:bg-teal/90 text-charcoal">Extract Images</h2>
                        <p className="text-sm text-stone-light">Select images/pages to import from <span className="text-teal font-mono">{document.name}</span></p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setSelected(new Set(document.items.map((_, i) => i)))}
                            className="px-3 py-1.5 rounded-sm border border-brass/30 hover:bg-brass/10 text-xs text-teal font-mono uppercase tracking-widest transition-colors"
                        >
                            Select All
                        </button>
                        <button
                            onClick={() => setSelected(new Set())}
                            className="px-3 py-1.5 rounded-sm border border-brass/30 hover:bg-brass/10 text-xs text-stone font-mono uppercase tracking-widest transition-colors"
                        >
                            Deselect All
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-[#0a1210]/80 custom-scrollbar">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {document.items.map((item, idx) => {
                            const isSelected = selected.has(idx);
                            return (
                                <div
                                    key={idx}
                                    onClick={() => toggle(idx)}
                                    className={`relative rounded-sm border-2 overflow-hidden cursor-pointer transition-all aspect-square ${isSelected ? 'border-teal shadow-[0_0_15px_rgba(74,155,140,0.3)]' : 'border-brass/10 opacity-60 hover:opacity-100 hover:border-brass/30'}`}
                                >
                                    <img src={item.url} className="w-full h-full object-cover bg-[#0e1a14]" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-2 pointer-events-none">
                                        <div className="text-[10px] bg-teal hover:bg-teal/90 text-charcoal truncate w-full">{item.name}</div>
                                    </div>
                                    <div className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-teal border-teal text-charcoal' : 'border-stone bg-[#0e1a14]/80'}`}>
                                        {isSelected && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="p-4 border-t border-brass/10 bg-[#0e1a14] flex justify-between items-center">
                    <div className="text-sm font-mono text-stone">
                        <span className="text-teal font-bold">{selected.size}</span> / {document.items.length} selected
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onCancel} className="px-5 py-2 rounded-sm bg-[#0a1210] bg-teal hover:bg-teal/90 text-charcoal hover:bg-brass/10 font-mono uppercase tracking-widest transition-colors border border-brass/20">
                            Cancel
                        </button>
                        <button
                            onClick={() => onConfirm(Array.from(selected))}
                            disabled={selected.size === 0}
                            className="px-6 py-2 rounded-sm bg-teal hover:bg-teal/90 disabled:opacity-50 disabled:bg-[#0a1210] text-charcoal font-mono font-black uppercase tracking-widest transition-all shadow-[0_4px_15px_rgba(74,155,140,0.3)]"
                        >
                            Import Selected
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export const SingleLocationEditor = memo(function SingleLocationEditor({ item, editingIdx, setFiles, isLoaded, mapSets, onSave, isMulti }: {
    item: any;
    editingIdx: number;
    setFiles: any;
    isLoaded: boolean;
    mapSets: any[];
    onSave: any;
    isMulti: boolean;
}) {
    if (!item) return null;
    const editingId = editingIdx;

    // Local state for evidence description editing inside modal
    const [tempEvidenceBox, setTempEvidenceBox] = useState<BoxCoordinates | null>(null);
    const [tempEvidenceDesc, setTempEvidenceDesc] = useState("");
    const itemsMapRef = useRef<google.maps.Map | null>(null);
    const itemsMarkerRef = useRef<google.maps.Marker | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // AI Copilot State
    const [chatHistory, setChatHistory] = useState<any[]>([]);
    const [chatMessage, setChatMessage] = useState("");
    const [isChatting, setIsChatting] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Resizer logic
    const [splitRatio, setSplitRatio] = useState(35);
    const [isResizing, setIsResizing] = useState(false);
    const [isEvidenceFullscreen, setIsEvidenceFullscreen] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem("geohunter-mass-add-split");
        if (saved) setSplitRatio(parseFloat(saved));
    }, []);

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;
        // Calculate relative to the actual modal container if possible, but window-relative is fine for h-split if max-w-vw
        const newRatio = (1 - (e.clientX / window.innerWidth)) * 100;
        setSplitRatio(Math.min(Math.max(newRatio, 15), 75)); // Expanded range 15% - 75%
    };

    const handleMouseUp = () => {
        setIsResizing(false);
        localStorage.setItem("geohunter-mass-add-split", splitRatio.toString());
    };

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isEvidenceFullscreen) {
                setIsEvidenceFullscreen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isEvidenceFullscreen]);

    const handleChat = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatMessage.trim() || isChatting) return;

        const userMsg = chatMessage;
        setChatMessage("");
        setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsChatting(true);

        const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
        });

        try {
            const formData = new FormData();
            formData.append('intent', 'chat');
            formData.append('message', userMsg);
            formData.append('history', JSON.stringify(chatHistory));

            if (item.preview && item.preview.startsWith('http')) {
                formData.append('image_url', item.preview);
            } else if (item.file) {
                const dataUri = await toBase64(item.file);
                formData.append('image_data', dataUri);
            } else {
                throw new Error("No image available for chat.");
            }

            if (item.lat && item.lng) {
                formData.append('lat', String(item.lat));
                formData.append('lng', String(item.lng));
            }
            if (item.evidence && item.evidence.length > 0) {
                formData.append('evidence', JSON.stringify(item.evidence));
            }
            formData.append('current_description', item.description || "");
            formData.append('current_hints', JSON.stringify(item.hints || []));

            const res = await fetch('/api/admin/mass-add', { method: 'POST', body: formData });
            const data = (await res.json()) as any;

            if (data.success) {
                setChatHistory(prev => [...prev, { role: 'model', content: data.ai_response }]);
            } else {
                setChatHistory(prev => [...prev, { role: 'model', content: "Error: " + data.error }]);
            }
        } catch (error) {
            console.error("Chat error", error);
            setChatHistory(prev => [...prev, { role: 'model', content: "Failed to communicate with AI." }]);
        } finally {
            setIsChatting(false);
        }
    };

    const handleAutoGenerateDetails = async () => {
        if (editingId === null) return;
        setIsChatting(true);
        setChatHistory(prev => [...prev, { role: "user", content: "✨ Auto-generating hints and description..." }]);

        try {
            const formData = new FormData();
            formData.append("intent", "analyze");
            if (item.lat && item.lng) {
                formData.append("lat", item.lat.toString());
                formData.append("lng", item.lng.toString());
            }
            if (item.preview && item.preview.startsWith('http')) {
                formData.append("image_url", item.preview);
            } else if (item.file) {
                 const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = error => reject(error);
                });
                formData.append("image_data", await toBase64(item.file));
            }

            if (item.evidence && item.evidence.length > 0) {
                formData.append("evidence", JSON.stringify(item.evidence));
            }

            const res = await fetch("/api/admin/mass-add", {
                method: "POST",
                body: formData
            });

            const data = await res.json() as any;
            if (data.error) throw new Error(data.error);

            if (data.aiData) {
                const { precontext, generated_hints, difficulty_rating, hint_pins } = data.aiData;
                setFiles((prev: any[]) => {
                    const cp = [...prev];
                    cp[editingId].description = precontext;
                    cp[editingId].hints = generated_hints || [];
                    cp[editingId].difficulty = difficulty_rating;
                    cp[editingId].hint_pins = hint_pins || [];
                    return cp;
                });
                setChatHistory(prev => [...prev, { role: "model", content: "✅ Successfully generated Tuen Mun-specific hints and atmospheric description." }]);
            }
        } catch (e: any) {
            console.error(e);
            setChatHistory(prev => [...prev, { role: "model", content: `⚠️ Generation failed: ${e.message}` }]);
        } finally {
            setIsChatting(false);
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    };

    const handleAutoDetectEvidence = async () => {
        if (editingId === null || isChatting) return;
        
        // VALIDATION: Ensure location is pinned
        if (!item.lat || !item.lng) {
            setChatHistory(prev => [...prev, { 
                role: "model", 
                content: "⚠️ **Location Required**: Please pin the location on the map first so the AI can ground the evidence against real map data!" 
            }]);
            return;
        }

        setIsChatting(true);
        setChatHistory(prev => [...prev, { role: "user", content: "Please auto-detect evidence for this location." }]);
        
        const locationPayload = {
            lat: item.lat,
            lng: item.lng,
            name: item.photographer // Use photographer field as name if available
        };

        try {
            let payload: any = { location: locationPayload };
            
            if (item.preview && item.preview.startsWith('http')) {
                payload.imageUrl = item.preview;
            } else {
                // Fallback to converting File to Base64 if preview is not a URL
                const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = error => reject(error);
                });
                payload.base64Image = await toBase64(item.file);
            }

            const res = await fetch("/api/admin/auto-detect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json() as any;
            if (data.error) throw new Error(data.error);

            if (data.evidence && data.evidence.length > 0) {
                const mappedEvidence = data.evidence.map((ev: any) => ({
                    description: ev.description,
                    box: {
                        x: ev.box.x,
                        y: ev.box.y,
                        w: ev.box.w,
                        h: ev.box.h
                    }
                }));

                setFiles((prev: any[]) => {
                    const cp = [...prev];
                    cp[editingId].evidence = [...cp[editingId].evidence, ...mappedEvidence];
                    return cp;
                });
                setChatHistory(prev => [...prev, { role: "model", content: `✅ Successfully auto-detected ${mappedEvidence.length} evidence markers.` }]);
            } else {
                setChatHistory(prev => [...prev, { role: "model", content: "No distinct evidence landmarks could be automatically detected." }]);
            }
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        } catch (e: any) {
            console.error(e);
            setChatHistory(prev => [...prev, { role: "model", content: `⚠️ Auto-detect failed: ${e.message}` }]);
        } finally {
            setIsChatting(false);
        }
    };

    const mapCenter = useMemo(() => item.lat ? { lat: item.lat, lng: item.lng } : { lat: 22.3193, lng: 114.1694 }, [item.lat, item.lng]);
    const mapOptions = useMemo(() => ({
        mapTypeId: 'satellite',
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'greedy'
    }), []);

    return (
        <div className={isMulti ? 'w-full shrink-0 flex flex-col snap-center h-full' : 'w-full h-full flex flex-col'}>
            <div className={isMulti ? 'bg-[#0a1210] rounded-sm w-full h-[85vh] shrink-0 flex flex-col border border-brass/30 shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden' : 'bg-[#0a1210] rounded-sm w-full h-full flex flex-col border border-brass/20 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden'}>
                {/* Header */}
                <div className="flex justify-between items-center p-3 border-b border-brass/10 bg-[#0e1a14]/50 backdrop-blur-md sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-heading font-bold bg-teal hover:bg-teal/90 text-charcoal flex items-center gap-2">
                            <span className="p-1 bg-brass/20 rounded-sm text-brass text-sm font-mono">#{editingId + 1}</span>
                            <span className="text-teal font-mono text-sm">{item.file?.name || item.photographer || "Unnamed"}</span>
                        </h2>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsEvidenceFullscreen(!isEvidenceFullscreen)}
                            className={`px-3 py-1.5 rounded-sm font-mono font-bold text-xs uppercase tracking-widest transition-all border flex items-center gap-2 ${isEvidenceFullscreen
                                    ? "bg-amber/20 border-amber/50 text-amber hover:bg-amber/30"
                                    : "bg-[#0a1210] border-brass/20 text-stone hover:bg-brass/10 hover:bg-teal hover:bg-teal/90 text-charcoal"
                                }`}
                        >
                            {isEvidenceFullscreen ? "Exit FS" : "Fullscreen"}
                        </button>
                        <button
                            disabled={isSaving}
                            onClick={async () => {
                                setIsSaving(true);
                                await onSave(editingId, true);
                                setIsSaving(false);
                            }}
                            className="px-5 py-1.5 bg-teal hover:bg-teal/90 disabled:opacity-50 text-charcoal rounded-sm font-black text-xs uppercase tracking-widest shadow-[0_4px_15px_rgba(74,155,140,0.3)] transition-all flex items-center gap-2"
                        >
                            {isSaving ? "SAVING..." : "Save"}
                        </button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* LEFT PANEL: CONTENT EDITOR */}
                    <div
                        className={`flex-1 overflow-y-auto p-8 custom-scrollbar bg-[#0e1a14]/30 transition-all ${isEvidenceFullscreen ? 'fixed inset-0 z-[60] bg-[#0a1210] p-0' : ''}`}
                        style={isEvidenceFullscreen ? {} : { width: `${100 - splitRatio}%` }}
                    >
                        <div className={`${isEvidenceFullscreen ? 'w-full h-full' : 'max-w-4xl mx-auto space-y-10 pb-20'}`}>
                            {/* Visuals Section */}
                            <div className={`${isEvidenceFullscreen ? 'w-full h-full' : 'grid grid-cols-1 gap-6'}`}>
                                <div className={`${isEvidenceFullscreen ? 'w-full h-full rounded-none border-none' : 'bg-black rounded-2xl overflow-hidden border border-brass/20 relative h-[400px]'}`}>
                                    {isEvidenceFullscreen && (
                                        <button
                                            onClick={() => setIsEvidenceFullscreen(false)}
                                            className="absolute top-6 right-6 z-[70] p-3 bg-red-600/80 hover:bg-red-600 bg-teal hover:bg-teal/90 text-charcoal rounded-full shadow-2xl transition-all"
                                            title="Close Fullscreen (Esc)"
                                        >
                                            <span className="text-xl font-bold">×</span>
                                        </button>
                                    )}
                                    <EvidenceCanvas
                                        imageUrl={item.preview}
                                        onBoxChange={(newBox) => {
                                            if (newBox) {
                                                setTempEvidenceBox(newBox);
                                                setTempEvidenceDesc(""); // Reset desc for new box
                                            }
                                        }}
                                    >
                                        {/* Evidence Banner */}
                                        {item.evidence.length > 0 && (
                                            <div className="absolute top-4 left-4 z-40">
                                                <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-black px-4 py-1.5 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.4)] flex items-center gap-2 border border-amber-400/50">
                                                    <span className="text-lg animate-bounce">🔥</span>
                                                    <span className="font-black text-xs uppercase tracking-widest italic">
                                                        {item.evidence.length >= 2
                                                            ? `INTEL OVERLOAD: ${item.evidence.length} EVIDENCE MARKERS DETECTED!`
                                                            : `CRITICAL INTEL: ${item.evidence.length} EVIDENCE MARKER FOUND!`}
                                                    </span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Render existing evidence */}
                                        {item.evidence.map((ev: any, i: number) => (
                                            <div
                                                key={i}
                                                className="absolute border-2 border-green-400 bg-green-400/10 z-30 group cursor-pointer"
                                                style={{
                                                    left: `${ev.box.x / 10}%`,
                                                    top: `${ev.box.y / 10}%`,
                                                    width: `${ev.box.w / 10}%`,
                                                    height: `${ev.box.h / 10}%`
                                                }}
                                                title={ev.description}
                                            >
                                                <button
                                                    className="absolute -top-3 -right-3 bg-red-500 bg-teal hover:bg-teal/90 text-charcoal rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600 active:scale-90"
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onTouchStart={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setFiles((prev: any[]) => {
                                                            const cp = [...prev];
                                                            cp[editingId].evidence = cp[editingId].evidence.filter((_: any, idx: number) => idx !== i);
                                                            return cp;
                                                        });
                                                    }}
                                                >
                                                    ×
                                                </button>
                                                <div className="absolute bottom-full left-0 bg-black/70 bg-teal hover:bg-teal/90 text-charcoal text-xs px-2 py-1 rounded mb-1 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                                                    {ev.description}
                                                </div>
                                            </div>
                                        ))}

                                        {/* Modal for adding description to NEW box */}
                                        {tempEvidenceBox && (
                                            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                                <div className="bg-brass/10 p-4 rounded-xl border border-gray-600 w-64 space-y-3 shadow-xl">
                                                    <h4 className="font-bold text-sm">Describe Evidence</h4>
                                                    <textarea
                                                        autoFocus
                                                        className="w-full bg-[#0e1a14] border border-brass/20 rounded p-2 text-sm bg-teal hover:bg-teal/90 text-charcoal focus:border-brass/50 outline-none"
                                                        rows={3}
                                                        placeholder="e.g. Red warning sign"
                                                        value={tempEvidenceDesc}
                                                        onChange={(e) => setTempEvidenceDesc(e.target.value)}
                                                    />
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setTempEvidenceBox(null)}
                                                            className="flex-1 py-1.5 bg-brass/20 text-xs rounded hover:bg-gray-600"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                if (tempEvidenceDesc.trim()) {
                                                                    setFiles((prev: any[]) => {
                                                                        const cp = [...prev];
                                                                        cp[editingId].evidence = [...cp[editingId].evidence, { box: tempEvidenceBox, description: tempEvidenceDesc.trim() }];
                                                                        return cp;
                                                                    });
                                                                    setTempEvidenceBox(null);
                                                                }
                                                            }}
                                                            disabled={!tempEvidenceDesc.trim()}
                                                            className="flex-1 py-1.5 bg-brass/20 text-cream text-xs rounded-sm hover:bg-brass/30 disabled:opacity-50 font-bold"
                                                        >
                                                            Add
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </EvidenceCanvas>
                                </div>
                                <div className="flex justify-between items-center text-xs text-stone-light">
                                    <p>💡 Click and drag to draw evidence boxes.</p>
                                    <p>{item.evidence.length} items recorded</p>
                                </div>
                            </div>

                            {/* RIGHT COLUMN: METADATA & MAP */}
                            <div className="space-y-6">
                                {/* Map Section */}
                                <div className="space-y-2">
                                    <label className="block text-stone-light text-sm font-bold uppercase tracking-wider">Location & Coordinates</label>
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        placeholder="Search location (e.g. 'Tokyo Tower')"
                                        className="w-full bg-brass/10 border border-brass/20 rounded-sm px-3 py-2 text-sm focus:border-brass/50 outline-none mb-2"
                                    />
                                    {isLoaded && (
                                        <GoogleMap
                                            mapContainerClassName="w-full h-56 rounded-xl border border-brass/20"
                                            center={mapCenter}
                                            zoom={item.lat ? 16 : 11}
                                            onLoad={(map: google.maps.Map) => {
                                                itemsMapRef.current = map;
                                                // Initialize Autocomplete
                                                if (searchInputRef.current && window.google) {
                                                    const autocomplete = new window.google.maps.places.Autocomplete(searchInputRef.current);
                                                    autocomplete.bindTo("bounds", map);
                                                    autocomplete.addListener("place_changed", () => {
                                                        const place = autocomplete.getPlace();
                                                        if (!place.geometry || !place.geometry.location) return;

                                                        if (place.geometry.viewport) {
                                                            map.fitBounds(place.geometry.viewport);
                                                        } else {
                                                            map.setCenter(place.geometry.location);
                                                            map.setZoom(17);
                                                        }

                                                        // Auto-set marker on search result
                                                        const newLat = place.geometry.location.lat();
                                                        const newLng = place.geometry.location.lng();
                                                        setFiles((prev: any[]) => {
                                                            const cp = [...prev];
                                                            cp[editingId].lat = newLat;
                                                            cp[editingId].lng = newLng;
                                                            return cp;
                                                        });
                                                    });
                                                }
                                            }}
                                            onClick={(e: google.maps.MapMouseEvent) => {
                                                if (e.latLng) {
                                                    setFiles((prev: any[]) => {
                                                        const cp = [...prev];
                                                        cp[editingId].lat = e.latLng?.lat();
                                                        cp[editingId].lng = e.latLng?.lng();
                                                        return cp;
                                                    })
                                                }
                                            }}
                                            options={mapOptions}
                                        >
                                            {item.lat && <Marker position={{ lat: item.lat, lng: item.lng }} />}
                                            {item.hint_pins && item.hint_pins.map((pin: any, idx: number) => (
                                                <Marker
                                                    key={idx}
                                                    position={{ lat: pin.lat, lng: pin.lng }}
                                                    title={pin.description}
                                                    label={{ text: "H" + (idx + 1), color: "black", fontWeight: "bold" }}
                                                    icon="http://maps.google.com/mapfiles/ms/icons/yellow-dot.png"
                                                />
                                            ))}
                                        </GoogleMap>
                                    )}
                                    <div className="flex gap-2 text-xs text-stone font-mono">
                                        <span>Lat: {item.lat?.toFixed(6) || "N/A"}</span>
                                        <span>Lng: {item.lng?.toFixed(6) || "N/A"}</span>
                                    </div>
                                </div>

                                {/* Core Metadata */}
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="block text-stone-light text-sm font-bold uppercase tracking-wider">Description</label>
                                            <button
                                                onClick={handleAutoGenerateDetails}
                                                disabled={isChatting}
                                                className="text-[10px] font-black text-teal hover:text-brass transition-colors uppercase tracking-widest flex items-center gap-1 active:scale-95 disabled:opacity-50"
                                            >
                                                <span>✨ Auto-Generate Details</span>
                                            </button>
                                        </div>
                                        <textarea
                                            className="w-full bg-brass/10 border border-brass/20 rounded-sm p-3 text-sm bg-teal hover:bg-teal/90 text-charcoal focus:border-brass/50 outline-none"
                                            rows={3}
                                            value={item.description}
                                            onChange={(e) => setFiles((prev: any[]) => {
                                                const cp = [...prev];
                                                cp[editingId].description = e.target.value;
                                                return cp;
                                            })}
                                            placeholder="Atmospheric description of the location..."
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Photographer */}
                                        <div>
                                            <label className="block text-stone-light text-sm font-bold uppercase tracking-wider mb-1">Photographer</label>
                                            <input
                                                className="w-full bg-brass/10 border border-brass/20 rounded-sm p-2 text-sm bg-teal hover:bg-teal/90 text-charcoal focus:border-brass/50 outline-none"
                                                value={item.photographer}
                                                onChange={(e) => setFiles((prev: any[]) => {
                                                    const cp = [...prev];
                                                    cp[editingId].photographer = e.target.value;
                                                    return cp;
                                                })}
                                            />
                                        </div>
                                        {/* Difficulty */}
                                        <div>
                                            <label className="block text-stone-light text-sm font-bold uppercase tracking-wider mb-1">Difficulty (1-10)</label>
                                            <input
                                                type="number"
                                                min="1" max="10" step="0.5"
                                                className="w-full bg-brass/10 border border-brass/20 rounded-sm p-2 text-sm bg-teal hover:bg-teal/90 text-charcoal focus:border-brass/50 outline-none"
                                                value={item.difficulty}
                                                onChange={(e) => setFiles((prev: any[]) => {
                                                    const cp = [...prev];
                                                    cp[editingId].difficulty = parseFloat(e.target.value);
                                                    return cp;
                                                })}
                                            />
                                        </div>
                                    </div>

                                    {/* Dataset Selection */}
                                    <div>
                                        <label className="block text-stone-light text-sm font-bold uppercase tracking-wider mb-1">Add to Map Set (Optional)</label>
                                        <select
                                            className="w-full bg-brass/10 border border-brass/20 rounded-sm p-2 text-sm bg-teal hover:bg-teal/90 text-charcoal focus:border-brass/50 outline-none"
                                            value={item.addToSet || ""}
                                            onChange={(e) => setFiles((prev: any[]) => {
                                                const cp = [...prev];
                                                cp[editingId].addToSet = e.target.value;
                                                return cp;
                                            })}
                                        >
                                            <option value="">-- Single / Loose Location --</option>
                                            {mapSets?.map((set: any) => (
                                                <option key={set.id} value={set.id}>{set.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Hints Editor */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="block text-stone-light text-sm font-bold uppercase tracking-wider">Hints</label>
                                            <button
                                                onClick={() => setFiles((prev: any[]) => {
                                                    const cp = [...prev];
                                                    cp[editingId].hints.push("");
                                                    return cp;
                                                })}
                                                className="text-xs text-teal hover:text-brass font-bold"
                                            >
                                                + ADD HINT
                                            </button>
                                        </div>
                                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                            {item.hints.map((hint: string, hIdx: number) => (
                                                <div key={hIdx} className="flex gap-2">
                                                    <input
                                                        className="flex-1 bg-brass/10 border border-brass/20 rounded px-2 py-1 text-sm focus:border-brass/50 outline-none"
                                                        value={hint}
                                                        onChange={(e) => setFiles((prev: any[]) => {
                                                            const cp = [...prev];
                                                            cp[editingId].hints[hIdx] = e.target.value;
                                                            return cp;
                                                        })}
                                                        placeholder={`Hint #${hIdx + 1}`}
                                                    />
                                                    <button
                                                        onClick={() => setFiles((prev: any[]) => {
                                                            const cp = [...prev];
                                                            cp[editingId].hints = cp[editingId].hints.filter((_: any, i: number) => i !== hIdx);
                                                            return cp;
                                                        })}
                                                        className="text-stone hover:text-red-400 px-1"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RESIZER DRAG HANDLE */}
                    {!isEvidenceFullscreen && (
                        <div
                            onMouseDown={() => setIsResizing(true)}
                            className={`w-1.5 hover:w-2.5 bg-teal/10 hover:bg-teal/30 cursor-col-resize transition-all relative group z-20 flex items-center justify-center ${isResizing ? 'bg-teal/100 w-2.5' : ''}`}
                        >
                            <div className="h-10 w-1 bg-brass/20 rounded-full group-hover:bg-teal/50 transition-colors" />
                            {/* Visual grab handle lines */}
                            <div className="absolute flex flex-col gap-1 items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="w-0.5 h-0.5 bg-brass rounded-full" />
                                <div className="w-0.5 h-0.5 bg-brass rounded-full" />
                                <div className="w-0.5 h-0.5 bg-brass rounded-full" />
                            </div>
                        </div>
                    )}

                    {/* RIGHT PANEL: AI COPILOT */}
                    {!isEvidenceFullscreen && (
                        <div className="bg-[#0a1210] flex flex-col h-full border-l border-brass/10 flex-shrink-0" style={{ width: `${splitRatio}%` }}>
                            <div className="p-4 border-b border-brass/10 flex items-center justify-between bg-black/40">
                                <h3 className="text-sm font-black bg-gradient-to-r from-brass to-amber text-transparent bg-clip-text uppercase tracking-widest flex items-center gap-2">
                                    <span>✨</span> AI Copilot (v2.2)
                                </h3>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleAutoDetectEvidence}
                                        disabled={isChatting}
                                        className="bg-teal/20 hover:bg-teal/40 text-brass text-[10px] font-black px-2.5 py-1 rounded-sm border border-teal/30 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                                        title="Auto-Detect Evidence"
                                    >
                                        <span className={isChatting ? "animate-pulse" : ""}>✨</span>
                                        {isChatting ? "DETECTING..." : "AUTO-DETECT"}
                                    </button>
                                    <div className="text-[10px] text-stone font-mono">Panel</div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar scroll-smooth">
                                {chatHistory.length === 0 ? (
                                    <div className="text-center text-stone my-auto pt-20 flex flex-col items-center gap-4">
                                        <div className="space-y-2">
                                            <p>Ask the AI copilot to generate descriptions, suggest hints, or identify landmarks!</p>
                                            <p className="text-xs">Example: "Generate a creepy description based on the evidence boxes."</p>
                                        </div>
                                    </div>
                                ) : (
                                    chatHistory.map((msg, i) => (
                                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                            <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${msg.role === 'user' ? 'bg-teal hover:bg-teal/90 text-charcoal' : 'bg-brass/10 text-gray-200 border border-brass/20'}`}>
                                                <p className="whitespace-pre-wrap text-sm">{msg.content.replace(/```json[\s\S]*?```/g, "").trim()}</p>
                                            </div>
                                            {/* Parse actions from message */}
                                            {msg.role === 'model' && msg.content.includes("```json") && (
                                                <div className="mt-3 space-y-4 w-full max-w-[95%] animate-in fade-in slide-in-from-top-3">
                                                    {Array.from(msg.content.matchAll(/```json([\s\S]*?)```/g)).map((match: any, mIdx: number) => {
                                                        try {
                                                            const jsonStr = match[1].trim();
                                                            const action = JSON.parse(jsonStr);

                                                            const renderPreview = (data: any) => {
                                                                if (!data) return "N/A";
                                                                if (typeof data === 'string') return data;
                                                                if (Array.isArray(data)) return (
                                                                    <ul className="list-disc list-inside space-y-1">
                                                                        {data.map((item, i) => <li key={i}>{String(item)}</li>)}
                                                                    </ul>
                                                                );
                                                                return <pre className="text-[10px] overflow-x-auto bg-black/40 p-2 rounded border border-white/5">{JSON.stringify(data, null, 2)}</pre>;
                                                            };

                                                            // Consolidated Metadata (The "Full Bracket")
                                                            if (action.action === "suggestFullMetadata" || (action.description && action.hints)) {
                                                                const desc = action.data?.description || action.description;
                                                                const hnts = action.data?.hints || action.hints;
                                                                return (
                                                                    <div key={mIdx} className="bg-slate-900 border-2 border-amber/50 rounded-2xl p-4 shadow-2xl relative overflow-hidden group">
                                                                        <div className="absolute top-0 right-0 p-2 opacity-20 text-[10px] font-mono">v2.2</div>
                                                                        <div className="flex items-center gap-2 mb-4">
                                                                            <div className="p-1.5 bg-amber/20 rounded-sm text-amber">✨</div>
                                                                            <h4 className="text-xs font-black text-amber uppercase tracking-[0.2em]">Full Metadata Suggestion</h4>
                                                                        </div>

                                                                        <div className="space-y-4 mb-5">
                                                                            <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                                                                                <p className="text-[9px] font-bold text-slate-500 uppercase mb-2">Refined Description:</p>
                                                                                <p className="text-sm text-slate-200 leading-relaxed italic border-l-2 border-brass/30 pl-3">"{desc}"</p>
                                                                            </div>
                                                                            <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                                                                                <p className="text-[9px] font-bold text-slate-500 uppercase mb-2">Subtle Hints:</p>
                                                                                <div className="text-xs text-slate-300 space-y-1">{renderPreview(hnts)}</div>
                                                                            </div>
                                                                        </div>

                                                                        <button
                                                                            onClick={() => setFiles((prev: any[]) => {
                                                                                const cp = [...prev];
                                                                                if (desc) cp[editingId].description = desc;
                                                                                if (hnts) cp[editingId].hints = Array.isArray(hnts) ? hnts : [hnts];
                                                                                return cp;
                                                                            })}
                                                                            className="w-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 bg-teal hover:bg-teal/90 text-charcoal text-xs font-black px-4 py-3.5 rounded-xl shadow-[0_5px_15px_rgba(99,102,241,0.4)] transition-all transform hover:-translate-y-0.5 active:scale-95 flex items-center justify-center gap-2"
                                                                        >
                                                                            🚀 APPLY FULL REFINEMENT
                                                                        </button>
                                                                    </div>
                                                                );
                                                            }

                                                            if (action.action === "setHints") {
                                                                return (
                                                                    <div key={mIdx} className="bg-slate-900 border-2 border-brass/50 rounded-2xl p-4 shadow-xl">
                                                                        <div className="flex items-center gap-2 mb-4">
                                                                            <div className="p-1.5 bg-brass/20 rounded-sm text-brass">📝</div>
                                                                            <h4 className="text-xs font-black text-brass uppercase tracking-widest">Hints Suggestion (v2.2)</h4>
                                                                        </div>
                                                                        <div className="text-sm text-slate-200 mb-5 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/5">
                                                                            {renderPreview(action.data)}
                                                                        </div>
                                                                        <button
                                                                            onClick={() => setFiles((prev: any[]) => {
                                                                                const cp = [...prev];
                                                                                cp[editingId].hints = Array.isArray(action.data) ? action.data : [action.data];
                                                                                return cp;
                                                                            })}
                                                                            className="w-full bg-brass hover:bg-brass/90 bg-teal hover:bg-teal/90 text-charcoal text-xs font-bold px-4 py-3 rounded-xl transition-all shadow-lg active:scale-95"
                                                                        >
                                                                            Apply Hints
                                                                        </button>
                                                                    </div>
                                                                );
                                                            }
                                                            if (action.action === "setDescription") {
                                                                return (
                                                                    <div key={mIdx} className="bg-slate-900 border-2 border-teal/50 rounded-2xl p-4 shadow-xl">
                                                                        <div className="flex items-center gap-2 mb-4">
                                                                            <div className="p-1.5 bg-brass/20 rounded-sm text-teal">📖</div>
                                                                            <h4 className="text-xs font-black text-teal uppercase tracking-widest">Description Suggestion (v2.2)</h4>
                                                                        </div>
                                                                        <div className="text-sm text-slate-200 mb-5 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/5 italic">
                                                                            "{renderPreview(action.data)}"
                                                                        </div>
                                                                        <button
                                                                            onClick={() => setFiles((prev: any[]) => {
                                                                                const cp = [...prev];
                                                                                cp[editingId].description = action.data;
                                                                                return cp;
                                                                            })}
                                                                            className="w-full bg-brass hover:bg-brass/80 bg-teal hover:bg-teal/90 text-charcoal text-xs font-bold px-4 py-3 rounded-xl transition-all shadow-lg active:scale-95"
                                                                        >
                                                                            Apply Description
                                                                        </button>
                                                                    </div>
                                                                );
                                                            }
                                                        } catch (e) {
                                                            return (
                                                                <div key={mIdx} className="text-[10px] text-red-400 bg-red-900/10 p-4 rounded-xl border border-red-500/30">
                                                                    ⚠️ Parsing Failure in JSON block.
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                                {isChatting && (
                                    <div className="flex justify-start">
                                        <div className="bg-brass/10 text-stone-light rounded-2xl px-4 py-2 text-sm border border-brass/20 flex items-center gap-2">
                                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-75"></div>
                                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-150"></div>
                                        </div>
                                    </div>
                                )}
                                <div ref={chatEndRef} />
                            </div>
                            <form onSubmit={handleChat} className="p-3 bg-[#0e1a14] border-t border-brass/10 flex gap-2">
                                <input
                                    type="text"
                                    className="flex-1 bg-brass/10 border-none rounded-sm px-4 py-2 text-sm bg-teal hover:bg-teal/90 text-charcoal focus:ring-1 focus:ring-blue-500 outline-none placeholder-gray-500"
                                    placeholder="Chat with AI..."
                                    value={chatMessage}
                                    onChange={(e) => setChatMessage(e.target.value)}
                                    disabled={isChatting}
                                />
                                <button
                                    type="submit"
                                    disabled={isChatting || !chatMessage.trim()}
                                    className="px-4 py-2 bg-brass hover:bg-brass/80 disabled:opacity-50 disabled:bg-brass/20 bg-teal hover:bg-teal/90 text-charcoal font-bold rounded-sm transition-colors text-sm"
                                >
                                    Send
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.item === nextProps.item && prevProps.isLoaded === nextProps.isLoaded && prevProps.isMulti === nextProps.isMulti;
});

export function EditModal({ editingId, files, setFiles, setEditingId, isLoaded, mapSets, onSave }: any) {
    if (editingId === null) return null;

    const renderMode = editingId === 'all' ? 'all' : 'single';
    const activeItems = renderMode === 'all'
        ? files.map((f: any, i: number) => ({ item: f, idx: i }))
        : [{ item: files[editingId], idx: editingId as number }];

    return (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col overflow-hidden">
            {/* Sticky top bar */}
            <div className="shrink-0 bg-[#0e1a14]/95 backdrop-blur-md border-b border-brass/10 z-[60] px-6 py-3 flex justify-between items-center shadow-2xl">
                <div className="flex items-center gap-6">
                    <h2 className="text-xl font-bold bg-teal hover:bg-teal/90 text-charcoal flex items-center gap-2">
                        <span className="p-1.5 bg-brass/20 rounded-sm text-teal">🚀</span>
                        {renderMode === 'all'
                            ? `Editing ${files.length} Locations Concurrently`
                            : `Edit Location: ${activeItems[0]?.item?.file?.name || activeItems[0]?.item?.photographer || "Unnamed"}`}
                    </h2>
                    {renderMode !== 'all' && (
                        <div className="flex items-center bg-brass/10 rounded-sm border border-brass/20 overflow-hidden shadow-inner">
                            <button
                                onClick={() => setEditingId(Math.max(0, (editingId as number) - 1))}
                                disabled={editingId === 0}
                                className="px-4 py-2 hover:bg-brass/20 disabled:opacity-20 text-xs font-bold border-r border-brass/20 transition-colors"
                            >
                                ← PREV
                            </button>
                            <span className="px-4 py-2 text-xs font-mono text-stone-light bg-black/20">
                                {(editingId as number) + 1} / {files.length}
                            </span>
                            <button
                                onClick={() => setEditingId(Math.min(files.length - 1, (editingId as number) + 1))}
                                disabled={editingId === files.length - 1}
                                className="px-4 py-2 hover:bg-brass/20 disabled:opacity-20 text-xs font-bold transition-colors"
                            >
                                NEXT →
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    {renderMode === 'all' && (
                        <span className="text-xs text-stone-light font-mono bg-brass/10 px-3 py-1.5 rounded-sm border border-brass/20">
                            Scroll ↕ to switch between locations
                        </span>
                    )}
                    <button
                        onClick={() => setEditingId(null)}
                        className="px-6 py-2 bg-red-600/20 hover:bg-red-600 hover:bg-teal hover:bg-teal/90 text-charcoal rounded-sm text-red-400 font-black border border-red-500/50 text-xs uppercase tracking-widest shadow-lg transition-all active:scale-95 flex items-center gap-2"
                    >
                        <span>×</span> Exit Editor
                    </button>
                </div>
            </div>

            {/* Main content area — scrollable list of editors */}
            <div className={renderMode === 'all'
                ? 'flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-10 p-6'
                : 'flex-1 overflow-hidden p-4'
            }>
                {activeItems.map((entry: { item: any; idx: number }) => (
                    <SingleLocationEditor
                        key={entry.item.id}
                        item={entry.item}
                        editingIdx={entry.idx}
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
