import { useEffect, useRef, useState } from "react";
import { ref, onValue, push, set } from "firebase/database";
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
  currentUser
}) {
  if (!fileId) return null;

  const canvasRef = useRef(null);
  const [annotations, setAnnotations] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [annotationStart, setAnnotationStart] = useState({ x: 0, y: 0 });
  const { currentUser: authUser } = useAuth(); // Get user from auth context

  // Load annotations from Firebase
  useEffect(() => {
    const sanitizedPage = sanitizeKey(`page_${page}`);
    const annotationsRef = ref(database, `groups/${groupId}/files/${fileId}/annotations/${sanitizedPage}`);
    const unsubscribe = onValue(annotationsRef, (snapshot) => {
        const data = snapshot.val();
        setAnnotations(data ? Object.values(data) : []);
    });
    return () => unsubscribe();
  }, [groupId, page, fileId]);

  // Filter annotations based on visibility settings
  useEffect(() => {
    if (!pageRendered) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const visibleAnnotations = annotations.filter(anno => {
      const isGroup = anno.type === 'group' && showGroupAnnotations;
      const isPersonal = anno.type === 'personal' && 
                        showPersonalAnnotations && 
                        // Compare with authUser.uid instead of passed prop
                        anno.creatorId === authUser.uid;
      
      return isGroup || isPersonal;
    });
    
    visibleAnnotations.forEach(drawAnnotation);
  // Add authUser.uid to dependencies
  }, [annotations, pageRendered, showGroupAnnotations, showPersonalAnnotations, authUser.uid]);


  const sanitizeKey = (key) => key.replace(/[.#$/\[\]]/g, "_");

  const getAnnotationColor = (type) => {
    return type === 'group' ? "#FF0000" : "#0000FF"; // Red for group, blue for personal
  };

  const drawAnnotation = (annotation) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(annotation.startX, annotation.startY);
    ctx.lineTo(annotation.endX, annotation.endY);
    ctx.strokeStyle = annotation.color;
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  const getMousePos = (e) => {
    const rect = parentCanvasRef.current.getBoundingClientRect();
    const scaleX = parentCanvasRef.current.width / rect.width;
    const scaleY = parentCanvasRef.current.height / rect.height;
    
    return { 
        x: (e.clientX - rect.left) * scaleX, 
        y: (e.clientY - rect.top) * scaleY 
    };
  };

  const startDrawing = (e) => {
    // Prevent non-creators from drawing in group mode even if they bypassed UI
    if (annotationMode === 'group' && !currentUser.isCreator) {
        return;
    }
    
    setIsDrawing(true);
    setAnnotationStart(getMousePos(e));
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const pos = getMousePos(e);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Redraw only visible annotations
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const visibleAnnotations = annotations.filter(anno => {
        const isGroup = anno.type === 'group' && showGroupAnnotations;
        const isPersonal = anno.type === 'personal' && 
                        showPersonalAnnotations && 
                        anno.creatorId === authUser.uid;
        return isGroup || isPersonal;
    });
    visibleAnnotations.forEach(drawAnnotation);

    // Draw current line
    ctx.beginPath();
    ctx.moveTo(annotationStart.x, annotationStart.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = getAnnotationColor(annotationMode);
    ctx.lineWidth = 3;
    ctx.stroke();
  };


  const endDrawing = (e) => {
    if (!isDrawing) return;
    const pos = getMousePos(e);

    const newAnnotation = {
      startX: annotationStart.x,
      startY: annotationStart.y,
      endX: pos.x,
      endY: pos.y,
      color: getAnnotationColor(annotationMode),
      type: annotationMode,
      creatorId: authUser.uid,
      page: `page_${page}`,
    };

    const annotationsRef = ref(database, `groups/${groupId}/files/${fileId}/annotations/page_${page}`);
    const newAnnotationRef = push(annotationsRef);
    set(newAnnotationRef, newAnnotation);

    setIsDrawing(false);
  };

  return (
    <canvas
      ref={canvasRef}
      className="annotation-canvas"
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "auto" }}
      width={parentCanvasRef.current?.width || 800}
      height={parentCanvasRef.current?.height || 600}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={endDrawing}
      onMouseLeave={endDrawing}
    />
  );
}
