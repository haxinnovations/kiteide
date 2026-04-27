import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, Plus, Trash2, Save, Sidebar as SidebarIcon, RefreshCw, Edit3, FolderOpen, FolderPlus, Terminal as TerminalIcon, X, Minus, Square, Sparkles, RotateCcw, RotateCw, Scissors, Copy, CopyPlus, Link, MapPin, ClipboardPaste, Check, MoreVertical, Palette } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import Terminal from './components/Terminal'
import BrowserPanel from './components/BrowserPanel'
import CodeEditor from './components/CodeEditor'
import FileTreeItem from './components/FileTreeItem'

const appWindow = getCurrentWindow();

function App() {
  const [currentDir, setCurrentDir] = useState(() => {
    const saved = localStorage.getItem('kite-dir')
    if (!saved || saved === 'null' || saved === 'undefined') return null;
    return saved.replace(/\\/g, '/')
  })

  const [activeFile, setActiveFile] = useState(null)
  const [selectedPath, setSelectedPath] = useState(null)
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminals, setTerminals] = useState([{ id: 'default', title: 'powershell' }])
  const [activeTerminalId, setActiveTerminalId] = useState('default')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [menu, setMenu] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [clipboard, setClipboard] = useState(null) // { path, type, name }
  const [terminalMenu, setTerminalMenu] = useState(null); // { id, x, y }
  const [renamingPath, setRenamingPath] = useState(null)
  const [creatingItem, setCreatingItem] = useState(null) // { parentPath, type }
  const [showThemeModal, setShowThemeModal] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('kite-theme') || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kite-theme', theme);
  }, [theme]);

  const isResizingSidebar = useRef(false)
  const isResizingTerminal = useRef(false)
  const isResizingChat = useRef(false)


  const fetchFiles = async (dir = currentDir) => {
    if (!dir || dir === 'null') return
    setLoading(true)
    try {
      await invoke('list_files', { dir })
      await emit('refresh-files', {});
    } catch (error) {
      console.error('Failed to list files:', error)
    } finally {
      setLoading(false)
    }
  }

  // Initialize CSS Variables from localStorage or defaults
  useEffect(() => {
    const savedSidebarWidth = localStorage.getItem('kite-sidebar-width') || '260px';
    const savedChatWidth = localStorage.getItem('kite-chat-width') || '300px';
    const savedTerminalHeight = localStorage.getItem('kite-terminal-height') || '250px';
    document.documentElement.style.setProperty('--sidebar-width', savedSidebarWidth);
    document.documentElement.style.setProperty('--chat-width', savedChatWidth);
    document.documentElement.style.setProperty('--terminal-height', savedTerminalHeight);
  }, []);

  useEffect(() => {
    if (currentDir && currentDir !== 'null') {
      setTimeout(() => fetchFiles(), 0)
      localStorage.setItem('kite-dir', currentDir)
    }
    // Global click-away listener for all menus
    const handleGlobalMouseDown = (e) => {
      // If we clicked something that isn't a menu or a menu trigger, close all menus
      if (!e.target.closest('.terminal-tab-menu') && 
          !e.target.closest('.tab-options-btn') && 
          !e.target.closest('.context-menu') &&
          !e.target.closest('.dropdown-menu')) {
        setMenu(null)
        setContextMenu(null)
        setTerminalMenu(null)
      }
    }
    window.addEventListener('mousedown', handleGlobalMouseDown)

    // Optimized High-Performance Resizing
    const handleMouseMove = (e) => {
      if (isResizingSidebar.current) {
        const newWidth = Math.max(150, Math.min(600, e.clientX));
        document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
      }
      if (isResizingTerminal.current) {
        const newHeight = Math.max(100, Math.min(window.innerHeight - 200, window.innerHeight - e.clientY));
        document.documentElement.style.setProperty('--terminal-height', `${newHeight}px`);
      }
      if (isResizingChat.current) {
        const newWidth = Math.max(200, Math.min(600, window.innerWidth - e.clientX));
        document.documentElement.style.setProperty('--chat-width', `${newWidth}px`);
      }
    };

    const handleMouseUp = () => {
      if (isResizingSidebar.current) {
        localStorage.setItem('kite-sidebar-width', document.documentElement.style.getPropertyValue('--sidebar-width'));
      }
      if (isResizingTerminal.current) {
        localStorage.setItem('kite-terminal-height', document.documentElement.style.getPropertyValue('--terminal-height'));
      }
      if (isResizingChat.current) {
        localStorage.setItem('kite-chat-width', document.documentElement.style.getPropertyValue('--chat-width'));
      }
      isResizingSidebar.current = false;
      isResizingTerminal.current = false;
      isResizingChat.current = false;
      document.body.classList.remove('resizing');
    };

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousedown', handleGlobalMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDir])

  const handleOpenFolder = async () => {
    setMenu(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select Workspace Folder' })
      if (selected && typeof selected === 'string') {
        setCurrentDir(selected)
        setSelectedPath(selected)
        localStorage.setItem('kite-dir', selected)
        setActiveFile(null)
        setTitle('')
        setContent('')
        await fetchFiles(selected)
      }
    } catch (error) {
      console.error('Failed to open folder:', error)
    }
  }

  const getDirName = (path) => {
    if (!path) return ''
    const parts = path.split(/[/\\]/)
    return parts[parts.length - 1] || path
  }

  const getParentDir = (path) => {
    if (!path) return ''
    const parts = path.split(/[/\\]/)
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/')
  }

  const handleCreateFile = async (name, content) => {
    console.log('handleCreateFile triggered:', { name, currentDir });
    if (!currentDir) {
      console.warn('Cannot create file: currentDir is empty');
      return;
    }
    
    try {
      // Use save_note to create the new file
      console.log(`Writing file to: ${currentDir}/${name}`);
      await invoke('save_note', { dir: currentDir, title: name, content });
      
      // Refresh the file list using the unified helper
      await fetchFiles();
      console.log('File created and sidebar refreshed');
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  };

  const getBreadcrumbs = () => {
    if (!activeFile || !currentDir) return [{ name: getDirName(currentDir), isLast: true }];
    const normalizedRoot = currentDir.replace(/\\/g, '/');
    const normalizedFile = activeFile.replace(/\\/g, '/');
    const rootName = getDirName(currentDir);
    let relative = normalizedFile;
    if (normalizedFile.startsWith(normalizedRoot)) {
      relative = normalizedFile.substring(normalizedRoot.length).replace(/^\//, '');
    }
    const parts = relative.split('/').filter(Boolean);
    const crumbs = [{ name: rootName, isLast: parts.length === 0 }];
    parts.forEach((part, index) => {
      crumbs.push({ name: part, isLast: index === parts.length - 1 });
    });
    return crumbs;
  };

  const handleApplyEdits = async (edits) => {
    console.log('Apply edits triggered:', edits);
    if (!edits || !Array.isArray(edits)) {
      console.warn('Apply edits ignored: edits missing');
      return;
    }
    
    // Group edits by file
    const editsByFile = edits.reduce((acc, edit) => {
      // Use edit.file if provided, otherwise fallback to activeFile path
      const filePath = edit.file ? (currentDir + '/' + edit.file.replace(/\\/g, '/').replace(/^\//, '')) : activeFile;
      if (!filePath) return acc;
      if (!acc[filePath]) acc[filePath] = [];
      acc[filePath].push(edit);
      return acc;
    }, {});

    for (const [filePath, fileEdits] of Object.entries(editsByFile)) {
      try {
        let fileLines = [];
        let isCurrentFile = filePath === activeFile;

        if (isCurrentFile) {
          fileLines = content.split('\n');
        } else {
          // Read from disk
          const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
          const parent = lastSlash !== -1 ? filePath.substring(0, lastSlash) : '.';
          const filename = lastSlash !== -1 ? filePath.substring(lastSlash + 1) : filePath;
          const diskContent = await invoke('read_file', { dir: parent, name: filename });
          fileLines = diskContent.split('\n');
        }

        // Sort edits in reverse order for this file
        const sortedEdits = [...fileEdits].sort((a, b) => b.startLine - a.startLine);
        
        for (const edit of sortedEdits) {
          const startIdx = edit.startLine - 1;
          const endIdx = edit.endLine - 1;
          if (startIdx >= 0 && startIdx <= fileLines.length) {
            const replacementLines = edit.replacement.split('\n');
            const deleteCount = Math.max(0, (endIdx - startIdx) + 1);
            fileLines.splice(startIdx, deleteCount, ...replacementLines);
          }
        }

        const updatedContent = fileLines.join('\n');
        
        // Save to disk
        const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        const parent = lastSlash !== -1 ? filePath.substring(0, lastSlash) : '.';
        const filename = lastSlash !== -1 ? filePath.substring(lastSlash + 1) : filePath;
        await invoke('save_note', { dir: parent, title: filename, content: updatedContent });
        
        // If it's the current file, update editor state too
        if (isCurrentFile) {
          setContent(updatedContent);
        }
        
        console.log(`Successfully applied edits to ${filePath}`);
      } catch (err) {
        console.error(`Failed to apply edits to ${filePath}:`, err);
      }
    }
  };

  const handleFileClick = async (file, parentPath) => {
    if (file.is_dir) return
    const fullPath = `${parentPath}/${file.name}`;
    setSelectedPath(fullPath);
    try {
      const fileContent = await invoke('read_file', { dir: parentPath, name: file.name })
      setActiveFile(fullPath)
      setTitle(file.name)
      setContent(fileContent)
    } catch (error) {
      console.error('Failed to read file:', error)
    }
  }

  const handleFolderClick = (path) => setSelectedPath(path);

  const handleDuplicate = async () => {
    if (!contextMenu || contextMenu.isDir) return; // Only files for now
    try {
      const { fileName, parentPath } = contextMenu;
      const ext = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
      const baseName = ext ? fileName.replace(ext, '') : fileName;
      const newTitle = `${baseName}_copy${ext}`;
      
      const content = await invoke('read_file', { dir: parentPath, name: fileName });
      await invoke('save_note', { dir: parentPath, title: newTitle, content });
      fetchFiles();
      emit('refresh-files'); // Notify tree to update
    } catch (error) {
      console.error('Failed to duplicate:', error);
    }
    setContextMenu(null);
  };

  const handleCopy = () => {
    if (!contextMenu) return;
    setClipboard({ path: contextMenu.fullPath, type: 'copy', name: contextMenu.fileName });
    setContextMenu(null);
  };

  const handleCut = () => {
    if (!contextMenu) return;
    setClipboard({ path: contextMenu.fullPath, type: 'cut', name: contextMenu.fileName });
    setContextMenu(null);
  };

  const handlePaste = async () => {
    if (!clipboard || !contextMenu) return;
    try {
      // If right-clicked on a dir, paste inside. If file, paste in same dir.
      const destDir = contextMenu.isDir ? contextMenu.fullPath : contextMenu.parentPath;
      const destPath = `${destDir}/${clipboard.name}`;
      
      if (clipboard.type === 'copy') {
        await invoke('copy_file', { src: clipboard.path, dest: destPath });
      } else {
        await invoke('move_file', { src: clipboard.path, dest: destPath });
        setClipboard(null); // Clear clipboard after cut/paste
      }
      fetchFiles();
      emit('refresh-files');
    } catch (error) {
      console.error('Failed to paste:', error);
    }
    setContextMenu(null);
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setContextMenu(null);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const getRelativePath = (fullPath) => {
    if (!currentDir) return fullPath;
    // Normalize paths for comparison
    const normalizedFull = fullPath.replace(/\\/g, '/');
    const normalizedRoot = currentDir.replace(/\\/g, '/');
    return normalizedFull.replace(normalizedRoot, '').replace(/^[/\\]/, '') || '.';
  };

  const handleContextMenu = (e, file, parentPath) => {
    e.preventDefault()
    e.stopPropagation()
    const fullPath = (parentPath ? `${parentPath}/${file.name}` : file.name).replace(/\\/g, '/');
    setSelectedPath(fullPath);
    setContextMenu({ x: e.clientX, y: e.clientY, fileName: file.name, parentPath: parentPath, isDir: file.is_dir, fullPath: fullPath })
  }

  const getTargetDir = async () => {
    let target = selectedPath || currentDir;
    if (!target) return currentDir;
    target = target.replace(/\\/g, '/');
    const isFile = target.includes('.') && !target.endsWith('/'); 
    if (isFile) return target.substring(0, target.lastIndexOf('/'));
    return target;
  }

  const createNote = async () => {
    const targetDir = await getTargetDir();
    setCreatingItem({ parentPath: targetDir, type: 'file' });
  }

  const createNewFolder = async () => {
    const targetDir = await getTargetDir();
    setCreatingItem({ parentPath: targetDir, type: 'folder' });
  }

  const submitCreation = async (parentPath, name, type) => {
    if (!name) {
      setCreatingItem(null);
      return;
    }
    try {
      if (type === 'file') {
        await invoke('create_file', { dir: parentPath, name })
        handleFileClick({ name, is_dir: false }, parentPath)
      } else {
        await invoke('create_dir', { dir: parentPath, name })
      }
      await fetchFiles()
      emit('refresh-files')
    } catch (error) {
      alert(`Failed to create ${type}: ` + error)
    }
    setCreatingItem(null);
  }

  const addTerminal = () => {
    const newId = `term-${Date.now()}`;
    setTerminals([...terminals, { id: newId, title: 'powershell' }]);
    setActiveTerminalId(newId);
    setTerminalOpen(true);
  };

  const removeTerminal = (e, idToRemove) => {
    if (e) e.stopPropagation();
    const newTerminals = terminals.filter(t => t.id !== idToRemove);
    setTerminals(newTerminals);
    
    if (newTerminals.length === 0) {
      setTerminalOpen(false);
    } else if (activeTerminalId === idToRemove) {
      setActiveTerminalId(newTerminals[newTerminals.length - 1].id);
    }
    setTerminalMenu(null);
  };

  const renameTerminal = (id) => {
    const term = terminals.find(t => t.id === id);
    const newName = prompt('Enter new terminal name:', term.title);
    if (newName && newName.trim()) {
      setTerminals(terminals.map(t => t.id === id ? { ...t, title: newName } : t));
    }
    setTerminalMenu(null);
  };

  const handleSave = async () => {
    if (!activeFile) return
    setSaving(true)
    try {
      const lastSlash = activeFile.lastIndexOf('/');
      const dir = activeFile.substring(0, lastSlash);
      const name = activeFile.substring(lastSlash + 1);
      await invoke('save_note', { dir, title: name, content })
      setSaving(false)
    } catch (error) {
      alert('Save failed: ' + error)
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!contextMenu?.fileName) return
    if (!confirm(`Delete ${contextMenu.fileName}?`)) return
    try {
      await invoke('delete_file', { dir: contextMenu.parentPath, name: contextMenu.fileName })
      if (activeFile === contextMenu.fullPath) {
        setActiveFile(null)
        setTitle('')
        setContent('')
      }
      await fetchFiles()
      emit('refresh-files')
    } catch (error) {
      alert('Delete failed: ' + error)
    }
    setContextMenu(null)
  }

  const handleRename = () => {
    if (!contextMenu?.fullPath) return
    setRenamingPath(contextMenu.fullPath)
    setContextMenu(null)
  }

  const submitRename = async (oldPath, newName) => {
    if (!newName || newName === getDirName(oldPath)) {
      setRenamingPath(null)
      return
    }
    
    const parentPath = getParentDir(oldPath)
    const oldName = getDirName(oldPath)
    
    try {
      await invoke('rename_file', { 
        dir: parentPath, 
        oldName: oldName, 
        newName: newName 
      })
      const newFullPath = parentPath ? `${parentPath}/${newName}` : newName;
      if (activeFile === oldPath) {
        setActiveFile(newFullPath)
        setTitle(newName)
      }
      await fetchFiles()
      emit('refresh-files')
    } catch (error) {
      alert('Rename failed: ' + error)
    }
    setRenamingPath(null)
  }



  const handleMinimize = () => invoke('minimize_window');
  const handleMaximize = () => invoke('toggle_maximize');
  const handleClose = () => invoke('close_window');

  const handleDrag = (e) => {
    if (e.button === 0 && !e.target.closest('button')) {
      appWindow.startDragging();
    }
  };

  const startResizingSidebar = (e) => {
    e.preventDefault();
    isResizingSidebar.current = true;
    document.body.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
  };

  const startResizingTerminal = (e) => {
    e.preventDefault();
    isResizingTerminal.current = true;
    document.body.classList.add('resizing');
    document.body.style.cursor = 'row-resize';
  };

  const startResizingChat = (e) => {
    e.preventDefault();
    isResizingChat.current = true;
    document.body.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          handleSave();
        } else if (e.key === 'o') {
          e.preventDefault();
          handleOpenFolder();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, activeFile]); // Dependencies ensure we have latest content/file

  return (
    <div className="w-full flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden font-sans selection:bg-accent/20">
      {/* Title Bar */}
      <div 
        className="h-10 flex items-center justify-between px-3 bg-bg-primary border-b border-border select-none flex-shrink-0 drag-region"
        onMouseDown={handleDrag}
      >
        <div className="flex items-center gap-4 no-drag">
          <div className="flex items-center gap-1">
            {/* File Menu */}
            <div className="relative">
              <button 
                className={`px-3 py-1 text-[11px] font-medium rounded-custom transition-all ${menu === 'file' ? 'bg-bg-secondary text-accent shadow-sm' : 'hover:bg-bg-secondary text-text-secondary hover:text-text-primary'}`}
                onClick={(e) => { e.stopPropagation(); setMenu(menu === 'file' ? null : 'file'); }}
              >
                File
              </button>
              <AnimatePresence>
                {menu === 'file' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 4, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    className="absolute top-full left-0 mt-1 w-48 bg-bg-primary border border-border rounded-lg shadow-2xl z-50 py-1 flex flex-col"
                  >
                    <button onClick={() => { handleOpenFolder(); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <FolderOpen size={14} className="text-text-secondary group-hover:text-accent transition-colors" /> 
                      <span>Open Folder</span>
                      <span className="ml-auto opacity-30 text-[10px]">Ctrl+O</span>
                    </button>
                    <button onClick={() => { createNote(); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <Plus size={14} className="text-text-secondary group-hover:text-accent transition-colors" /> 
                      <span>New File</span>
                      <span className="ml-auto opacity-30 text-[10px]">Ctrl+N</span>
                    </button>
                    <div className="h-[1px] bg-border my-1 mx-2" />
                    <button onClick={() => { handleSave(); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <Save size={14} className="text-text-secondary group-hover:text-accent transition-colors" /> 
                      <span>Save File</span>
                      <span className="ml-auto opacity-30 text-[10px]">Ctrl+S</span>
                    </button>
                    <div className="h-[1px] bg-border my-1 mx-2" />
                    <button onClick={() => { handleClose(); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-red-50 text-red-600 transition-colors text-left group">
                      <X size={14} /> <span>Exit</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Edit Menu */}
            <div className="relative">
              <button 
                className={`px-3 py-1 text-[11px] font-medium rounded-custom transition-all ${menu === 'edit' ? 'bg-bg-secondary text-accent shadow-sm' : 'hover:bg-bg-secondary text-text-secondary hover:text-text-primary'}`}
                onClick={(e) => { e.stopPropagation(); setMenu(menu === 'edit' ? null : 'edit'); }}
              >
                Edit
              </button>
              <AnimatePresence>
                {menu === 'edit' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 4, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    className="absolute top-full left-0 mt-1 w-48 bg-bg-primary border border-border rounded-lg shadow-2xl z-50 py-1 flex flex-col"
                  >
                    <button onClick={() => { document.execCommand('undo'); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <RotateCcw size={14} className="text-text-secondary group-hover:text-accent transition-colors" /> <span>Undo</span>
                      <span className="ml-auto opacity-30 text-[10px]">Ctrl+Z</span>
                    </button>
                    <button onClick={() => { document.execCommand('redo'); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <RotateCw size={14} className="text-text-secondary group-hover:text-accent transition-colors" /> <span>Redo</span>
                      <span className="ml-auto opacity-30 text-[10px]">Ctrl+Y</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>


            {/* View Menu */}
            <div className="relative">
              <button 
                className={`px-3 py-1 text-[11px] font-medium rounded-custom transition-all ${menu === 'view' ? 'bg-bg-secondary text-accent shadow-sm' : 'hover:bg-bg-secondary text-text-secondary hover:text-text-primary'}`}
                onClick={(e) => { e.stopPropagation(); setMenu(menu === 'view' ? null : 'view'); }}
              >
                View
              </button>
              <AnimatePresence>
                {menu === 'view' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 4, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    className="absolute top-full left-0 mt-1 w-48 bg-bg-primary border border-border rounded-lg shadow-2xl z-50 py-1 flex flex-col"
                  >
                    <button onClick={() => { setSidebarOpen(!sidebarOpen); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <span className="w-4 flex justify-center text-accent">{sidebarOpen && <Check size={12} />}</span> 
                      <SidebarIcon size={14} className="text-text-secondary transition-colors group-hover:text-accent" /> <span>Sidebar</span>
                    </button>
                    <button onClick={() => { setTerminalOpen(!terminalOpen); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <span className="w-4 flex justify-center text-accent">{terminalOpen && <Check size={12} />}</span> 
                      <TerminalIcon size={14} className="text-text-secondary transition-colors group-hover:text-accent" /> <span>Terminal</span>
                    </button>
                    <div className="h-[1px] bg-border my-1 mx-2" />
                    <button onClick={() => { setBrowserOpen(!browserOpen); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <span className="w-4 flex justify-center text-accent">{browserOpen && <Check size={12} />}</span> 
                      <Sparkles size={14} className="text-text-secondary transition-colors group-hover:text-accent" /> <span>Gemini</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Settings Menu */}
            <div className="relative">
              <button 
                className={`px-3 py-1 text-[11px] font-medium rounded-custom transition-all ${menu === 'settings' ? 'bg-bg-secondary text-accent shadow-sm' : 'hover:bg-bg-secondary text-text-secondary hover:text-text-primary'}`}
                onClick={(e) => { e.stopPropagation(); setMenu(menu === 'settings' ? null : 'settings'); }}
              >
                Settings
              </button>
              <AnimatePresence>
                {menu === 'settings' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 4, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    className="absolute top-full left-0 mt-1 w-48 bg-bg-primary border border-border rounded-lg shadow-2xl z-50 py-1 flex flex-col"
                  >
                    <button onClick={() => { setShowThemeModal(true); setMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left group">
                      <Palette size={14} className="text-text-secondary group-hover:text-accent transition-colors" /> 
                      <span>Color Themes</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button className="px-3 py-1 text-[11px] font-medium text-text-secondary/30 cursor-not-allowed">Help</button>
          </div>
        </div>
        
        <div className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2 opacity-70 pointer-events-none">
          <img src="/kiteicon.png" alt="" className="w-4 h-4 opacity-80" />
          <span className="text-[11px] font-bold tracking-tight uppercase text-text-secondary">{title || 'Kite IDE'}</span>
        </div>

        <div className="flex items-center no-drag">
          <button className="p-2 hover:bg-bg-secondary transition-colors text-text-secondary hover:text-text-primary" onClick={handleMinimize} title="Minimize"><Minus size={14} /></button>
          <button className="p-2 hover:bg-bg-secondary transition-colors text-text-secondary hover:text-text-primary" onClick={handleMaximize} title="Maximize"><Square size={10} /></button>
          <button className="p-2 hover:bg-red-500 transition-colors text-text-secondary hover:text-white" onClick={handleClose} title="Close"><X size={14} /></button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <div className="flex h-full flex-shrink-0 relative group">
              <motion.div 
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--sidebar-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="h-full bg-bg-primary border-r border-border flex flex-col overflow-hidden"
              >
                <div className="h-9 px-3 border-b border-border flex items-center justify-between bg-bg-secondary/30">
                  <span className="text-[10px] font-bold tracking-widest text-text-secondary uppercase">Explorer</span>
                  <div className="flex items-center gap-0.5">
                    <button onClick={createNote} className="p-1 hover:bg-bg-secondary rounded transition-colors text-text-secondary hover:text-accent" title="New File"><Plus size={14} /></button>
                    <button onClick={createNewFolder} className="p-1 hover:bg-bg-secondary rounded transition-colors text-text-secondary hover:text-accent" title="New Folder"><FolderPlus size={14} /></button>
                    <button onClick={() => fetchFiles()} className="p-1 hover:bg-bg-secondary rounded transition-colors text-text-secondary hover:text-accent" title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto py-2">
                  {currentDir ? (
                    <FileTreeItem 
                      file={{ name: getDirName(currentDir), is_dir: true }}
                      path={getParentDir(currentDir)}
                      level={0}
                      onFileClick={handleFileClick}
                      onFolderClick={handleFolderClick}
                      onContextMenu={handleContextMenu}
                      activeFile={activeFile}
                      selectedPath={selectedPath}
                      clipboard={clipboard}
                      renamingPath={renamingPath}
                      onRename={submitRename}
                      creatingItem={creatingItem}
                      onCreationSubmit={submitCreation}
                    />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-4 opacity-50">
                      <FolderOpen size={48} className="text-text-secondary/30" />
                      <p className="text-xs text-text-secondary leading-relaxed">No project directory<br/>selected</p>
                      <button onClick={handleOpenFolder} className="px-4 py-2 bg-accent text-white rounded-xl text-xs font-bold shadow-md hover:opacity-90 active:scale-95 transition-all">Open Folder</button>
                    </div>
                  )}
                </div>
              </motion.div>
              {/* Resizer */}
              <div 
                className="absolute right-0 top-0 bottom-0 w-[3px] cursor-col-resize hover:bg-accent/30 transition-colors z-10 active:bg-accent"
                onMouseDown={startResizingSidebar}
              />
            </div>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col min-w-0 bg-bg-primary overflow-hidden relative min-h-0">
          <header className="h-10 flex items-center justify-between px-4 border-b border-border bg-bg-primary/50 backdrop-blur-md z-20 flex-shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <button 
                onClick={() => setSidebarOpen(!sidebarOpen)} 
                className={`p-1.5 rounded-lg transition-all ${sidebarOpen ? 'text-accent bg-accent/10' : 'text-text-secondary hover:bg-bg-secondary'}`}
                title={sidebarOpen ? "Close Sidebar" : "Open Sidebar"}
              >
                <SidebarIcon size={16} />
              </button>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary overflow-hidden whitespace-nowrap">
                {getBreadcrumbs().map((crumb, i) => (
                  <div key={i} className="flex items-center gap-1.5 shrink-0">
                    <span className={`transition-colors ${crumb.isLast ? 'text-text-primary font-bold' : 'hover:text-text-primary cursor-default'}`}>
                      {crumb.name}
                    </span>
                    {!crumb.isLast && <span className="opacity-30">/</span>}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {activeFile && (
                <button 
                  onClick={handleSave} 
                  className={`flex items-center gap-2 px-3 py-1 rounded-custom text-[11px] font-bold transition-all shadow-sm ${saving ? 'bg-accent/50 cursor-wait' : 'bg-accent hover:opacity-90 active:scale-95 text-white'}`}
                  disabled={saving}
                >
                  <Save size={14} className={saving ? 'animate-pulse' : ''} />
                  <span>{saving ? 'Saving...' : 'Save'}</span>
                </button>
              )}
              <div className="w-[1px] h-4 bg-border mx-1" />
              <button 
                onClick={() => {
                  if (!terminalOpen && terminals.length === 0) {
                    addTerminal();
                  } else {
                    setTerminalOpen(!terminalOpen);
                  }
                }}
                className={`p-1.5 rounded-lg transition-all ${terminalOpen ? 'text-accent bg-accent/10' : 'text-text-secondary hover:bg-bg-secondary'}`}
                title="Toggle Terminal"
              >
                <TerminalIcon size={16} />
              </button>
              <button 
                onClick={() => setBrowserOpen(!browserOpen)}
                className={`p-1.5 rounded-lg transition-all ${browserOpen ? 'text-accent bg-accent/10' : 'text-text-secondary hover:bg-bg-secondary'}`}
                title="Toggle Gemini Assistant"
              >
                <Sparkles size={16} />
              </button>
            </div>
          </header>

          <div className="flex-1 relative overflow-hidden grid grid-rows-[1fr_auto] min-h-0">
            <div className="overflow-hidden min-h-0">
              {activeFile ? (
                <CodeEditor 
                  activeFile={activeFile}
                  content={content}
                  setContent={setContent}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center bg-radial-at-t from-bg-secondary/20 to-transparent">
                  <div className="max-w-md space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <img src="/kiteicon.png" alt="Kite Logo" className="w-20 h-20 mx-auto opacity-20 grayscale brightness-200" />
                    <div className="space-y-2">
                      <h1 className="text-2xl font-bold tracking-tight text-text-primary">Welcome to Kite IDE</h1>
                      <p className="text-sm text-text-secondary leading-relaxed">The AI-first workspace. Select a file from the explorer or create a new project to start building.</p>
                    </div>
                    {!currentDir && (
                      <button onClick={handleOpenFolder} className="px-6 py-2.5 bg-accent text-white rounded-xl text-sm font-bold shadow-xl shadow-accent/20 hover:opacity-90 active:scale-95 transition-all">
                        Open Workspace
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

          <div className={`relative z-30 flex-shrink-0 ${terminalOpen ? 'block' : 'hidden'}`}>
            <div 
              className="absolute top-0 left-0 right-0 h-1 cursor-row-resize hover:bg-accent/30 transition-colors z-50 active:bg-accent"
              onMouseDown={startResizingTerminal} 
            />
            <motion.div 
              initial={false}
              animate={{ height: terminalOpen ? 'var(--terminal-height)' : 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-bg-primary border-t border-border flex flex-col overflow-hidden"
              style={{ height: terminalOpen ? 'var(--terminal-height)' : 0 }}
            >
              <div className="h-9 px-3 flex items-center justify-between bg-bg-secondary/30 shrink-0">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                  {terminals.map((term) => (
                    <button 
                      key={term.id} 
                      className={`flex items-center gap-2 px-3 py-1 text-[11px] font-bold rounded-t-lg transition-all border-x border-t border-transparent whitespace-nowrap ${activeTerminalId === term.id ? 'bg-bg-primary border-border text-accent shadow-[0_-2px_10px_-3px_rgba(var(--accent-rgb),0.2)]' : 'text-text-secondary hover:text-text-primary'}`}
                      onClick={() => setActiveTerminalId(term.id)}
                    >
                      <TerminalIcon size={12} />
                      <span>{term.title}</span>
                      <div 
                        className="p-0.5 hover:bg-bg-secondary rounded transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setTerminalMenu({ id: term.id, x: rect.left, y: rect.bottom });
                        }}
                      >
                        <MoreVertical size={10} />
                      </div>
                    </button>
                  ))}
                  <button className="p-1 text-text-secondary hover:text-accent hover:bg-bg-secondary rounded transition-all" onClick={addTerminal}>
                    <Plus size={14} />
                  </button>
                </div>
                <button onClick={() => setTerminalOpen(false)} className="p-1 text-text-secondary hover:text-red-500 transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 relative bg-bg-primary min-h-0 overflow-hidden">
                {terminalMenu && (
                  <div className="fixed inset-0 z-[100]" onMouseDown={() => setTerminalMenu(null)}>
                    <div 
                      className="absolute bg-bg-primary border border-border rounded-lg shadow-2xl py-1 w-40 overflow-hidden"
                      style={{ top: terminalMenu.y + 5, left: terminalMenu.x }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button onClick={() => renameTerminal(terminalMenu.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary text-text-primary transition-colors text-left"><Edit3 size={14} className="text-text-secondary" /> Rename</button>
                      <button onClick={() => removeTerminal(null, terminalMenu.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-red-50 text-red-600 transition-colors text-left"><Trash2 size={14} /> Kill Terminal</button>
                    </div>
                  </div>
                )}
                {terminals.map((term) => (
                  <div key={term.id} className={`absolute inset-0 ${activeTerminalId === term.id ? 'block' : 'hidden'}`}>
                    <Terminal currentDir={currentDir} id={term.id} theme={theme} />
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Gemini Sidebar */}
        <AnimatePresence>
          {browserOpen && (
            <div className="flex h-full flex-shrink-0 relative group">
              <div 
                className="absolute left-0 top-0 bottom-0 w-[3px] cursor-col-resize hover:bg-accent/30 transition-colors z-10 active:bg-accent"
                onMouseDown={startResizingChat} 
              />
              <motion.div 
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--chat-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="h-full bg-bg-primary border-l border-border overflow-hidden"
              >
                <BrowserPanel 
                  onClose={() => setBrowserOpen(false)} 
                  activeFile={activeFile ? { name: title, content: content } : null}
                  onApplyEdits={handleApplyEdits}
                  onCreateFile={handleCreateFile}
                  onRefresh={() => fetchFiles()}
                  projectDir={currentDir}
                />
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Global Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <div className="fixed inset-0 z-[1000]" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-[1001] w-56 bg-bg-primary/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl py-1.5 flex flex-col overflow-hidden"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={handleCut} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-secondary text-text-primary transition-all"><Scissors size={14} className="text-text-secondary" /> <span>Cut</span> <span className="ml-auto opacity-30 text-[10px]">Ctrl+X</span></button>
              <button onClick={handleCopy} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-secondary text-text-primary transition-all"><Copy size={14} className="text-text-secondary" /> <span>Copy</span> <span className="ml-auto opacity-30 text-[10px]">Ctrl+C</span></button>
              <button onClick={handlePaste} disabled={!clipboard} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-secondary text-text-primary transition-all disabled:opacity-30"><ClipboardPaste size={14} className="text-text-secondary" /> <span>Paste</span> <span className="ml-auto opacity-30 text-[10px]">Ctrl+V</span></button>
              <button onClick={() => handleDuplicate(contextMenu.fullPath)} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-secondary text-text-primary transition-all"><CopyPlus size={14} className="text-text-secondary" /> <span>Duplicate</span></button>
              
              <div className="h-[1px] bg-border my-1.5 mx-2" />
              
              <button onClick={() => copyToClipboard(contextMenu.fullPath)} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-secondary text-text-primary transition-all"><MapPin size={14} className="text-text-secondary" /> <span>Copy Absolute Path</span></button>
              <button onClick={() => copyToClipboard(getRelativePath(contextMenu.fullPath))} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-secondary text-text-primary transition-all"><Link size={14} className="text-text-secondary" /> <span>Copy Relative Path</span></button>
              
              <div className="h-[1px] bg-border my-1.5 mx-2" />
              
              {(contextMenu.fileName.toLowerCase().endsWith('.html') || contextMenu.fileName.toLowerCase().endsWith('.htm')) && (
                <button 
                  onClick={async () => {
                    try {
                      await invoke('open_in_browser', { path: contextMenu.fullPath });
                      setContextMenu(null);
                    } catch (err) { console.error('Failed to open with browser:', err); }
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-secondary text-text-primary transition-all"
                >
                  <Globe size={14} className="text-text-secondary" /> <span>Open in Browser</span>
                </button>
              )}
              <button onClick={handleRename} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-secondary text-text-primary transition-all"><Edit3 size={14} className="text-text-secondary" /> <span>Rename</span></button>
              <button onClick={handleDelete} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-red-50 text-red-600 transition-all font-bold"><Trash2 size={14} /> <span>Delete</span></button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Theme Modal Overlay */}
      <AnimatePresence>
        {showThemeModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm"
            onClick={() => setShowThemeModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-bg-primary border border-border w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-secondary/30">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-accent/10 rounded-xl text-accent">
                    <Palette size={20} />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-text-primary">Color Themes</h2>
                    <p className="text-[11px] text-text-secondary">Personalize your workspace</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowThemeModal(false)}
                  className="p-2 hover:bg-bg-secondary rounded-full transition-colors text-text-secondary"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  {/* Light Theme */}
                  <button 
                    onClick={() => setTheme('light')}
                    className={`flex flex-col gap-3 p-4 rounded-xl border-2 transition-all text-left ${theme === 'light' ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50 bg-bg-secondary/30'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 shadow-sm" />
                      {theme === 'light' && <Check size={16} className="text-accent" />}
                    </div>
                    <div>
                      <span className="text-[13px] font-bold text-text-primary">Light</span>
                      <p className="text-[10px] text-text-secondary">Clean and bright</p>
                    </div>
                  </button>

                  {/* Dark Theme */}
                  <button 
                    onClick={() => setTheme('dark')}
                    className={`flex flex-col gap-3 p-4 rounded-xl border-2 transition-all text-left ${theme === 'dark' ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50 bg-bg-secondary/30'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-8 h-8 rounded-lg bg-[#0d1117] border border-gray-800 shadow-sm" />
                      {theme === 'dark' && <Check size={16} className="text-accent" />}
                    </div>
                    <div>
                      <span className="text-[13px] font-bold text-text-primary">Dark</span>
                      <p className="text-[10px] text-text-secondary">Easy on the eyes</p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="px-6 py-4 bg-bg-secondary/30 border-t border-border flex justify-end">
                <button 
                  onClick={() => setShowThemeModal(false)}
                  className="px-4 py-2 bg-accent text-white rounded-xl text-xs font-bold shadow-md hover:opacity-90 active:scale-95 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
