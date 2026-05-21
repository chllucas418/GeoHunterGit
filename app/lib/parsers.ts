import JSZip from 'jszip';

export interface ExtractedImage {
    blob: Blob;
    url: string;
    name: string;
}

/**
 * Extracts images from PPTX or DOCX files locally.
 */
export async function extractOfficeImages(file: File, extension: 'pptx' | 'docx'): Promise<ExtractedImage[]> {
    const zip = await JSZip.loadAsync(file);
    const mediaDir = extension === 'pptx' ? 'ppt/media/' : 'word/media/';
    const mediaFiles = Object.keys(zip.files).filter(path => path.startsWith(mediaDir));
    
    const items: ExtractedImage[] = [];
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
    return items;
}

/**
 * Extracts pages as images from PDF files locally.
 */
export async function extractPdfImages(file: File): Promise<ExtractedImage[]> {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const items: ExtractedImage[] = [];

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
    return items;
}
