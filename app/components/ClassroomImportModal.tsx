import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';

interface ClassroomImportModalProps {
    accessToken: string;
    onClose: () => void;
    onAddFile: (file: File) => void;
    onAddExtractionQueue: (doc: { name: string, items: { blob: Blob, url: string, name: string }[], preselectedIndex?: number }) => void;
}

export function ClassroomImportModal({ accessToken, onClose, onAddFile, onAddExtractionQueue }: ClassroomImportModalProps) {
    const [courses, setCourses] = useState<any[]>([]);
    const [selectedCourse, setSelectedCourse] = useState<any>(null);
    const [assignments, setAssignments] = useState<any[]>([]);
    const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
    const [submissions, setSubmissions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<string>("Fetching courses...");
    const [missingStudents, setMissingStudents] = useState<string[]>([]);
    const [completed, setCompleted] = useState(false);

    useEffect(() => {
        fetchCourses();
    }, []);

    const fetchCourses = async () => {
        try {
            setLoading(true);
            const res = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&teacherId=me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) {
                const errText = await res.text();
                try {
                    const errJson = JSON.parse(errText);
                    throw new Error(errJson.error?.message || `HTTP ${res.status}`);
                } catch {
                    throw new Error(`HTTP ${res.status}: ${errText}`);
                }
            }
            const data: any = await res.json();
            setCourses(data.courses || []);
            setLoading(false);
        } catch (e: any) {
            console.error(e);
            setStatus(`API Error: ${e.message}`);
            setLoading(false);
        }
    };

    const fetchAssignments = async (courseId: string) => {
        try {
            setLoading(true);
            setStatus("Fetching assignments...");
            const res = await fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/courseWork`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const data: any = await res.json();
            setAssignments(data.courseWork || []);
            setSelectedCourse(courseId);
            setLoading(false);
        } catch (e) {
            console.error(e);
            setStatus("Failed to load assignments");
            setLoading(false);
        }
    };

    const scrapeTargetPhoto = async (items: { blob: Blob, name: string }[]): Promise<{ bestIndex: number, confidence: string }> => {
        try {
            const toBase64 = (blob: Blob) => new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
            });

            // Need to resize massive images before sending to AI to avoid payload limit
            const compressBlob = async (blob: Blob) => {
                const img = new Image();
                img.src = URL.createObjectURL(blob);
                await new Promise(r => { img.onload = r; });
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                let scale = 1;
                if (img.width > MAX_WIDTH) scale = MAX_WIDTH / img.width;
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                URL.revokeObjectURL(img.src);
                return dataUrl.split(',')[1]; // returns base64
            };

            const payloadImages = await Promise.all(items.map(async item => {
                return { mimeType: 'image/jpeg', data: await compressBlob(item.blob) };
            }));

            const fd = new FormData();
            fd.append('intent', 'filter_target_image');
            fd.append('images', JSON.stringify(payloadImages));

            const res = await fetch('/api/admin/mass-add', { method: 'POST', body: fd });
            const data: any = await res.json();
            if (data.success && data.bestIndex !== undefined) {
                return { bestIndex: data.bestIndex, confidence: data.confidence || "LOW" };
            }
            return { bestIndex: -1, confidence: "LOW" };
        } catch (e) {
            console.error("AI filter failed:", e);
            return { bestIndex: -1, confidence: "LOW" };
        }
    };

    const runImport = async () => {
        try {
            setLoading(true);
            setStatus("Fetching student submissions...");
            // 1. Fetch Students manually to map userIds to real fullNames
            let studentNameMap: Record<string, string> = {};
            try {
                let pageToken = '';
                do {
                    const url = `https://classroom.googleapis.com/v1/courses/${selectedCourse}/students` + (pageToken ? `?pageToken=${pageToken}` : '');
                    const rosterRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
                    const rosterData: any = await rosterRes.json();
                    if (!rosterRes.ok) throw new Error(rosterData.error?.message || 'Roster fetch failed');
                    (rosterData.students || []).forEach((stu: any) => {
                        studentNameMap[stu.userId] = stu.profile?.name?.fullName || stu.profile?.emailAddress || `Student_${stu.userId}`;
                    });
                    pageToken = rosterData.nextPageToken || '';
                } while (pageToken);
            } catch (e) {
                console.warn("Could not fetch roster, names will fallback to userId", e);
            }

            const res = await fetch(`https://classroom.googleapis.com/v1/courses/${selectedCourse}/courseWork/${selectedAssignment.id}/studentSubmissions`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const data: any = await res.json();
            const subs = data.studentSubmissions || [];

            let processed = 0;
            for (const sub of subs) {
                const attachments = sub.assignmentSubmission?.attachments || [];
                const studentName = studentNameMap[sub.userId] || `Student_${sub.userId}`;
                const finalStudentIdentifier = studentName;
                
                let studentRawImages: { blob: Blob, name: string }[] = [];

                for (const att of attachments) {
                    if (att.driveFile) {
                        const fileId = att.driveFile.id;
                        const mime = att.driveFile.alternateLink?.includes('presentation') ? 'application/vnd.google-apps.presentation' : 'file';
                        const originalName = att.driveFile.title || 'Untitled';
                        let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
                        let isPdf = false;
                        let isPptx = false;

                        if (mime === 'application/vnd.google-apps.presentation') {
                            setStatus(`Exporting ${studentName}'s Slides to PPTX...`);
                            // Huge update: Exporting to PPTX instead of PDF ensures we extract ONLY the inner photos and ignore the slide background!
                            url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.presentationml.presentation`;
                            isPptx = true;
                        } else if (originalName.endsWith('.pdf')) {
                            isPdf = true;
                        } else if (originalName.endsWith('.pptx')) {
                            isPptx = true;
                        }

                        // Download the file Blob
                        setStatus(`Downloading ${studentName}'s attachment...`);
                        const dr = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
                        if (!dr.ok) continue;
                        const fileBlob = await dr.blob();

                        if (isPdf) {
                            setStatus(`Extracting PDF pages for ${studentName}...`);
                            const pdfjsLib = await import('pdfjs-dist');
                            pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
                            const arrayBuffer = await fileBlob.arrayBuffer();
                            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                            
                            for (let i = 1; i <= pdf.numPages; i++) {
                                const page = await pdf.getPage(i);
                                const viewport = page.getViewport({ scale: 1.5 });
                                const canvas = document.createElement('canvas');
                                const context = canvas.getContext('2d');
                                canvas.width = viewport.width;
                                canvas.height = viewport.height;
                                if (context) {
                                    await page.render({ canvasContext: context, viewport } as any).promise;
                                    const imgBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
                                    if (imgBlob) studentRawImages.push({ blob: imgBlob, name: `Page_${i}` });
                                }
                            }
                        } else if (isPptx) {
                            setStatus(`Extracting PowerPoint media for ${studentName}...`);
                            const zip = await JSZip.loadAsync(fileBlob);
                            const mediaFiles = Object.keys(zip.files).filter(p => p.startsWith('ppt/media/'));
                            for (const path of mediaFiles) {
                                const zipFile = zip.files[path];
                                if (zipFile.dir) continue;
                                const imgBlob = await zipFile.async('blob');
                                studentRawImages.push({ blob: imgBlob, name: path.split('/').pop() || 'image' });
                            }
                        } else if (fileBlob.type.startsWith('image/')) {
                            studentRawImages.push({ blob: fileBlob, name: 'DirectImage' });
                        }
                    }
                } // End attachment loop

                if (studentRawImages.length > 0) {
                    setStatus(`Running AI Vision Check for ${studentName}...`);
                    const { bestIndex } = await scrapeTargetPhoto(studentRawImages);
                    
                    const manualItems = studentRawImages.map((img, idx) => ({
                        blob: img.blob,
                        url: URL.createObjectURL(img.blob),
                        name: `${finalStudentIdentifier}_${idx}`
                    }));
                    
                    onAddExtractionQueue({ 
                        name: finalStudentIdentifier, 
                        items: manualItems, 
                        preselectedIndex: bestIndex !== -1 ? bestIndex : -1 
                    });
                } else if (attachments.length === 0) {
                    setMissingStudents(prev => [...prev, studentName]);
                } else {
                    let foundAnyMedia = false;
                    for (const att of attachments) {
                        const originalName = att.driveFile?.title || '';
                        const mime = att.driveFile?.alternateLink?.includes('presentation') ? 'application/vnd.google-apps.presentation' : 'file';
                        if (mime === 'application/vnd.google-apps.presentation' || originalName.endsWith('.pdf') || originalName.endsWith('.pptx') || att.driveFile?.mimeType?.startsWith('image/')) {
                            foundAnyMedia = true;
                        }
                    }
                    if (!foundAnyMedia) setMissingStudents(prev => [...prev, studentName]);
                }

                processed++;
                setStatus(`Processed ${processed}/${subs.length} submissions...`);
            }
            
            setStatus("Import Complete!");
            setLoading(false);
            setCompleted(true);
        } catch (e: any) {
            console.error(e);
            setStatus(`Error: ${e.message}`);
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-emerald-500/50 rounded-2xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
                    <h2 className="text-xl font-bold text-emerald-400">Classroom Intelligent Scraper</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white font-bold">✕ Close</button>
                </div>

                <div className="p-8 flex flex-col gap-6">
                    {loading && (
                        <div className="text-center p-8 bg-black/20 rounded-xl border border-white/5 shadow-inner">
                            <div className="w-8 h-8 rounded-full border-t-2 border-emerald-500 animate-spin mx-auto mb-4" />
                            <p className="font-mono text-sm text-emerald-400">{status}</p>
                        </div>
                    )}

                    {completed && !loading && (
                        <div className="bg-emerald-900/10 border border-emerald-500/30 p-6 rounded-xl flex flex-col items-center text-center gap-4">
                            <h3 className="text-lg font-bold text-white">Import Scrape Complete!</h3>
                            <p className="text-sm text-gray-400">
                                All processed items have been loaded into your Extraction Queue. You can now manually review each student's location photo.
                            </p>
                            
                            {missingStudents.length > 0 && (
                                <div className="mt-4 w-full text-left bg-red-900/20 border border-red-500/30 rounded-lg p-4 max-h-48 overflow-y-auto custom-scrollbar">
                                    <h4 className="text-red-400 font-bold text-sm mb-2">Missing / Invalid Submissions ({missingStudents.length})</h4>
                                    <p className="text-xs text-red-300/80 mb-2">The following students either did not attach any files, or attached non-image documents (like Canva Links or Docs) which cannot be scraped.</p>
                                    <ul className="text-xs text-red-200 list-disc pl-4 grid grid-cols-2 gap-1">
                                        {Array.from(new Set(missingStudents)).map(s => <li key={s}>{s}</li>)}
                                    </ul>
                                </div>
                            )}

                            <div className="flex gap-4 w-full mt-2">
                                <button onClick={onClose} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg shadow-[0_4px_15px_rgba(16,185,129,0.3)] transition-all active:scale-95">View Extraction Queue</button>
                            </div>
                        </div>
                    )}

                    {!loading && !selectedCourse && !completed && (
                        <div className="text-center p-8 bg-black/20 rounded-xl border border-white/5 shadow-inner">
                            <div className="w-8 h-8 rounded-full border-t-2 border-emerald-500 animate-spin mx-auto mb-4" />
                            <p className="font-mono text-sm text-emerald-400">{status}</p>
                        </div>
                    )}

                    {!loading && !selectedCourse && (
                        <div>
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">1. Select Google Classroom Course</h3>
                            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto custom-scrollbar">
                                {courses.map(c => (
                                    <button 
                                        key={c.id} 
                                        onClick={() => fetchAssignments(c.id)}
                                        className="text-left p-4 bg-gray-800 hover:bg-gray-700 rounded-lg flex flex-col border border-gray-700 hover:border-emerald-500/50 transition-colors"
                                    >
                                        <span className="font-bold text-white">{c.name}</span>
                                        <span className="text-xs text-gray-400">{c.section || 'No section'} • {c.courseState}</span>
                                    </button>
                                ))}
                                {courses.length === 0 && <p className="text-gray-500 italic">No active courses found where you are a teacher.</p>}
                            </div>
                        </div>
                    )}

                    {!loading && selectedCourse && !selectedAssignment && (
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">2. Select Assignment</h3>
                                <button onClick={() => setSelectedCourse(null)} className="text-xs text-blue-400 hover:underline">← Back to Courses</button>
                            </div>
                            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto custom-scrollbar">
                                {assignments.map(a => (
                                    <button 
                                        key={a.id} 
                                        onClick={() => setSelectedAssignment(a)}
                                        className="text-left p-4 bg-gray-800 hover:bg-gray-700 rounded-lg flex flex-col border border-gray-700 hover:border-emerald-500/50 transition-colors"
                                    >
                                        <span className="font-bold text-white">{a.title}</span>
                                        <span className="text-xs text-gray-400">Due: {a.dueDate ? `${a.dueDate.year}-${a.dueDate.month}-${a.dueDate.day}` : 'No due date'}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {!loading && selectedAssignment && (
                        <div className="bg-emerald-900/10 border border-emerald-500/30 p-6 rounded-xl flex flex-col items-center text-center gap-4">
                            <h3 className="text-lg font-bold text-white">Ready to Scrape: <span className="text-emerald-400">{selectedAssignment.title}</span></h3>
                            <p className="text-sm text-gray-400">
                                This will download all student submissions, dynamically export Google Slides to PDF, extract all images, and use AI to filter out map screenshots. The final location photos will be added to your Mass Add workspace.
                            </p>
                            <div className="flex gap-4 w-full mt-4">
                                <button onClick={() => setSelectedAssignment(null)} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 font-bold rounded-lg transition-colors border border-gray-700">Cancel</button>
                                <button onClick={runImport} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg shadow-[0_4px_15px_rgba(16,185,129,0.3)] transition-all active:scale-95">START SCRAPER 🚀</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
