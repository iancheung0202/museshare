import { useEffect, useRef, useState } from "react";
import { ref, onValue, push, remove } from "firebase/database";
import { database } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function AnnotationCanvas({
  groupId, 
  fileId, 
  page, 
  pageRendered, 
  parentCanvasRef,
  annotationMode,
  showGroupAnnotations,
  showPersonalAnnotations,
  currentUser,
  activeTool,
  brushColor,
  strokeWidth
}) {
  if (!fileId) return null;

  const canvasRef = useRef(null);
  const [annotations, setAnnotations] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState([]);
  const { currentUser: authUser } = useAuth();

  useEffect(() => {
    const sanitizedPage = sanitizeKey(`page_${page}`);
    const annotationsRef = ref(database, `groups/${groupId}/files/${fileId}/annotations/${sanitizedPage}`);
    const unsubscribe = onValue(annotationsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            setAnnotations(Object.entries(data).map(([id, val]) => ({ ...val, id })));
        } else {
            setAnnotations([]);
        }
    });
    return () => unsubscribe();
  }, [groupId, page, fileId]);

  const getVisibleAnnotations = () => {
      return annotations.filter(anno => {
        const isGroup = anno.mode === 'group' && showGroupAnnotations;
        const isPersonal = anno.mode === 'personal' && 
                          showPersonalAnnotations && 
                          anno.creatorId === authUser.uid;
        return isGroup || isPersonal;
      });
  };

  const drawAll = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const extraAnno = (isDrawing && activeTool !== 'erase_object') ? {
        tool: activeTool,
        points: currentPoints,
        color: brushColor,
        strokeWidth: strokeWidth,
        mode: annotationMode
    } : null;

    const drawModeToCtx = (modeToDraw) => {
       const offCanvas = document.createElement('canvas');
       offCanvas.width = canvas.width;
       offCanvas.height = canvas.height;
       const offCtx = offCanvas.getContext('2d');
       
       getVisibleAnnotations()
         .filter(a => a.mode === modeToDraw)
         .forEach(anno => drawAnnotationPath(offCtx, anno));
         
       if (extraAnno && extraAnno.mode === modeToDraw) {
           drawAnnotationPath(offCtx, extraAnno);
       }
       ctx.drawImage(offCanvas, 0, 0);
    };

    if (showGroupAnnotations) drawModeToCtx('group');
    if (showPersonalAnnotations) drawModeToCtx('personal');
  };

  useEffect(() => {
    if (pageRendered) drawAll();
  }, [annotations, pageRendered, showGroupAnnotations, showPersonalAnnotations, authUser.uid]);

  const sanitizeKey = (key) => key.replace(/[.#$/\[\]]/g, "_");

  const drawAnnotationPath = (ctx, annotation) => {
    if (!annotation.points || annotation.points.length === 0) return;
    
    ctx.beginPath();
    ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
    
    for (let i = 1; i < annotation.points.length; i++) {
       ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = annotation.strokeWidth || 3;

    if (annotation.tool === 'erase_pixel') {
       ctx.globalCompositeOperation = 'destination-out';
       ctx.strokeStyle = 'rgba(0,0,0,1)';
       ctx.stroke();
       ctx.globalCompositeOperation = 'source-over';
    } else {
       ctx.strokeStyle = annotation.color || '#000';
       ctx.stroke();
    }
  };

  const getMousePos = (e) => {
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
      
    const rect = parentCanvasRef.current.getBoundingClientRect();
    const scaleX = parentCanvasRef.current.width / rect.width;
    const scaleY = parentCanvasRef.current.height / rect.height;
    
    return { 
        x: (clientX - rect.left) * scaleX, 
        y: (clientY - rect.top) * scaleY 
    };
  };

  const eraseObjectAt = (pos) => {
      let objectToRemove = null;
      let minDistance = 12; 
      
      for (const anno of getVisibleAnnotations()) {
         if (anno.mode !== annotationMode) continue;
         for (const p of anno.points) {
             const dist = Math.hypot(p.x - pos.x, p.y - pos.y);
             if (dist < minDistance) {
                 minDistance = dist;
                 objectToRemove = anno;
             }
         }
      }
      
      if (objectToRemove) {
          const annoRef = ref(database, `groups/${groupId}/files/${fileId}/annotations/page_${page}/${objectToRemove.id}`);
          remove(annoRef);
      }
  };

  const startDrawing = (e) => {
    if (activeTool === 'view') return;
    if (annotationMode === 'group' && !currentUser.isCreator) return;
    
    const pos = getMousePos(e);

    if (activeTool === 'erase_object') {
        setIsDrawing(true);
        eraseObjectAt(pos);
        return; 
    }

    setIsDrawing(true);
    setCurrentPoints([pos]);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    if (e.cancelable) e.preventDefault(); 
    const pos = getMousePos(e);

    if (activeTool === 'erase_object') {
        eraseObjectAt(pos);
        return;
    }
    
    let newPoints = [...currentPoints];
    if (activeTool === 'draw_line') {
        newPoints = [currentPoints[0], pos];
    } else {
        newPoints.push(pos);
    }
    
    setCurrentPoints(newPoints);
    drawAll();
  };

  const endDrawing = (e) => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (activeTool === 'erase_object') return;
    
    if (currentPoints.length < 2) {
      drawAll();
      return; 
    }

    const newAnnotation = {
      mode: annotationMode,
      tool: activeTool,
      points: currentPoints,
      color: brushColor,
      strokeWidth: strokeWidth,
      creatorId: authUser.uid,
    };

    const annotationsRef = ref(database, `groups/${groupId}/files/${fileId}/annotations/page_${page}`);
    push(annotationsRef, newAnnotation);
    setCurrentPoints([]);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`annotation-canvas tool-${activeTool} annotation-layer`}
      style={{ 
        position: "absolute", 
        top: 0, 
        left: 0, 
        pointerEvents: activeTool === 'view' ? 'none' : 'auto',
        touchAction: 'none' 
      }}
      width={parentCanvasRef.current?.width || 800}
      height={parentCanvasRef.current?.height || 600}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={endDrawing}
      onMouseLeave={endDrawing}
      onTouchStart={startDrawing}
      onTouchMove={draw}
      onTouchEnd={endDrawing}
      onTouchCancel={endDrawing}
    />
  );
}
