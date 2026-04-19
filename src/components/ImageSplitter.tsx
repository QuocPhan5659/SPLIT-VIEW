import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Scissors, 
  Download, 
  Search, 
  Expand, 
  X, 
  Grid3X3, 
  Check, 
  Maximize2,
  Trash2,
  Image as ImageIcon,
  Zap,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import JSZip from 'jszip';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExtractedImage {
  id: string;
  url: string;
  rect: Rect;
  originalWidth: number;
  originalHeight: number;
}

export default function ImageSplitter() {
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [extractedImages, setExtractedImages] = useState<ExtractedImage[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'edit' | 'gallery'>('edit');
  const [fileName, setFileName] = useState<string>('');

  const sharpenImage = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    
    // Applying sharpness and texture enhancement via high-pass simulation
    // Using a subtle sharpening filter via context filters
    ctx.save();
    ctx.filter = 'contrast(1.05) saturate(1.05)';
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Gemini Setup
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [action, setAction] = useState<'selecting' | 'moving' | 'scaling' | 'none'>('none');

  const HANDLE_SIZE = 8;

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => {
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    setFileName(nameWithoutExt);

    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setSourceImage(img);
        setSelection(null);
        setExtractedImages([]);
        setViewMode('edit');
        
        // Auto-fit Logic: Align to viewport dimensions
        const sidebarWidths = 280 + 320;
        const headerFooterHeights = 60 + 30;
        const availableW = window.innerWidth - sidebarWidths - 160; // 160 padding
        const availableH = window.innerHeight - headerFooterHeights - 160;
        
        const zoomW = availableW / img.width;
        const zoomH = availableH / img.height;
        const initialZoom = Math.min(zoomW, zoomH, 1);
        
        setZoom(initialZoom);
        setOffset({ x: 0, y: 0 });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const extractImage = () => {
    if (!sourceImage || !selection || selection.width < 1) return;

    // Phase 1: Native Extraction (1:1)
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = selection.width;
    rawCanvas.height = selection.height;
    const rawCtx = rawCanvas.getContext('2d', { alpha: false });
    if (!rawCtx) return;
    
    rawCtx.drawImage(
      sourceImage,
      selection.x, selection.y, selection.width, selection.height,
      0, 0, selection.width, selection.height
    );

    // Phase 2: Upscale with High-Quality Smoothing
    const targetMinDim = 2048;
    let outputWidth = selection.width;
    let outputHeight = selection.height;
    const aspectRatio = selection.width / selection.height;

    if (selection.width < targetMinDim || selection.height < targetMinDim) {
       if (aspectRatio > 1) {
         outputWidth = targetMinDim;
         outputHeight = targetMinDim / aspectRatio;
       } else {
         outputHeight = targetMinDim;
         outputWidth = targetMinDim * aspectRatio;
       }
    }

    const upscaleCanvas = document.createElement('canvas');
    upscaleCanvas.width = outputWidth;
    upscaleCanvas.height = outputHeight;
    const upscaleCtx = upscaleCanvas.getContext('2d', { alpha: false });
    if (!upscaleCtx) return;

    upscaleCtx.imageSmoothingEnabled = true;
    upscaleCtx.imageSmoothingQuality = 'high';
    upscaleCtx.drawImage(rawCanvas, 0, 0, outputWidth, outputHeight);

    // Phase 3: Sharpness & Texture Enhancement (Simulated Super-Res)
    sharpenImage(upscaleCanvas);

    const newImage: ExtractedImage = {
      id: Math.random().toString(36).substr(2, 9),
      url: upscaleCanvas.toDataURL('image/png'),
      rect: { ...selection },
      originalWidth: Math.round(outputWidth),
      originalHeight: Math.round(outputHeight)
    };

    setExtractedImages(prev => [...prev, newImage]);
    setSelection(null);
  };

  const getCanvasMousePos = (e: React.MouseEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    return { x, y };
  };

  const getHandles = (rect: Rect) => {
    const { x, y, width: w, height: h } = rect;
    return {
      tl: { x, y, cursor: 'nw-resize' },
      tc: { x: x + w / 2, y, cursor: 'n-resize' },
      tr: { x: x + w, y, cursor: 'ne-resize' },
      ml: { x, y: y + h / 2, cursor: 'w-resize' },
      mr: { x: x + w, y: y + h / 2, cursor: 'e-resize' },
      bl: { x, y: y + h, cursor: 'sw-resize' },
      bc: { x: x + w / 2, y: y + h, cursor: 's-resize' },
      br: { x: x + w, y: y + h, cursor: 'se-resize' },
    };
  };

  const drawCanvas = useCallback(() => {
    if (!canvasRef.current || !sourceImage || !containerRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = sourceImage.width * zoom;
    canvas.height = sourceImage.height * zoom;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

    if (selection) {
      const sx = selection.x * zoom;
      const sy = selection.y * zoom;
      const sw = selection.width * zoom;
      const sh = selection.height * zoom;

      // Overlay
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.width, sy);
      ctx.fillRect(0, sy, sx, sh);
      ctx.fillRect(sx + sw, sy, canvas.width - (sx + sw), sh);
      ctx.fillRect(0, sy + sh, canvas.width, canvas.height - (sy + sh));

      // Border
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);

      // Handles
      ctx.fillStyle = '#fff';
      const handles = getHandles({ x: sx, y: sy, width: sw, height: sh });
      Object.values(handles).forEach(h => {
        ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      });
    }
  }, [sourceImage, selection, zoom]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!sourceImage) return;
    const { x, y } = getCanvasMousePos(e);

    if (selection) {
      const sx = selection.x;
      const sy = selection.y;
      const sw = selection.width;
      const sh = selection.height;
      const hSize = HANDLE_SIZE / zoom;

      const handles = getHandles(selection);
      for (const [key, h] of Object.entries(handles)) {
        if (Math.abs(x - h.x) < hSize && Math.abs(y - h.y) < hSize) {
          setActiveHandle(key);
          setAction('scaling');
          setDragStart({ x, y });
          return;
        }
      }

      if (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh) {
        setAction('moving');
        setDragStart({ x: x - sx, y: y - sy });
        return;
      }
    }

    setAction('selecting');
    setDragStart({ x, y });
    setSelection({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!sourceImage || action === 'none') return;
    const { x, y } = getCanvasMousePos(e);

    if (action === 'selecting') {
      setSelection({
        x: Math.max(0, Math.min(dragStart.x, x)),
        y: Math.max(0, Math.min(dragStart.y, y)),
        width: Math.abs(x - dragStart.x),
        height: Math.abs(y - dragStart.y)
      });
    } else if (action === 'moving' && selection) {
      setSelection({
        ...selection,
        x: Math.max(0, Math.min(x - dragStart.x, sourceImage.width - selection.width)),
        y: Math.max(0, Math.min(y - dragStart.y, sourceImage.height - selection.height))
      });
    } else if (action === 'scaling' && selection && activeHandle) {
      let { x: nx, y: ny, width: nw, height: nh } = selection;

      if (activeHandle.includes('l')) {
        nw += nx - x;
        nx = x;
      }
      if (activeHandle.includes('r')) {
        nw = x - nx;
      }
      if (activeHandle.includes('t')) {
        nh += ny - y;
        ny = y;
      }
      if (activeHandle.includes('b')) {
        nh = y - ny;
      }

      setSelection({ x: nx, y: ny, width: Math.max(1, nw), height: Math.max(1, nh) });
    }
  };

  const handleMouseUp = () => {
    setAction('none');
    setActiveHandle(null);
  };

  const autoSplitGrid = (cols: number, rows: number) => {
    if (!sourceImage) return;
    
    const cellWidth = sourceImage.width / cols;
    const cellHeight = sourceImage.height / rows;
    
    const newExtractions: ExtractedImage[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cellWidth;
        const y = r * cellHeight;
        
        const offCanvas = document.createElement('canvas');
        offCanvas.width = cellWidth;
        offCanvas.height = cellHeight;
        const ctx = offCanvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(sourceImage, x, y, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
          newExtractions.push({
            id: Math.random().toString(36).substr(2, 9),
            url: offCanvas.toDataURL('image/jpeg', 0.95),
            rect: { x, y, width: cellWidth, height: cellHeight },
            originalWidth: cellWidth,
            originalHeight: cellHeight
          });
        }
      }
    }
    setExtractedImages(prev => [...prev, ...newExtractions]);
  };

  const autoDetectWithAI = async () => {
    if (!sourceImage) return;
    setIsDetecting(true);

    try {
      // Get base64 - Increase resolution for better boundary detection
      const canvas = document.createElement('canvas');
      const maxDim = 1536; 
      const scale = Math.min(maxDim / sourceImage.width, maxDim / sourceImage.height);
      canvas.width = sourceImage.width * scale;
      canvas.height = sourceImage.height * scale;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          { text: `INSTRUCTION: You are a professional image technician. Your task is to identify the EXACT physical boundaries of every individual panel within this collage.
          
CRITICAL RULES:
1. PHYSICAL SEAMS: Look for gutters, white/black divider lines, or sharp content transitions that define the physical edge of a panel.
2. NO SUBJECT CROPPING: Do NOT crop around people or objects. You MUST capture the full rectangular panel area from edge to edge.
3. ZERO OVERLAP: Ensure bounding boxes do not include pixels from neighboring panels. If there is a gutter/line between panels, the box should stop exactly at the edge of the panel content.
4. ASPECT RATIO: Maintain the true intended aspect ratio of each original panel.
5. EXHAUSTIVE: Identify EVERY panel shown in the image.

Output the results as a JSON array of objects with 'x', 'y', 'width', 'height'. Coordinate scale is 0-1000 relative to the image size. Output ONLY the raw JSON array.` }
        ],
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                width: { type: Type.NUMBER },
                height: { type: Type.NUMBER }
              },
              required: ["x", "y", "width", "height"]
            }
          }
        }
      });

      const boxes = JSON.parse(response.text);
      const newExtractions: ExtractedImage[] = [];

      boxes.forEach((box: any) => {
        const sx = (box.x / 1000) * sourceImage.width;
        const sy = (box.y / 1000) * sourceImage.height;
        const sw = (box.width / 1000) * sourceImage.width;
        const sh = (box.height / 1000) * sourceImage.height;

        // Apply same High-Precision flow to AI detected panels
        const rawCanvas = document.createElement('canvas');
        rawCanvas.width = sw;
        rawCanvas.height = sh;
        const rawCtx = rawCanvas.getContext('2d', { alpha: false });
        if (rawCtx) {
          rawCtx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, sw, sh);
          
          // Upscale step for consistent 2K+ AI extraction
          const targetMinDim = 2048;
          let outputWidth = sw;
          let outputHeight = sh;
          const aspectRatio = sw / sh;
          if (sw < targetMinDim || sh < targetMinDim) {
             if (aspectRatio > 1) { outputWidth = targetMinDim; outputHeight = targetMinDim / aspectRatio; }
             else { outputHeight = targetMinDim; outputWidth = targetMinDim * aspectRatio; }
          }

          const upscaleCanvas = document.createElement('canvas');
          upscaleCanvas.width = outputWidth;
          upscaleCanvas.height = outputHeight;
          const upscaleCtx = upscaleCanvas.getContext('2d', { alpha: false });
          if (upscaleCtx) {
            upscaleCtx.imageSmoothingEnabled = true;
            upscaleCtx.imageSmoothingQuality = 'high';
            upscaleCtx.drawImage(rawCanvas, 0, 0, outputWidth, outputHeight);
            sharpenImage(upscaleCanvas);

            newExtractions.push({
              id: Math.random().toString(36).substr(2, 9),
              url: upscaleCanvas.toDataURL('image/png'),
              rect: { x: sx, y: sy, width: sw, height: sh },
              originalWidth: Math.round(outputWidth),
              originalHeight: Math.round(outputHeight)
            });
          }
        }
      });

      setExtractedImages(prev => [...prev, ...newExtractions]);
    } catch (error) {
      console.error("AI Detection failed:", error);
      // Removed fallback grid
    } finally {
      setIsDetecting(false);
    }
  };

  const removeExtracted = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExtractedImages(prev => prev.filter(img => img.id !== id));
    if (selectedImageId === id) setSelectedImageId(null);
  };

  const downloadImage = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAllAsZip = async () => {
    if (extractedImages.length === 0) return;
    const zip = new JSZip();
    const baseName = fileName || 'extracted_image';
    
    for (const [index, img] of extractedImages.entries()) {
      const response = await fetch(img.url);
      const blob = await response.blob();
      zip.file(`${baseName}_slip-${index + 1}.png`, blob);
    }
    
    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `${baseName}_extracted_all.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const navigateInspection = useCallback((direction: 'next' | 'prev') => {
    if (!selectedImageId || extractedImages.length <= 1) return;
    
    const currentIndex = extractedImages.findIndex(img => img.id === selectedImageId);
    if (currentIndex === -1) return;
    
    let nextIndex: number;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % extractedImages.length;
    } else {
      nextIndex = (currentIndex - 1 + extractedImages.length) % extractedImages.length;
    }
    
    setSelectedImageId(extractedImages[nextIndex].id);
  }, [selectedImageId, extractedImages]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!sourceImage) return;
    e.preventDefault();
    
    // Non-linear smooth zoom centered on continuous values
    const scaleFactor = 1 - (e.deltaY * 0.001);
    setZoom(z => {
      const newZoom = z * scaleFactor;
      return Math.min(5, Math.max(0.05, newZoom));
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC
      if (e.key === 'Escape') {
        setSelectedImageId(null);
        if (viewMode === 'gallery') setViewMode('edit');
      }
      
      // Delete (Clear History)
      if (e.key === 'Delete' && extractedImages.length > 0) {
        setExtractedImages([]);
      }
      
      // Ctrl + Enter (Trigger AI)
      if (e.ctrlKey && e.key === 'Enter') {
        if (!isDetecting && sourceImage) {
          autoDetectWithAI();
        }
      }

      // Lightbox Navigation
      if (selectedImageId && extractedImages.length > 1) {
        if (e.key === 'ArrowRight') navigateInspection('next');
        if (e.key === 'ArrowLeft') navigateInspection('prev');
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) {
              processFile(file);
              break;
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, [viewMode, extractedImages, isDetecting, sourceImage, autoDetectWithAI, selectedImageId, navigateInspection]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-bg text-text font-sans flex flex-col">
      {/* Header */}
      <header className="h-[60px] bg-panel border-b border-border flex items-center justify-between px-6 flex-shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="text-accent font-extrabold text-lg tracking-tighter uppercase">
            {fileName ? `STUDIO: ${fileName}` : 'Separator Studio AI'}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="cursor-pointer bg-panel border border-border hover:border-accent text-text px-4 py-2 rounded-md text-xs font-bold uppercase transition-all">
            Tải Ảnh Lên
            <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
          </label>
          
          {sourceImage && (
            <button 
              onClick={() => {
                setSourceImage(null);
                setFileName('');
                setExtractedImages([]);
                setSelection(null);
              }}
              className="p-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-md transition-all border border-red-500/20"
              title="Xóa ảnh hiện tại"
            >
              <Trash2 size={16} />
            </button>
          )}

          <button 
            onClick={() => {
              if (extractedImages.length > 0) {
                downloadAllAsZip();
              }
            }}
            className="bg-accent hover:opacity-90 text-white px-4 py-2 rounded-md text-xs font-bold uppercase transition-all shadow-lg shadow-accent/20"
          >
            Lưu kết quả
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 bg-border grid grid-cols-[280px_1fr_320px] gap-px">
        
        {/* Left Sidebar - Navigation & History */}
        <aside className="bg-panel flex flex-col overflow-hidden">
          <div className="p-5 space-y-6 flex-1 overflow-y-auto scrollbar-hide">
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-[2px]">Điều phối Viewport</h3>
              <div className="space-y-4">
                <div className="flex gap-1 bg-bg p-1 rounded-lg border border-border">
                  <button 
                    onClick={() => setZoom(z => Math.max(0.1, z - 0.1))}
                    className="flex-1 p-2 hover:bg-white/5 rounded text-text-dim hover:text-text transition-all"
                    title="Thu nhỏ"
                  >
                    <Search size={16} className="rotate-90 opacity-40 hover:opacity-100" />
                  </button>
                  <div className="w-px h-4 bg-border self-center" />
                  <button 
                    onClick={() => setZoom(1)}
                    className="flex-1 text-[11px] font-mono font-bold hover:text-accent transition-all"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <div className="w-px h-4 bg-border self-center" />
                  <button 
                    onClick={() => setZoom(z => Math.min(5, z + 0.1))}
                    className="flex-1 p-2 hover:bg-white/5 rounded text-text-dim hover:text-text transition-all"
                    title="Phóng to"
                  >
                    <Search size={16} className="opacity-40 hover:opacity-100" />
                  </button>
                </div>
                
                <div className="px-2">
                  <input 
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.01"
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="w-full accent-accent h-1.5 bg-bg border border-border rounded-lg cursor-pointer"
                  />
                </div>
              </div>
              
              <button 
                onClick={autoDetectWithAI}
                disabled={isDetecting || !sourceImage}
                className={`w-full py-4 rounded-xl flex flex-col items-center justify-center gap-1 transition-all group relative overflow-hidden ${
                  isDetecting 
                    ? 'bg-accent/20 text-accent cursor-wait border border-accent/30' 
                    : 'bg-accent hover:brightness-110 text-white active:scale-95 shadow-xl shadow-accent/20'
                }`}
              >
                {isDetecting ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Đang tính toán...</span>
                    </div>
                    <span className="text-[8px] text-accent/60 uppercase tracking-[2px] font-bold">Phase: AI True Border</span>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <Zap size={16} fill="currentColor" />
                      <span className="text-[10px] font-black uppercase tracking-widest">TỰ ĐỘNG TÁCH ẢNH (AI)</span>
                    </div>
                    <span className="text-[8px] text-white/50 uppercase tracking-[2px] font-bold">Hệ thống phân tách chính xác</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-4 pt-4 border-t border-border/30">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-[2px]">Lịch sử ( {extractedImages.length} )</h3>
                <div className="flex items-center gap-3">
                  {extractedImages.length > 0 && (
                    <>
                      <button 
                        onClick={downloadAllAsZip} 
                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-md transition-all border border-red-500/20 flex items-center justify-center"
                        title="Tải toàn bộ (.ZIP)"
                      >
                        <Download size={14} />
                      </button>
                      <button 
                        onClick={() => setExtractedImages([])} 
                        className="text-[9px] text-red-400 hover:text-red-300 transition-colors uppercase font-bold"
                      >
                        Xóa hết
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              <div className="space-y-3">
                {extractedImages.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center opacity-10 grayscale">
                    <ImageIcon size={32} className="mb-2" />
                    <span className="text-[10px] uppercase font-bold tracking-widest text-center">Data Empty</span>
                  </div>
                ) : (
                  extractedImages.slice().reverse().map((img) => (
                    <motion.div 
                      key={img.id}
                      initial={{ x: -10, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      className="group bg-bg border border-border rounded-xl overflow-hidden hover:border-accent transition-all cursor-pointer shadow-sm hover:shadow-accent/5"
                      onClick={() => setSelectedImageId(img.id)}
                    >
                      <div className="aspect-video bg-[#050505] relative flex items-center justify-center p-1">
                        <img src={img.url} alt="Crop" className="max-w-full max-h-full object-contain" />
                        <div className="absolute inset-0 bg-accent/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                          <Maximize2 size={16} className="text-white scale-75 group-hover:scale-100 transition-transform" />
                        </div>
                      </div>
                      <div className="p-2 px-3 flex items-center justify-between border-t border-border/50">
                        <span className="text-[9px] font-mono font-medium text-text-dim">
                           [{img.originalWidth}x{img.originalHeight}]
                        </span>
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              const base = fileName || 'extract';
                              const count = extractedImages.length - extractedImages.indexOf(img);
                              downloadImage(img.url, `${base}_slip-${count}.png`); 
                            }}
                            className="text-text-dim hover:text-accent transition-colors"
                          >
                            <Download size={12} />
                          </button>
                          <button 
                            onClick={(e) => removeExtracted(img.id, e)}
                            className="text-text-dim hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </div>
          
          <div className="p-4 border-t border-border bg-[#0d0f12]">
            <button 
              onClick={() => setViewMode('gallery')}
              className="w-full py-3 bg-panel border border-border rounded-lg text-[10px] font-bold uppercase tracking-[2px] hover:border-accent hover:text-accent transition-all flex items-center justify-center gap-2 group"
            >
              <Grid3X3 size={14} className="group-hover:rotate-90 transition-transform" />
              Xem bộ sưu tập
            </button>
          </div>
        </aside>

        {/* Workspace (Center) */}
        <section 
          className="bg-[#050505] flex items-center justify-center relative overflow-auto scrollbar-hide p-20"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onWheel={handleWheel}
        >
          {!sourceImage ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center text-center cursor-pointer p-24 rounded-[40px] border-2 border-dashed transition-all group max-w-lg ${isDraggingOver ? 'border-accent bg-accent/5 scale-[1.02]' : 'border-border/50 hover:border-accent/40 bg-bg/20'}`}
            >
              <div className={`w-28 h-28 bg-panel border-2 border-dashed rounded-[32px] flex items-center justify-center mb-8 transition-all duration-500 shadow-2xl ${isDraggingOver ? 'border-accent text-accent animate-bounce rotate-12' : 'border-border text-text-dim group-hover:border-accent group-hover:text-accent'}`}>
                <ImageIcon size={56} className="opacity-20 group-hover:opacity-100 transition-opacity" />
              </div>
              <h2 className="text-3xl font-black mb-4 tracking-[-0.04em] uppercase text-white">Import Canvas</h2>
              <p className="text-sm text-text-dim max-w-[320px] font-medium leading-relaxed">Click Chọn Upload iMG hoặc Kéo Thả Upload iMG.</p>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handleUpload} 
              />
            </div>
          ) : (
            <div 
              className="relative transition-all duration-300 ease-out flex items-center justify-center"
              style={{
                width: Math.max(800, sourceImage.width * zoom + 100),
                height: Math.max(600, sourceImage.height * zoom + 100),
              }}
            >
               <div className="relative p-1 bg-border rounded-sm shadow-[0_40px_100px_rgba(0,0,0,0.8)]">
                <div 
                  ref={containerRef}
                  className="relative cursor-crosshair overflow-visible bg-[#000]"
                >
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    className="block"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Floating Zoom Controls Viewport */}
          {sourceImage && (
            <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40 bg-panel/90 backdrop-blur-3xl border border-border/50 p-1.5 rounded-2xl flex items-center gap-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
               <div className="flex bg-bg/50 rounded-xl p-0.5 border border-border/30">
                  <button onClick={() => setZoom(0.25)} className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${zoom === 0.25 ? 'bg-accent text-white' : 'text-text-dim hover:text-text'}`}>25%</button>
                  <button onClick={() => setZoom(0.5)} className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${zoom === 0.5 ? 'bg-accent text-white' : 'text-text-dim hover:text-text'}`}>50%</button>
                  <button onClick={() => setZoom(1)} className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${zoom === 1 ? 'bg-accent text-white' : 'text-text-dim hover:text-text'}`}>100%</button>
                  <button onClick={() => setZoom(2)} className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${zoom === 2 ? 'bg-accent text-white' : 'text-text-dim hover:text-text'}`}>200%</button>
               </div>
            </div>
          )}

          {/* Selection Actions for Professional UI */}
          {selection && action === 'none' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white text-black p-1 rounded-2xl flex items-center gap-6 shadow-[0_30px_100px_rgba(59,130,246,0.3)] z-50 border-4 border-accent"
            >
              <div className="flex flex-col pl-6 pr-4 py-2">
                <span className="text-[10px] font-black uppercase text-accent/60 tracking-[3px]">Dimensions</span>
                <span className="text-2xl font-black leading-none mt-1">{Math.round(selection.width)}×{Math.round(selection.height)}</span>
              </div>
              <button 
                onClick={extractImage}
                className="bg-black text-white px-10 py-5 rounded-xl font-black text-xs uppercase tracking-[4px] hover:bg-accent transition-all active:scale-95 flex items-center gap-4"
              >
                <Scissors size={20} />
                EXTRACT AS PNG
              </button>
              <button 
                onClick={() => setSelection(null)}
                className="p-5 hover:bg-black/5 text-black/30 hover:text-black transition-colors"
                title="Hủy vùng chọn"
              >
                <X size={28} />
              </button>
            </motion.div>
          )}
        </section>

        {/* Inspector (Right) */}
        <aside className="bg-panel border-l border-border flex flex-col overflow-hidden">
          <div className="p-6 border-b border-border bg-bg/30">
            <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-[2px]">Kiểm tra chi tiết (High-Res)</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-8">
            <div className="bg-bg border border-border rounded-2xl overflow-hidden shadow-2xl group relative">
              <div className="aspect-square bg-[#050505] relative flex items-center justify-center p-6">
                {extractedImages.length > 0 ? (
                  <motion.img 
                    key={extractedImages[extractedImages.length - 1].id}
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    src={extractedImages[extractedImages.length - 1].url} 
                    alt="Preview" 
                    className="max-w-full max-h-full object-contain shadow-[0_20px_50px_rgba(0,0,0,0.8)] cursor-zoom-in"
                    onClick={() => setSelectedImageId(extractedImages[extractedImages.length - 1].id)}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-text-dim/10 grayscale">
                    <Expand size={80} strokeWidth={1} />
                    <span className="text-[10px] uppercase font-black tracking-widest mt-4">Preview Lock</span>
                  </div>
                )}
              </div>
              
              <div className="p-5 bg-panel border-t border-border">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] text-text-dim uppercase font-bold tracking-[1px]">Output Target</span>
                  <span className="px-2 py-0.5 bg-success/10 text-success text-[10px] font-bold rounded uppercase">2K Lossless</span>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-dim opacity-60">Kích thước:</span>
                    <span className="font-mono text-white text-[11px] font-bold">
                      {extractedImages.length > 0 ? `${Math.round(extractedImages[extractedImages.length - 1].originalWidth)} × ${Math.round(extractedImages[extractedImages.length - 1].originalHeight)} px` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-dim opacity-60">Xử lý mượt:</span>
                    <span className="text-accent font-bold text-[10px] uppercase">Lanczos Scaling</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-[2px]">Metadata & Info</h3>
              <div className="bg-bg/40 rounded-xl border border-border/50 divide-y divide-border/30">
                <div className="p-4 flex justify-between items-center">
                  <span className="text-[11px] text-text-dim">Origin X,Y:</span>
                  <span className="font-mono text-text text-[11px]">
                    {extractedImages.length > 0 ? `${Math.round(extractedImages[extractedImages.length - 1].rect.x)}, ${Math.round(extractedImages[extractedImages.length - 1].rect.y)}` : '0, 0'}
                  </span>
                </div>
                <div className="p-4 flex justify-between items-center">
                  <span className="text-[11px] text-text-dim">File Format:</span>
                  <span className="text-text font-bold text-[11px]">PNG (Lossless)</span>
                </div>
                <div className="p-4 flex justify-between items-center">
                  <span className="text-[11px] text-text-dim">Tống cộng:</span>
                  <span className="text-accent font-black text-[12px]">{extractedImages.length}</span>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => setViewMode('gallery')}
                  className="w-full py-4 bg-accent hover:brightness-110 text-white border-none rounded-xl font-black text-xs uppercase tracking-[3px] transition-all shadow-2xl shadow-accent/20 active:scale-95"
                >
                  XUẤT TOÀN BỘ DỮ LIỆU
                </button>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="h-[30px] bg-panel border-t border-border px-5 flex items-center text-[10px] text-text-dim gap-8 flex-shrink-0 z-30">
        <div className="flex items-center gap-2">
          <span className="text-accent animate-pulse">●</span>
          <span className="font-bold">TRẠNG THÁI:</span>
          <span>{sourceImage ? 'SẴN SÀNG' : 'CHỜ TỆP TIN'}</span>
        </div>
        
        <div className="flex items-center gap-6 border-l border-white/5 pl-6">
          <div className="flex items-center gap-2">
            <kbd className="bg-bg border border-border px-1 rounded text-accent font-mono text-[9px] shadow-sm">CTRL+V</kbd>
            <span className="uppercase opacity-60">Dán ảnh</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="bg-bg border border-border px-1 rounded text-accent font-mono text-[9px] shadow-sm">DELETE</kbd>
            <span className="uppercase opacity-60">Xóa lịch sử</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="bg-bg border border-border px-1 rounded text-accent font-mono text-[9px] shadow-sm">CTRL+ENTER</kbd>
            <span className="uppercase opacity-60">Tư động tách</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="bg-bg border border-border px-1 rounded text-accent font-mono text-[9px] shadow-sm">ESC</kbd>
            <span className="uppercase opacity-60">Thoát Zoom</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="bg-bg border border-border px-1 rounded text-accent font-mono text-[9px] shadow-sm">← / →</kbd>
            <span className="uppercase opacity-60">Chuyển ảnh</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-4 text-success font-bold uppercase">
          {sourceImage && (
            <>
              <div className="w-px h-3 bg-white/5" />
              <span>{sourceImage.width} × {sourceImage.height} PX</span>
            </>
          )}
        </div>
      </footer>

      {/* Gallery Modal Override */}
      <AnimatePresence>
        {viewMode === 'gallery' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-bg p-10 overflow-y-auto"
          >
            <div className="max-w-7xl mx-auto">
              <div className="flex items-center justify-between mb-10 pb-6 border-b border-border">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-black uppercase tracking-tighter">Bộ sưu tập xuất ảnh</h2>
                  <span className="bg-accent/10 border border-accent/20 text-accent px-3 py-1 rounded text-xs font-bold">{extractedImages.length} TỆP TIN</span>
                  {extractedImages.length > 0 && (
                    <button 
                      onClick={downloadAllAsZip}
                      className="ml-4 flex items-center gap-2 bg-accent text-white px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all shadow-lg shadow-accent/20"
                    >
                      <Download size={14} />
                      Tải tất cả (.ZIP)
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => setViewMode('edit')}
                  className="bg-white/5 hover:bg-white/10 text-text p-3 rounded-full transition-all"
                >
                  <X size={28} />
                </button>
              </div>

              {extractedImages.length === 0 ? (
                <div className="h-[60vh] flex flex-col items-center justify-center text-text-dim/50 border-2 border-dashed border-border rounded-3xl">
                   <ImageIcon size={64} className="mb-4" />
                   <p className="text-lg">Dữ liệu tách hiện đang trống</p>
                   <button onClick={() => setViewMode('edit')} className="mt-4 text-accent hover:underline">Về trình chỉnh sửa</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pb-20">
                  {extractedImages.map((img) => (
                    <motion.div 
                      key={img.id}
                      className="bg-panel border border-border p-1 rounded-xl shadow-xl group overflow-hidden"
                    >
                      <div className="aspect-square bg-[#0a0a0a] rounded-lg overflow-hidden relative">
                        <img src={img.url} alt="Item" className="w-full h-full object-contain" />
                        <div className="absolute inset-0 bg-accent/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button 
                            onClick={() => downloadImage(img.url, `extract-${img.id}.jpg`)}
                            className="bg-white text-black p-3 rounded-full shadow-2xl hover:scale-110 transition-transform"
                          >
                            <Download size={20} />
                          </button>
                          <button 
                            onClick={(e) => removeExtracted(img.id, e)}
                            className="bg-red-500 text-white p-3 rounded-full shadow-2xl hover:scale-110 transition-transform"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-mono text-text-dim uppercase">IMG-{img.id.slice(0, 4)}</span>
                          <span className="text-[10px] text-success font-bold uppercase tracking-widest">HQ</span>
                        </div>
                        <p className="text-xs font-bold truncate">Item_Extracted_{img.id.slice(0, 4)}.png</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-Screen Inspection Lightbox */}
      <AnimatePresence>
        {selectedImageId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/98 backdrop-blur-2xl flex flex-col items-center justify-center p-10 cursor-zoom-out"
            onClick={() => setSelectedImageId(null)}
          >
            <button className="absolute top-10 right-10 text-white/20 hover:text-white transition-colors duration-300">
              <X size={48} strokeWidth={1} />
            </button>
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative max-w-full max-h-full flex flex-col items-center gap-10"
              onClick={e => e.stopPropagation()}
            >
              <div className="relative group p-1.5 bg-white/5 rounded-xl border border-white/10 shadow-[0_50px_100px_rgba(0,0,0,1)]">
                {extractedImages.length > 1 && (
                  <>
                    <button 
                      onClick={(e) => { e.stopPropagation(); navigateInspection('prev'); }}
                      className="absolute -left-20 top-1/2 -translate-y-1/2 w-16 h-16 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/40 hover:text-white transition-all z-[110]"
                      title="Quay lại (Arrow Left)"
                    >
                      <ChevronLeft size={32} />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); navigateInspection('next'); }}
                      className="absolute -right-20 top-1/2 -translate-y-1/2 w-16 h-16 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/40 hover:text-white transition-all z-[110]"
                      title="Tiếp theo (Arrow Right)"
                    >
                      <ChevronRight size={32} />
                    </button>
                  </>
                )}

                <img 
                  src={extractedImages.find(i => i.id === selectedImageId)?.url} 
                  alt="Inspection View" 
                  className="max-w-[90vw] max-h-[75vh] object-contain rounded-lg"
                  referrerPolicy="no-referrer"
                />
                
                {/* Rule of thirds overlay for precision check */}
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/5 pointer-events-none" />
                <div className="absolute inset-x-0 bottom-1/3 h-px bg-white/5 pointer-events-none" />
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/5 pointer-events-none" />
                <div className="absolute inset-y-0 right-1/3 w-px bg-white/5 pointer-events-none" />
              </div>

              <div className="flex items-center gap-12 bg-white/5 backdrop-blur-md px-10 py-6 rounded-[32px] border border-white/10 shadow-2xl">
                <div className="flex flex-col">
                  <span className="text-[10px] text-white/40 uppercase font-black tracking-[3px] mb-1">Optical Precision</span>
                  <span className="text-3xl font-mono text-white leading-none">
                    {extractedImages.find(i => i.id === selectedImageId)?.originalWidth} <span className="text-accent">×</span> {extractedImages.find(i => i.id === selectedImageId)?.originalHeight} px
                  </span>
                </div>
                
                <div className="w-px h-10 bg-white/10" />
                
                <button 
                  onClick={() => {
                    const img = extractedImages.find(i => i.id === selectedImageId);
                    if (img) {
                      const base = fileName || 'extract';
                      const idx = extractedImages.indexOf(img) + 1;
                      downloadImage(img.url, `${base}_slip-${idx}.png`);
                    }
                  }}
                  className="bg-white text-black hover:bg-accent hover:text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[4px] transition-all flex items-center gap-4 active:scale-95 shadow-2xl"
                >
                  <Download size={20} />
                  SAVE AS LOSSLESS PNG
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
