import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Plus, Trash2, Save, Sidebar as SidebarIcon, RefreshCw, Folder, Edit3, FolderOpen, FolderPlus, Terminal as TerminalIcon, X, ChevronRight, ChevronDown, Minus, Square, MessagesSquare, Sparkles, RotateCcw, RotateCw, Image, Code2, Globe, Palette, Braces, Settings, FileCode, Scissors, Copy, CopyPlus, Link, MapPin, ClipboardPaste, Check, MoreVertical } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import Terminal from './components/Terminal'
import BrowserPanel from './components/BrowserPanel'
import './App.css'

const appWindow = getCurrentWindow();

// Recursive File Tree Item Component
const FileTreeItem = ({ file, path, level, onFileClick, onContextMenu, activeFile, selectedPath, onFolderClick, clipboard }) => {
  const [expanded, setExpanded] = useState(level === 0);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);

  const fullPath = path ? `${path}/${file.name}` : file.name;

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) return { icon: <Code2 size={16} />, className: 'icon-js' };
    if (['css', 'scss', 'less'].includes(ext)) return { icon: <Palette size={16} />, className: 'icon-css' };
    if (['html', 'htm'].includes(ext)) return { icon: <Globe size={16} />, className: 'icon-html' };
    if (['json'].includes(ext)) return { icon: <Braces size={16} />, className: 'icon-json' };
    if (['md'].includes(ext)) return { icon: <FileText size={16} />, className: 'icon-md' };
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return { icon: <Image size={16} />, className: 'icon-image' };
    if (['toml', 'yaml', 'yml', 'conf', 'json'].includes(ext)) return { icon: <Settings size={16} />, className: 'icon-config' };
    return { icon: <FileText size={16} />, className: 'icon-default' };
  };

  const fetchChildren = async () => {
    if (!file.is_dir) return;
    setLoading(true);
    try {
      const result = await invoke('list_files', { dir: fullPath });
      const sorted = result.sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name);
      });
      setChildren(sorted);
    } catch (error) {
      console.error('Failed to list sub-files:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded && children.length === 0) {
      fetchChildren();
    }
  }, [expanded, children.length]);

  useEffect(() => {
    let unlisten;
    const setupListener = async () => {
      unlisten = await listen('refresh-files', () => {
        if (expanded) fetchChildren();
      });
    };
    setupListener();
    return () => { if (unlisten) unlisten(); };
  }, [expanded, fullPath]);

  const toggleExpand = async (e) => {
    e.stopPropagation();
    if (!file.is_dir) {
      onFileClick(file, path);
      return;
    }
    onFolderClick(fullPath);
    if (level === 0) return; // Keep root always open
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) fetchChildren();
  };

  const isCutting = clipboard && clipboard.path === fullPath && clipboard.type === 'cut';

  return (
    <div className="file-tree-item-wrapper">
      <div 
        className={`file-item ${activeFile === fullPath ? 'active' : ''} ${selectedPath === fullPath ? 'selected' : ''} ${isCutting ? 'is-cutting' : ''}`}
        style={{ paddingLeft: `${level * 18 + 12}px` }}
        onClick={toggleExpand}
        onContextMenu={(e) => {
          e.preventDefault();
          if (level === 0) return;
          onContextMenu(e, file, path);
        }}
      >
        {file.is_dir ? (
          <>
            {level !== 0 && (expanded ? <ChevronDown size={14} className="chevron" /> : <ChevronRight size={14} className="chevron" />)}
            <Folder size={16} className="file-icon folder" />
          </>
        ) : (
          <span className={`file-icon ${getFileIcon(file.name).className}`}>
            {getFileIcon(file.name).icon}
          </span>
        )}
        <span className="file-name">{file.name}</span>
      </div>
      <AnimatePresence>
        {expanded && file.is_dir && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="file-children"
          >
            {children.map((child) => (
              <FileTreeItem 
                key={`${fullPath}/${child.name}`}
                file={child}
                path={fullPath}
                level={level + 1}
                onFileClick={onFileClick}
                onContextMenu={onContextMenu}
                activeFile={activeFile}
                selectedPath={selectedPath}
                onFolderClick={onFolderClick}
                clipboard={clipboard}
              />
            ))}
            {loading && <div className="loading-small" style={{ paddingLeft: `${(level + 1) * 18 + 28}px` }}>Loading...</div>}
            {!loading && children.length === 0 && (
              <div className="empty-small" style={{ paddingLeft: `${(level + 1) * 18 + 28}px` }}>Empty</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

function App() {
  const [currentDir, setCurrentDir] = useState(() => {
    const saved = localStorage.getItem('kite-dir')
    return (saved === 'null' || saved === 'undefined') ? null : saved
  })
  const [files, setFiles] = useState([])
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

  const isResizingSidebar = useRef(false)
  const isResizingTerminal = useRef(false)
  const isResizingChat = useRef(false)
  const lineNumbersRef = useRef(null);
  const editorRef = useRef(null);
  const [terminalHeight, setTerminalHeight] = useState(200);

  const handleEditorScroll = (e) => {
    const { scrollTop, scrollLeft } = e.target;
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = scrollTop;
    }
    const highlightLayer = e.target.parentElement.querySelector('.highlight-layer');
    if (highlightLayer) {
      highlightLayer.scrollTop = scrollTop;
      highlightLayer.scrollLeft = scrollLeft;
    }
  }

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
  }, [content, activeFile]); // Dependencies ensure we have latest content/file

  const fetchFiles = async (dir = currentDir) => {
    if (!dir || dir === 'null') return
    setLoading(true)
    try {
      const result = await invoke('list_files', { dir })
      const sorted = result.sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1
        if (!a.is_dir && b.is_dir) return 1
        return a.name.localeCompare(b.name)
      })
      setFiles(sorted)
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
    const savedTerminalHeight = localStorage.getItem('kite-terminal-height') || '250px';
    const savedChatWidth = localStorage.getItem('kite-chat-width') || '300px';
    document.documentElement.style.setProperty('--sidebar-width', savedSidebarWidth);
    document.documentElement.style.setProperty('--terminal-height', savedTerminalHeight);
    document.documentElement.style.setProperty('--chat-width', savedChatWidth);
  }, []);

  useEffect(() => {
    if (currentDir && currentDir !== 'null') {
      fetchFiles()
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
      
      // Refresh the file list
      const updatedFiles = await invoke('read_dir', { path: currentDir });
      setFiles(updatedFiles);
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
    const fullPath = parentPath ? `${parentPath}/${file.name}` : file.name;
    setSelectedPath(fullPath);
    setContextMenu({ x: e.clientX, y: e.clientY, fileName: file.name, parentPath: parentPath, isDir: file.is_dir, fullPath: fullPath })
  }

  const getTargetDir = async () => {
    if (!selectedPath) return currentDir;
    const isFile = selectedPath.includes('.') && !selectedPath.endsWith('/'); 
    if (isFile) return selectedPath.substring(0, selectedPath.lastIndexOf('/'));
    return selectedPath;
  }

  const createNote = async () => {
    const targetDir = await getTargetDir();
    const name = prompt(`Create new file in ${getDirName(targetDir)}:`)
    if (!name) return
    try {
      await invoke('create_file', { dir: targetDir, name })
      await fetchFiles()
      handleFileClick({ name, is_dir: false }, targetDir)
    } catch (error) {
      alert('Failed to create file: ' + error)
    }
  }

  const createNewFolder = async () => {
    const targetDir = await getTargetDir();
    const name = prompt(`Create new folder in ${getDirName(targetDir)}:`)
    if (!name) return
    try {
      await invoke('create_dir', { dir: targetDir, name })
      await fetchFiles()
    } catch (error) {
      alert('Failed to create folder: ' + error)
    }
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

  const handleRename = async () => {
    if (!contextMenu?.fileName) return
    const newName = prompt('New name:', contextMenu.fileName)
    if (!newName || newName === contextMenu.fileName) return
    try {
      await invoke('rename_file', { 
        dir: contextMenu.parentPath, 
        old_name: contextMenu.fileName, 
        new_name: newName 
      })
      const newFullPath = contextMenu.parentPath ? `${contextMenu.parentPath}/${newName}` : newName;
      if (activeFile === contextMenu.fullPath) {
        setActiveFile(newFullPath)
        setTitle(newName)
      }
      await fetchFiles()
      emit('refresh-files')
    } catch (error) {
      alert('Rename failed: ' + error)
    }
    setContextMenu(null)
  }

  const handleKeyDown = (e) => {
    const textarea = e.target;
    const { selectionStart, selectionEnd, value } = textarea;

    // 1. Bracket/Quote Completion
    const isHTML = activeFile?.endsWith('.html') || activeFile?.endsWith('.htm');
    const pairs = {
      '(': ')',
      '[': ']',
      '{': '}',
      '"': '"',
      "'": "'",
      '`': '`'
    };
    
    // Only auto-complete < if NOT in an HTML file
    if (!isHTML) {
      pairs['<'] = '>';
    }

    if (pairs[e.key]) {
      e.preventDefault();
      const pair = pairs[e.key];
      const before = value.substring(0, selectionStart);
      const after = value.substring(selectionEnd);
      
      const newValue = before + e.key + pair + after;
      
      // Force DOM update
      textarea.value = newValue;
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
      
      // Sync State
      setContent(newValue);
      return;
    }

    // 2. Auto-Indentation on Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      
      const charBefore = value[selectionStart - 1];
      const charAfter = value[selectionStart];
      
      // Find current line's indentation
      const lastNewLine = value.lastIndexOf('\n', selectionStart - 1);
      const lineStart = lastNewLine === -1 ? 0 : lastNewLine + 1;
      const currentLine = value.substring(lineStart, selectionStart);
      const indentMatch = currentLine.match(/^\s*/);
      const currentIndent = indentMatch ? indentMatch[0] : '';
      
      let newValue = '';
      let newPos = 0;

      // Case A: Expansion between brackets or HTML tags
      const isBetweenBrackets = (charBefore === '{' && charAfter === '}') ||
                                (charBefore === '[' && charAfter === ']') ||
                                (charBefore === '(' && charAfter === ')');
      const isBetweenTags = charBefore === '>' && charAfter === '<';

      if (isBetweenBrackets || isBetweenTags) {
        const indentLevel = currentIndent + '\t';
        newValue = value.substring(0, selectionStart) + '\n' + indentLevel + '\n' + currentIndent + value.substring(selectionEnd);
        newPos = selectionStart + 1 + indentLevel.length;
      } else {
        // Case B: Simple new line with indentation
        let nextIndent = currentIndent;
        const trimmedLine = currentLine.trim();
        
        // Indent after brackets, colons, or opening HTML tags
        const isOpeningTag = trimmedLine.startsWith('<') && !trimmedLine.startsWith('</') && trimmedLine.endsWith('>') && !trimmedLine.endsWith('/>');
        
        if (trimmedLine.endsWith('{') || trimmedLine.endsWith('[') || trimmedLine.endsWith('(') || trimmedLine.endsWith(':') || isOpeningTag) {
          nextIndent += '\t';
        }
        newValue = value.substring(0, selectionStart) + '\n' + nextIndent + value.substring(selectionEnd);
        newPos = selectionStart + 1 + nextIndent.length;
      }
      
      // Force DOM update
      textarea.value = newValue;
      textarea.selectionStart = textarea.selectionEnd = newPos;
      
      // Sync State
      setContent(newValue);
      return;
    }

    // 3. Tab Handling (Insert a Tab)
    if (e.key === 'Tab') {
      e.preventDefault();
      const before = value.substring(0, selectionStart);
      const after = value.substring(selectionEnd);
      const newValue = before + '\t' + after;
      
      textarea.value = newValue;
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
      
      setContent(newValue);
      return;
    }

    // 4. HTML Auto-Closing Tags
    if (e.key === '>' && (activeFile?.endsWith('.html') || activeFile?.endsWith('.htm'))) {
      const VOID_ELEMENTS = [
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 
        'link', 'meta', 'param', 'source', 'track', 'wbr'
      ];
      
      const before = value.substring(0, selectionStart);
      const lastOpen = before.lastIndexOf('<');
      
      // Check if we're inside a tag and it's not already closed
      if (lastOpen !== -1 && lastOpen > before.lastIndexOf('>')) {
        const tagContent = before.substring(lastOpen + 1);
        const tagNameMatch = tagContent.match(/^([a-zA-Z0-9]+)/);
        
        if (tagNameMatch) {
          const tagName = tagNameMatch[1];
          if (!VOID_ELEMENTS.includes(tagName.toLowerCase())) {
            e.preventDefault();
            const after = value.substring(selectionEnd);
            const newValue = before + '>' + '</' + tagName + '>' + after;
            
            textarea.value = newValue;
            textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
            setContent(newValue);
            return;
          }
        }
      }
    }

    // 5. Smart Typing: : (add space)
    if (e.key === ':') {
      e.preventDefault();
      const before = value.substring(0, selectionStart);
      const after = value.substring(selectionEnd);
      const newValue = before + ': ' + after;
      textarea.value = newValue;
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      setContent(newValue);
      return;
    }

    // 6. Smart Typing: ; (new line)
    if (e.key === ';') {
      e.preventDefault();
      
      // Find current indentation
      const lastNewLine = value.lastIndexOf('\n', selectionStart - 1);
      const lineStart = lastNewLine === -1 ? 0 : lastNewLine + 1;
      const currentLine = value.substring(lineStart, selectionStart);
      const indentMatch = currentLine.match(/^\s*/);
      const currentIndent = indentMatch ? indentMatch[0] : '';
      
      const before = value.substring(0, selectionStart);
      const after = value.substring(selectionEnd);
      const newValue = before + ';\n' + currentIndent + after;
      
      textarea.value = newValue;
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 2 + currentIndent.length;
      setContent(newValue);
      return;
    }
  }

  const highlightContent = (text) => {
    if (!activeFile?.endsWith('.html') && !activeFile?.endsWith('.htm')) return text;
    
    // Escape HTML special chars to prevent injection and show literal characters
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
      
    // Highlight tags: &lt;...&gt;
    // We target the entire tag including brackets
    return escaped.replace(/(&lt;\/?[a-zA-Z0-9]+.*?&gt;)/g, '<span class="html-tag">$1</span>');
  };

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

  return (
    <div className="app-container">
      {/* Premium Custom Title Bar */}
      <div className="custom-title-bar" onMouseDown={handleDrag}>
        <div className="title-bar-left">

          <div className="title-bar-menu">
            <div className="menu-container">
              <button 
                className={`menu-btn ${menu === 'file' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === 'file' ? null : 'file');
                }}
              >
                File
              </button>
              <AnimatePresence>
                {menu === 'file' && (
                  <motion.div 
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="menu-dropdown"
                  >
                    <button onClick={handleOpenFolder}>
                      <FolderOpen size={14} />
                      <span>Open Folder</span>
                      <span className="shortcut-label">Ctrl+O</span>
                    </button>
                    <button onClick={createNote}>
                      <Plus size={14} />
                      <span>New File</span>
                      <span className="shortcut-label">Ctrl+N</span>
                    </button>
                    <button onClick={handleSave}>
                      <Save size={14} />
                      <span>Save File</span>
                      <span className="shortcut-label">Ctrl+S</span>
                    </button>
                    <div className="menu-divider" />
                    <button onClick={handleClose}>
                      <X size={14} />
                      <span>Exit</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="menu-container">
              <button 
                className={`menu-btn ${menu === 'edit' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === 'edit' ? null : 'edit');
                }}
              >
                Edit
              </button>
              <AnimatePresence>
                {menu === 'edit' && (
                  <motion.div 
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="menu-dropdown"
                  >
                    <button onClick={() => { document.execCommand('undo'); setMenu(null); }}>
                      <RotateCcw size={14} />
                      <span>Undo</span>
                      <span className="shortcut-label">Ctrl+Z</span>
                    </button>
                    <button onClick={() => { document.execCommand('redo'); setMenu(null); }}>
                      <RotateCw size={14} />
                      <span>Redo</span>
                      <span className="shortcut-label">Ctrl+Y</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>


            <div className="menu-container">
              <button 
                className={`menu-btn ${menu === 'view' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === 'view' ? null : 'view');
                }}
              >
                View
              </button>
              <AnimatePresence>
                {menu === 'view' && (
                  <motion.div 
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="menu-dropdown"
                  >
                    <button onClick={() => { setSidebarOpen(!sidebarOpen); setMenu(null); }}>
                      <span className="menu-check">{sidebarOpen && <Check size={14} />}</span>
                      <SidebarIcon size={14} />
                      <span>File Explorer</span>
                    </button>
                    <button onClick={() => { setTerminalOpen(!terminalOpen); setMenu(null); }}>
                      <span className="menu-check">{terminalOpen && <Check size={14} />}</span>
                      <TerminalIcon size={14} />
                      <span>Terminal</span>
                    </button>
                    <div className="menu-divider" />
                    <button onClick={() => { setBrowserOpen(!browserOpen); setMenu(null); }}>
                      <span className="menu-check">{browserOpen && <Check size={14} />}</span>
                      <Sparkles size={14} />
                      <span>Gemini Assistant</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button className="menu-btn disabled">Help</button>
          </div>
        </div>
        
        <div className="title-bar-center">
          <img src="/kiteicon.png" alt="" className="title-bar-logo" />
          <span className="window-title">{title || 'Kite IDE'}</span>
        </div>

        <div className="title-bar-right">
          <button className="window-control-btn" onClick={handleMinimize} title="Minimize">
            <Minus size={14} />
          </button>
          <button className="window-control-btn" onClick={handleMaximize} title="Maximize">
            <Square size={12} />
          </button>
          <button className="window-control-btn close" onClick={handleClose} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="workspace-layout">
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div 
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--sidebar-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="sidebar"
              >
                <div className="sidebar-header">
                  <div className="sidebar-actions">
                    <button onClick={createNote} title="New File" className="action-btn">
                      <Plus size={16} />
                    </button>
                    <button onClick={createNewFolder} title="New Folder" className="action-btn">
                      <FolderPlus size={16} />
                    </button>
                    <button onClick={() => fetchFiles()} title="Refresh" className="action-btn">
                      <RefreshCw size={16} className={loading ? 'spinning' : ''} />
                    </button>
                  </div>
                </div>

                <div className="file-list">
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
                    />
                  ) : (
                    <div className="no-workspace">
                      <FolderOpen size={32} className="no-workspace-icon" />
                      <p>No workspace selected</p>
                      <button onClick={handleOpenFolder} className="btn-primary-sm">Open Folder</button>
                    </div>
                  )}
                </div>
              </motion.div>
              {/* Sidebar Resizer */}
              <div className="resizer-v" onMouseDown={startResizingSidebar} />
            </>
          )}
        </AnimatePresence>

        <div className="main-content">
          <header className="top-bar">
            <div className="left-group">
              <button 
                onClick={() => setSidebarOpen(!sidebarOpen)} 
                className={`icon-toggle ${sidebarOpen ? 'active' : ''}`}
                title={sidebarOpen ? "Close Sidebar" : "Open Sidebar"}
              >
                <SidebarIcon size={18} />
              </button>
              <div className="breadcrumb">
                {getBreadcrumbs().map((crumb, i) => (
                  <span key={i} className="breadcrumb-item">
                    <span className={`breadcrumb-segment ${crumb.isLast ? 'is-last' : ''}`}>
                      {crumb.name}
                    </span>
                    {!crumb.isLast && <span className="breadcrumb-separator">/</span>}
                  </span>
                ))}
              </div>
            </div>
            
            <div className="right-group">
              {activeFile && (
                <button 
                  onClick={handleSave} 
                  className={`save-btn ${saving ? 'saving' : ''}`}
                  disabled={saving}
                >
                  <Save size={16} />
                  <span>{saving ? 'Saving...' : 'Save'}</span>
                </button>
              )}
              <button 
                onClick={() => {
                  if (!terminalOpen && terminals.length === 0) {
                    addTerminal();
                  } else {
                    setTerminalOpen(!terminalOpen);
                  }
                }}
                className={`icon-toggle ${terminalOpen ? 'active' : ''}`}
                title="Toggle Terminal"
              >
                <TerminalIcon size={18} />
              </button>
              <button 
                onClick={() => setBrowserOpen(!browserOpen)}
                className={`icon-toggle ${browserOpen ? 'active' : ''}`}
                title="Toggle Gemini Assistant"
              >
                <Sparkles size={18} />
              </button>
            </div>
          </header>

          <div className="editor-wrapper">
            <div className="editor-content-area">
              {activeFile ? (
                <div className="editor-with-lines">
                  <div className="line-numbers" ref={lineNumbersRef}>
                    {content.split('\n').map((_, i) => (
                      <div key={i + 1} className="line-number">{i + 1}</div>
                    ))}
                  </div>
                  <div className="editor-container">
                    <div 
                      className="highlight-layer"
                      dangerouslySetInnerHTML={{ __html: highlightContent(content) + '\n' }}
                    />
                    <textarea
                      ref={editorRef}
                      className="editor-textarea"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onScroll={handleEditorScroll}
                      placeholder="Start typing..."
                      spellCheck="false"
                      wrap="off"
                    />
                  </div>
                </div>
              ) : (
                <div className="editor-placeholder">
                  <div className="placeholder-content">
                    <img src="/kiteicon.png" alt="Kite Logo" className="placeholder-logo-img" />
                    <h1>Welcome to Kite IDE</h1>
                    <p>Select a file from the sidebar or create a new one to get started.</p>
                    {!currentDir && (
                      <button onClick={handleOpenFolder} className="btn-primary">
                        Open Folder
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Persistent Terminal Panel */}
            <div className={`terminal-resizer-container ${terminalOpen ? 'visible' : 'hidden'}`}>
              <div className="resizer-h" onMouseDown={startResizingTerminal} />
              <motion.div 
                animate={{ height: terminalOpen ? 'var(--terminal-height)' : 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="terminal-panel"
                style={{ overflow: 'hidden' }}
              >
                <div className="terminal-header">
                  <div className="terminal-tabs">
                    {terminals.map((term) => (
                      <div 
                        key={term.id} 
                        className={`terminal-tab ${activeTerminalId === term.id ? 'active' : ''}`}
                        onClick={() => setActiveTerminalId(term.id)}
                      >
                        <TerminalIcon size={12} />
                        <span>{term.title}</span>
                        <button 
                          className="tab-options-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTerminalMenu({ id: term.id, x: rect.left, y: rect.bottom });
                          }}
                        >
                          <MoreVertical size={12} />
                        </button>
                      </div>
                    ))}
                    <button className="add-terminal-btn" onClick={addTerminal}>
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="terminal-actions">
                    <button onClick={() => setTerminalOpen(false)} className="terminal-close-btn">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="terminal-body">
                  {terminalMenu && (
                    <>
                      <div 
                        className="menu-backdrop" 
                        onMouseDown={() => setTerminalMenu(null)}
                        onContextMenu={(e) => { e.preventDefault(); setTerminalMenu(null); }}
                      />
                      <div 
                        className="terminal-tab-menu"
                        style={{ position: 'fixed', top: terminalMenu.y + 5, left: terminalMenu.x, zIndex: 1000 }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <button onClick={() => renameTerminal(terminalMenu.id)}>
                          <Edit3 size={14} />
                          Rename
                        </button>
                        <button 
                          onClick={() => removeTerminal(null, terminalMenu.id)}
                          className="delete"
                        >
                          <Trash2 size={14} />
                          Kill Terminal
                        </button>
                      </div>
                    </>
                  )}
                  {terminals.map((term) => (
                    <div 
                      key={term.id} 
                      style={{ 
                        display: activeTerminalId === term.id ? 'block' : 'none',
                        width: '100%',
                        height: '100%'
                      }}
                    >
                      <Terminal currentDir={currentDir} id={term.id} />
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {browserOpen && (
            <>
              <div className="resizer-v" onMouseDown={startResizingChat} />
              <motion.div 
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--chat-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="sidebar-right"
              >
                <BrowserPanel 
                  onClose={() => setBrowserOpen(false)} 
                  activeFile={activeFile ? { name: title, content: content } : null}
                  onApplyEdits={handleApplyEdits}
                  onCreateFile={handleCreateFile}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {contextMenu && (
        <div 
          className="context-menu" 
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={handleCut}>
            <Scissors size={14} />
            Cut
          </button>
          <button onClick={handleCopy}>
            <Copy size={14} />
            Copy
          </button>
          <button onClick={handlePaste} disabled={!clipboard}>
            <ClipboardPaste size={14} />
            Paste
          </button>
          <button onClick={() => handleDuplicate(contextMenu.fullPath)}>
            <CopyPlus size={14} />
            Duplicate
          </button>
          <div className="menu-divider" />
          <button onClick={() => copyToClipboard(contextMenu.fullPath)}>
            <MapPin size={14} />
            Copy Absolute Path
          </button>
          <button onClick={() => copyToClipboard(getRelativePath(contextMenu.fullPath))}>
            <Link size={14} />
            Copy Relative Path
          </button>
          <div className="menu-divider" />
          {(contextMenu.fileName.toLowerCase().endsWith('.html') || contextMenu.fileName.toLowerCase().endsWith('.htm')) && (
            <button onClick={async () => {
              try {
                await invoke('open_in_browser', { path: contextMenu.fullPath });
                setContextMenu(null);
              } catch (err) {
                console.error('Failed to open with browser:', err);
              }
            }}>
              <Globe size={14} />
              Open with web browser
            </button>
          )}
          <button onClick={handleRename}>
            <Edit3 size={14} />
            Rename
          </button>
          <button onClick={handleDelete} className="delete">
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

export default App
