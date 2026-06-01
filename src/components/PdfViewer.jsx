// PdfViewer.jsx
import { useState, useRef, useEffect } from "react";
import AnnotationCanvas from "./AnnotationCanvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { ref, get, remove, update, onValue } from "firebase/database";
import { database } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import DriveManager from './DriveManager';
import { getGoogleToken } from '../utils/tokenProvider';
import { FiExternalLink } from "react-icons/fi";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export default function PDFViewer({ groupId, onBack }) {
  const { currentUser } = useAuth();
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageRendered, setPageRendered] = useState(false);
  const [groupData, setGroupData] = useState(null);
  const [members, setMembers] = useState([]);
  const [isCreator, setIsCreator] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const [totalPages, setTotalPages] = useState(0);
  const [currentFile, setCurrentFile] = useState(null);
  const [groupFiles, setGroupFiles] = useState([]);
  const [showFileManager, setShowFileManager] = useState(true);
  const [sortOption, setSortOption] = useState('name-asc');
  const [annotationMode, setAnnotationMode] = useState('group');
  const [showGroupAnnotations, setShowGroupAnnotations] = useState(true);
  const [showPersonalAnnotations, setShowPersonalAnnotations] = useState(true);
  
  const [activeTool, setActiveTool] = useState('view');
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const touchStartX = useRef(null);
  
  const [transitionImg, setTransitionImg] = useState(null);
  const [animClass, setAnimClass] = useState('');
  const [pendingAnim, setPendingAnim] = useState(null);
  const lastFlipTimeRef = useRef(0);
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenContainerRef = useRef(null);

  const canvasRef = useRef(null);
  const timeoutRef = useRef(null);

  const sanitizeKey = (key) => (key ? key.replace(/[.#$/\[\]]/g, "_") : "");

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
        fullscreenContainerRef.current?.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
  };

  // Fetch group data & members
  useEffect(() => {
    const groupRef = ref(database, `groups/${groupId}`);
    const unsubscribe = onValue(groupRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setGroupData(data);

        const membersList = data.members ? Object.entries(data.members).map(([uid, member]) => ({
            id: uid,         // <---- add this
            ...member
        })) : [];
        setMembers(membersList);

        setIsCreator(data.creator === sanitizeKey(currentUser.uid));
      }
    });

    return () => unsubscribe();
  }, [groupId, currentUser]);

  // Fetch group files
  useEffect(() => {
    const filesRef = ref(database, `groups/${groupId}/files`);
    const unsubscribe = onValue(filesRef, (snapshot) => {
      if (snapshot.exists()) {
        const files = Object.entries(snapshot.val()).map(([id, data]) => ({
          id,
          ...data
        }));
        setGroupFiles(files);
      } else {
        setGroupFiles([]);
      }
    });

    return unsubscribe;
  }, [groupId]);

  // Load local sample PDF as fallback
  useEffect(() => {
    const loadSample = async () => {
      const loadingTask = pdfjsLib.getDocument("/scores/sample.pdf");
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
    };
    loadSample();
  }, []);

  // Render PDF page
  useEffect(() => {
    const renderPage = async (pageNum) => {
      if (!pdfDoc) return;
      setPageRendered(false);

      const page = await pdfDoc.getPage(pageNum);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      if (canvas.currentRenderTask) {
        canvas.currentRenderTask.cancel();
      }

      const renderTask = page.render({ canvasContext: ctx, viewport });
      canvas.currentRenderTask = renderTask;

      await renderTask.promise;
      canvas.currentRenderTask = null;
      setPageRendered(true);
    };

    renderPage(currentPage);
  }, [currentPage, pdfDoc]);

  // Update page input when currentPage changes
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // Page navigation
  const captureCurrentPage = () => {
    if (!canvasRef.current) return null;
    const pdfCanvas = canvasRef.current;
    const annoCanvas = pdfCanvas.nextElementSibling;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = pdfCanvas.width;
    tempCanvas.height = pdfCanvas.height;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(pdfCanvas, 0, 0);
    if (annoCanvas) ctx.drawImage(annoCanvas, 0, 0);
    return tempCanvas.toDataURL();
  };

  const changePageWithAnim = (targetPage) => {
    if (targetPage === currentPage || targetPage < 1 || targetPage > totalPages) return;
    const direction = targetPage > currentPage ? 'next' : 'prev';
    const snapshot = captureCurrentPage();

    // Check for rapid consecutive flipping (less than 500ms)
    const now = Date.now();
    const isRapid = (now - lastFlipTimeRef.current) < 500;
    lastFlipTimeRef.current = now;

    // 1. Keep the old page visible as an image
    setTransitionImg(snapshot);

    // 2. Queue up the appropriate animation (fade for rapid, slide for normal)
    const nextAnim = isRapid 
      ? 'animate-fade-in' 
      : (direction === 'next' ? 'animate-slide-in-next' : 'animate-slide-in-prev');
    setPendingAnim(nextAnim);

    // 3. Immediately set rendered to false
    setPageRendered(false);

    // 4. Defer changing the page by 0ms. 
    // This forces React to paint the `transitionImg` to the screen FIRST,
    // before pdf.js clears the canvas, eliminating the black flicker.
    setTimeout(() => {
      setCurrentPage(targetPage);
    }, 0);
  };

  const nextPage = () => changePageWithAnim(currentPage + 1);
  const prevPage = () => changePageWithAnim(currentPage - 1);

  const handlePageInputChange = (e) => {
    const value = e.target.value;
    setPageInput(value);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (value === "" || !/^\d+$/.test(value)) return;

    const pageNum = parseInt(value, 10);
    if (pageNum < 1 || pageNum > totalPages) return;

    timeoutRef.current = setTimeout(() => changePageWithAnim(pageNum), 100);
  };

  const handlePageInputSubmit = (e) => {
    e.preventDefault();
    if (!pageInput) return;

    const pageNum = parseInt(pageInput, 10);
    if (pageNum >= 1 && pageNum <= totalPages) changePageWithAnim(pageNum);
    else setPageInput(String(currentPage));
  };

  // Support both mouse dragging and touch swiping
  const handlePointerDown = (e) => {
    if (activeTool !== 'view') return;
    touchStartX.current = e.clientX || (e.touches && e.touches[0].clientX);
  };

  const handlePointerUp = (e) => {
    if (activeTool !== 'view' || touchStartX.current === null) return;
    const clientX = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
    const diff = touchStartX.current - clientX;
    
    if (diff > 50) changePageWithAnim(currentPage + 1);
    else if (diff < -50) changePageWithAnim(currentPage - 1);
    
    touchStartX.current = null;
  };

  const handleFileAdded = () => {
    const filesRef = ref(database, `groups/${groupId}/files`);
    onValue(filesRef, (snapshot) => {
      if (snapshot.exists()) {
        const files = Object.entries(snapshot.val()).map(([id, data]) => ({
          id,
          ...data
        }));
        setGroupFiles(files);
      }
    });
  };

  const loadPdf = async (fileId) => {
    const file = groupFiles.find(f => f.id === fileId);
    if (!file) return;

    setCurrentFile(file);
    setShowFileManager(false);
    setCurrentPage(1);

    try {
      const token = await getGoogleToken();
      const loadingTask = pdfjsLib.getDocument({
        url: `https://www.googleapis.com/drive/v3/files/${file.driveId}?alt=media`,
        httpHeaders: { 'Authorization': `Bearer ${token}` }
      });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
    } catch (error) {
      console.error("PDF load error:", error);
      alert("Failed to load PDF from Google Drive. Make sure the document permission is public.");
    }
  };

  const deleteFile = async (fileId, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this file?")) return;
    await remove(ref(database, `groups/${groupId}/files/${fileId}`));
  };

  const deleteCurrentFile = async () => {
    if (!window.confirm("Delete this file from the group?")) return;
    await remove(ref(database, `groups/${groupId}/files/${currentFile.id}`));
    setShowFileManager(true);
    setCurrentFile(null);
  };

  const updateFileName = async (fileId, newName) => {
    if (!newName.trim()) return;
    await update(ref(database, `groups/${groupId}/files/${fileId}`), { name: newName });
  };

  const deleteGroup = async () => {
    if (!window.confirm("Are you sure you want to delete this group?")) return;

    const updates = {};
    members.forEach(member => {
      updates[`users/${member.id}/groups/${groupId}`] = null;
    });
    updates[`groups/${groupId}`] = null;
    updates[`annotations/${groupId}`] = null;

    await update(ref(database), updates);
    onBack();
  };

  const leaveGroup = async () => {
    if (!window.confirm("Are you sure you want to leave this group?")) return;

    await update(ref(database), {
      [`groups/${groupId}/members/${sanitizeKey(currentUser.uid)}`]: null,
      [`users/${currentUser.uid}/groups/${groupId}`]: null
    });

    onBack();
  };

  const updateGroupName = async (newName) => {
    if (!isCreator || !newName.trim()) return;
    await update(ref(database, `groups/${groupId}`), { name: newName });
  };

  const updateGroupDescription = async (newDesc) => {
    if (!isCreator) return;
    await update(ref(database, `groups/${groupId}`), { description: newDesc });
  };

  const memberLookup = {};
  members.forEach(member => {
    if (!member.id) return;
    const sanitizedId = sanitizeKey(member.id);
    memberLookup[sanitizedId] = member;
  });

  useEffect(() => {
    if (!isCreator && annotationMode === 'group') {
        setAnnotationMode('personal');
    }
  }, [isCreator, annotationMode]);

  const sortedFiles = [...groupFiles].sort((a, b) => {
    switch(sortOption) {
      case 'name-asc': return a.name.localeCompare(b.name);
      case 'name-desc': return b.name.localeCompare(a.name);
      case 'date-asc': return a.addedAt - b.addedAt;
      case 'date-desc': return b.addedAt - a.addedAt;
      default: return 0;
    }
  });

  // Trigger animation ONLY after the new page is fully rendered
  useEffect(() => {
    if (pageRendered && pendingAnim) {
      setAnimClass(pendingAnim);
      setPendingAnim(null);
      
      // Clear the transition image after animation completes
      setTimeout(() => {
        setTransitionImg(null);
        setAnimClass('');
      }, 300); // 300ms matches your CSS slide animation duration
    }
  }, [pageRendered, pendingAnim]);

  return (
    <div className="pdf-container">
      {/* Group Info */}
      <div className="group-info-container">
        <div className="group-info card">
          {isCreator ? (
            <h2
                contentEditable
                suppressContentEditableWarning
                onFocus={(e) => {
                    if (e.target.textContent === groupData?.name) {
                    e.target.dataset.oldValue = groupData.name; // store old value
                    e.target.textContent = "";
                    }
                }}
                onBlur={(e) => {
                    const newName = e.target.textContent.trim();
                    if (!newName) {
                    e.target.textContent = e.target.dataset.oldValue || groupData.name;
                    } else {
                    updateGroupName(newName);
                    }
                }}
                className="editable-title"
                >
                {groupData?.name}
            </h2>
          ) : (
            <h2>{groupData?.name}</h2>
          )}
          {isCreator ? (
            <p
                contentEditable
                suppressContentEditableWarning
                onFocus={(e) => {
                    if (e.target.textContent === "Click to add description") {
                    e.target.textContent = "";
                    }
                }}
                onBlur={(e) => {
                    const text = e.target.textContent.trim();
                    if (!text) {
                    e.target.textContent = "Click to add description";
                    }
                    updateGroupDescription(text);
                }}
                className="editable-desc"
                >
                {groupData?.description || "Click to add description"}
            </p>
          ) : (
            groupData?.description && <p>{groupData.description}</p>
          )}
          {showFileManager && (
            <>
                <p>Join Code: {groupId}</p>
                <p>Created: {groupData?.createdAt ? new Date(groupData.createdAt).toLocaleDateString() : "Unknown date"}</p>
            </>
          )}
          <div className="group-actions">
            {showFileManager && (
                <>
                <button className="primary-dark" onClick={onBack}>Back to Home</button>
                {isCreator ? (
                    <button className="danger" onClick={deleteGroup}>Delete Group</button>
                ) : (
                    <button className="secondary" onClick={leaveGroup}>Leave Group</button>
                )}
                </>
            )}
            
            {!showFileManager && (
                <button className="primary-dark" onClick={() => setShowFileManager(true)}>Back to Group</button>
            )}
        </div>
        </div>

        {/* Members */}
        {showFileManager && (
          <div className="members-card card">
            <h3>Members ({members.length})</h3>
            <ul className="member-list">
              {members.map((member, index) => (
                <li key={index} className="member-item">
                  <span>{member.name}</span>
                  <span className="join-date">
                    {member.isCreator ? "Creator" : member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "Unknown"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* File Manager / PDF Viewer */}
      {showFileManager ? (
        <div className="file-manager">
          {isCreator && (<DriveManager groupId={groupId} onFileAdded={handleFileAdded} />)}

          <div className="card">
            <h3>Available PDFs</h3>
            {groupFiles.length === 0 ? <p>No PDFs imported yet</p> : (
              <ul className="group-list">
                {sortedFiles.map(file => {
                  const uploader = memberLookup[sanitizeKey(file.owner)];
                  const isFileCreator = groupData?.creator === sanitizeKey(file.owner);

                  return (
                    <li key={file.id} className="group-item cursor-pointer" onClick={() => loadPdf(file.id)}>
                      <div style={{ display: 'block' }}>
                        {file.owner === currentUser.uid ? (
                          <div
                            contentEditable
                            suppressContentEditableWarning
                            onFocus={(e) => {
                                e.target.dataset.oldValue = file.name; // store old name
                            }}
                            onBlur={(e) => {
                                const newName = e.target.textContent.trim();
                                if (!newName) {
                                e.target.textContent = e.target.dataset.oldValue; // restore old name
                                } else {
                                updateFileName(file.id, newName);
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="editable-file-title"
                            >
                            {file.name}
                        </div>
                        ) : (
                          <h4>{file.name}</h4>
                        )}
                        <p>
                            Uploaded by: {file.owner === currentUser.uid ? "You" : uploader?.name || "Unknown"}
                            {isFileCreator && " (Creator)"}
                        </p>
                        <p>{file.addedAt ? new Date(file.addedAt).toLocaleDateString() : "Unknown date"}</p>
                        {file.owner === currentUser.uid ? <button className="danger" onClick={(e) => deleteFile(file.id, e)}>Delete</button> : null }
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className={`pdf-viewer-area ${isFullscreen ? 'fullscreen-mode' : ''}`} ref={fullscreenContainerRef}>

          {!isFullscreen && (
            <>
              {/* Add file name display with editing */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>Currently viewing: </h3>
                {currentFile && (
                    currentFile.owner === currentUser.uid ? (
                        <div
                        contentEditable
                        suppressContentEditableWarning
                        onFocus={(e) => { e.target.dataset.oldValue = currentFile.name }}
                        onBlur={(e) => {
                            const newName = e.target.textContent.trim();
                            if (!newName) {
                            e.target.textContent = e.target.dataset.oldValue;
                            } else {
                            updateFileName(currentFile.id, newName);
                            }
                        }}
                        style={{ 
                            marginLeft: '10px',
                            marginBottom: '10px',
                            padding: '0.25rem 0.5rem',
                            background: 'rgba(15, 23, 42, 0.5)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: 'var(--radius-sm)',
                            minWidth: '200px'
                        }}
                        >
                        {currentFile.name}
                        </div>
                    ) : (
                        <div style={{ marginLeft: '10px', marginBottom: '12px', fontWeight: 'bold' }}>
                        {currentFile.name}
                        </div>
                    )
                )}
              </div>
              <div className="pdf-controls" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select 
                      value={activeTool} 
                      onChange={(e) => setActiveTool(e.target.value)}
                      style={{
                        background: 'rgba(15, 23, 42, 0.5)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--light)',
                        padding: '0.25rem 0.5rem'
                      }}
                    >
                      <option value="view">View (Swipe)</option>
                      <option value="draw_free">Free Draw</option>
                      <option value="draw_line">Straight Line</option>
                      <option value="erase_pixel">Eraser (Pixel)</option>
                      <option value="erase_object">Eraser (Object)</option>
                    </select>

                    {activeTool !== 'view' && activeTool !== 'erase_object' && (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                         {activeTool !== 'erase_pixel' && (
                             <input 
                               type="color" 
                               value={brushColor}
                               onChange={(e) => setBrushColor(e.target.value)}
                               style={{ width: '30px', height: '30px', padding: 0, border: 'none', background: 'none' }}
                             />
                         )}
                         <span style={{ fontSize: '0.8rem' }}>Thickness:</span>
                         <input 
                           type="range" 
                           min="1" 
                           max="20" 
                           value={strokeWidth}
                           onChange={(e) => setStrokeWidth(parseInt(e.target.value, 10))}
                           style={{ width: '80px' }}
                         />
                      </div>
                    )}

                    {/* Annotation Mode Selector */}
                    {currentUser && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span>Mode:</span>
                            <select 
                            value={annotationMode}
                            onChange={(e) => setAnnotationMode(e.target.value)}
                            style={{
                                background: 'rgba(15, 23, 42, 0.5)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--light)',
                                padding: '0.25rem 0.5rem'
                            }}
                            disabled={!isCreator} // Disable for non-creators
                            >
                            {isCreator && <option value="group">Group</option>}
                            <option value="personal">Personal</option>
                            </select>
                        </div>
                    )}
                </div>

                {/* Add visibility toggles */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <label>
                    <input 
                      type="checkbox"
                      checked={showGroupAnnotations}
                      onChange={(e) => setShowGroupAnnotations(e.target.checked)}
                    /> Show Group
                  </label>
                  <label>
                    <input 
                      type="checkbox"
                      checked={showPersonalAnnotations}
                      onChange={(e) => setShowPersonalAnnotations(e.target.checked)}
                    /> Show Personal
                  </label>
                </div>
              </div>
              <div className="pdf-controls">
                <button onClick={prevPage}>Previous</button>
                <form onSubmit={handlePageInputSubmit} style={{display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: '0.5rem' }}>Page:</span>
                  <input
                    type="number"
                    value={pageInput}
                    onChange={handlePageInputChange}
                    onBlur={handlePageInputSubmit}
                    style={{
                      width: '70px',
                      textAlign: 'center',
                      padding: '0.25rem 0.5rem',
                      marginTop: '1rem',
                      marginRight: '0.5rem',
                      background: 'rgba(15, 23, 42, 0.5)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--light)'
                    }}
                    min="1"
                    max={totalPages}
                  />
                  <span>of {totalPages}</span>
                </form>
                <button onClick={nextPage}>Next</button>
              </div>
            </>
          )}

          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', width: '100%', overflow: 'hidden' }}>
            {transitionImg && (
                <img 
                    src={transitionImg} 
                    style={{ 
                        position: 'absolute', 
                        top: 0, 
                        left: '50%',
                        transform: 'translateX(-50%)',
                        maxWidth: '100%', 
                        maxHeight: isFullscreen ? '100vh' : '70vh',
                        objectFit: 'contain', 
                        zIndex: 1 
                    }} 
                />
            )}
            
            <div 
              className={`pdf-canvas-container ${animClass}`} 
              onPointerDown={handlePointerDown} 
              onPointerUp={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchEnd={handlePointerUp}
              style={{ 
                touchAction: activeTool === 'view' ? 'pan-y' : 'none', 
                zIndex: 2, 
                position: 'relative',
                opacity: (!pageRendered && transitionImg) ? 0 : 1 // <-- Hides canvas during render
              }}
            >
              <canvas className="pdf-layer" ref={canvasRef} />
              <AnnotationCanvas
                  groupId={groupId}
                  fileId={currentFile?.id} 
                  page={currentPage}
                  pageRendered={pageRendered}
                  parentCanvasRef={canvasRef}
                  annotationMode={annotationMode}
                  showGroupAnnotations={showGroupAnnotations}
                  showPersonalAnnotations={showPersonalAnnotations}
                  currentUser={{
                      ...currentUser,
                      isCreator: isCreator 
                  }}
                  activeTool={activeTool}
                  brushColor={brushColor}
                  strokeWidth={strokeWidth}
              />
            </div>
          </div>
          
          {!isFullscreen && (
            <div style={{ textAlign: 'center', marginTop: '1rem'}}>
              <button className="secondary" onClick={toggleFullscreen} style={{marginRight: '1rem'}}>Fullscreen</button>
              <button className="danger" onClick={deleteCurrentFile}>Delete File</button>
              {currentFile?.driveId && (
                <a 
                  href={`https://drive.google.com/file/d/${currentFile.driveId}/view`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  <button className="secondary" style={{marginLeft: '1rem' }}>View Original <FiExternalLink />
                  </button>
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
