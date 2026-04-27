import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { FileText, Folder, ChevronRight, ChevronDown, Image, Code2, Globe, Palette, Braces, Settings } from 'lucide-react'

// Recursive File Tree Item Component
const FileTreeItem = ({ file, path, level, onFileClick, onContextMenu, activeFile, selectedPath, onFolderClick, clipboard, renamingPath, onRename, creatingItem, onCreationSubmit }) => {
  const [expanded, setExpanded] = useState(level === 0);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);

  const fullPath = (path ? `${path}/${file.name}` : file.name).replace(/\\/g, '/');

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
      js: { icon: <Code2 size={14} />, color: 'text-yellow-500' },
      jsx: { icon: <Code2 size={14} />, color: 'text-blue-400' },
      ts: { icon: <Code2 size={14} />, color: 'text-blue-600' },
      tsx: { icon: <Code2 size={14} />, color: 'text-blue-500' },
      css: { icon: <Palette size={14} />, color: 'text-blue-500' },
      scss: { icon: <Palette size={14} />, color: 'text-pink-500' },
      html: { icon: <Globe size={14} />, color: 'text-orange-500' },
      json: { icon: <Braces size={14} />, color: 'text-yellow-600' },
      md: { icon: <FileText size={14} />, color: 'text-text-secondary' },
      png: { icon: <Image size={14} />, color: 'text-purple-500' },
      jpg: { icon: <Image size={14} />, color: 'text-purple-500' },
      svg: { icon: <Image size={14} />, color: 'text-orange-400' },
      toml: { icon: <Settings size={14} />, color: 'text-text-secondary' },
      yaml: { icon: <Settings size={14} />, color: 'text-text-secondary' },
    };
    return icons[ext] || { icon: <FileText size={14} />, color: 'text-text-secondary' };
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

  // Update state during render if props changed (replaces useEffect for cascading renders)
  if (creatingItem && creatingItem.parentPath === fullPath && !expanded) {
    setExpanded(true);
  }

  useEffect(() => {
    if (expanded && children.length === 0) {
      setTimeout(() => fetchChildren(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, children.length]);

  useEffect(() => {
    let unlisten;
    const setupListener = async () => {
      unlisten = await listen('refresh-files', () => {
        if (expanded) {
          setTimeout(() => fetchChildren(), 0);
        }
      });
    };
    setupListener();
    return () => { if (unlisten) unlisten(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const iconData = getFileIcon(file.name);

  return (
    <div className="select-none">
      <div 
        className={`flex items-center gap-1.5 py-1 px-3 cursor-pointer text-[12px] transition-colors group relative border-l-2 border-transparent ${
          activeFile === fullPath 
            ? 'bg-accent/10 border-accent text-accent font-medium' 
            : selectedPath === fullPath 
              ? 'bg-bg-secondary text-text-primary border-accent/30' 
              : 'text-text-secondary hover:bg-bg-secondary/50 hover:text-text-primary'
        } ${isCutting ? 'opacity-50 grayscale italic' : ''}`}
        style={{ paddingLeft: `${level * 16 + 12}px` }}
        onClick={toggleExpand}
        onContextMenu={(e) => {
          e.preventDefault();
          if (level === 0) return;
          onContextMenu(e, file, path);
        }}
      >
        {file.is_dir ? (
          <>
            {level !== 0 && (
              <span className="text-text-secondary/50 group-hover:text-text-secondary transition-colors">
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            )}
            <Folder size={14} className={`${expanded ? 'text-accent' : 'text-text-secondary'} fill-current opacity-70`} />
          </>
        ) : (
          <span className={`${iconData.color} opacity-80`}>
            {iconData.icon}
          </span>
        )}
        {renamingPath === fullPath ? (
          <input 
            autoFocus
            className="bg-bg-primary text-text-primary px-1 py-0.5 border border-accent/50 rounded outline-none w-full text-[12px] font-medium"
            defaultValue={file.name}
            onFocus={(e) => {
              const dotIdx = file.name.lastIndexOf('.');
              if (!file.is_dir && dotIdx > 0) {
                e.target.setSelectionRange(0, dotIdx);
              } else {
                e.target.select();
              }
            }}
            onBlur={(e) => onRename(fullPath, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(fullPath, e.target.value);
              if (e.key === 'Escape') onRename(fullPath, file.name);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1">{file.name}</span>
        )}
      </div>
      <AnimatePresence>
        {expanded && file.is_dir && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {creatingItem && creatingItem.parentPath === fullPath && (
              <div className="flex items-center gap-1.5 py-1 px-3" style={{ paddingLeft: `${(level + 1) * 16 + 12}px` }}>
                <span className="text-text-secondary opacity-70">
                  {creatingItem.type === 'file' ? <FileText size={14} /> : <Folder size={14} className="text-accent fill-current" />}
                </span>
                <input 
                  autoFocus
                  className="bg-bg-primary text-text-primary px-1 py-0.5 border border-accent/50 rounded outline-none w-full text-[12px] font-medium"
                  placeholder={creatingItem.type === 'file' ? "name.ext" : "folder name"}
                  onBlur={(e) => onCreationSubmit(fullPath, e.target.value, creatingItem.type)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCreationSubmit(fullPath, e.target.value, creatingItem.type);
                    if (e.key === 'Escape') onCreationSubmit(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
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
                renamingPath={renamingPath}
                onRename={onRename}
                creatingItem={creatingItem}
                onCreationSubmit={onCreationSubmit}
              />
            ))}
            {loading && <div className="py-1 text-[10px] italic text-text-secondary opacity-50" style={{ paddingLeft: `${(level + 1) * 16 + 28}px` }}>Loading...</div>}
            {!loading && children.length === 0 && (
              <div className="py-1 text-[10px] italic text-text-secondary opacity-30" style={{ paddingLeft: `${(level + 1) * 16 + 28}px` }}>Empty</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FileTreeItem;
