import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { FileText, Folder, ChevronRight, ChevronDown } from 'lucide-react'
import { getFileIcon } from '../utils/fileIcons'

const ITEM_HEIGHT = 28;

// Normalize path once, outside the component closure race
function normalizePath(p) {
  return p ? p.replace(/\\/g, '/') : null;
}

const FileTree = ({ 
  rootPath: rawRootPath, 
  onFileClick, 
  onFolderClick, 
  onContextMenu, 
  activeFile, 
  selectedPath, 
  clipboard, 
  renamingPath, 
  onRename, 
  creatingItem, 
  onCreationSubmit 
}) => {
  const rootPath = useMemo(() => normalizePath(rawRootPath), [rawRootPath]);
  
  const [nodes, setNodes] = useState(() => {
    const map = new Map();
    if (rootPath) {
      map.set(rootPath, { name: rootPath.split('/').pop() || rootPath, is_dir: true, children: [], loaded: false });
    }
    return map;
  });
  const [expandedPaths, setExpandedPaths] = useState(() => new Set(rootPath ? [rootPath] : []));
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const containerRef = useRef(null);



  const fetchChildren = useCallback(async (normalizedPath) => {
    if (!normalizedPath) return;
    try {
      // Send the path as-is to Rust — Rust's read_dir handles both / and \ on Windows
      const result = await invoke('list_files', { dir: normalizedPath });
      const { items, truncated, total } = result;
      
      const childrenPaths = items.map(c => ({
        ...c,
        path: normalizePath(`${normalizedPath}/${c.name}`)
      }));

      setNodes(prev => {
        const newNodes = new Map(prev);
        const node = newNodes.get(normalizedPath) || { name: normalizedPath.split('/').pop(), is_dir: true };
        newNodes.set(normalizedPath, { ...node, children: childrenPaths, loaded: true, truncated, total });
        
        childrenPaths.forEach(child => {
          if (!newNodes.has(child.path)) {
            newNodes.set(child.path, { name: child.name, is_dir: child.is_dir, children: [], loaded: false });
          }
        });
        return newNodes;
      });
    } catch (error) {
      console.error('Failed to list files for', normalizedPath, ':', error);
    }
  }, []);

  // Listen for global refresh
  useEffect(() => {
    let unlisten;
    const setup = async () => {
      unlisten = await listen('refresh-files', () => {
        expandedPaths.forEach(path => fetchChildren(path));
      });
    };
    setup();
    return () => { if (typeof unlisten === 'function') unlisten(); };
  }, [expandedPaths, fetchChildren]);

  // Initial fetch for root — fires after the reset effect above
  useEffect(() => {
    if (!rootPath) return;
    // Small delay so the state reset from the effect above settles first
    const timer = setTimeout(() => fetchChildren(rootPath), 50);
    return () => clearTimeout(timer);
  }, [rootPath, fetchChildren]);

  // Flatten tree for virtualization
  const flatList = useMemo(() => {
    const list = [];
    const walk = (path, level, visited = new Set()) => {
      const node = nodes.get(path);
      if (!node || visited.has(path)) return;
      visited.add(path);

      list.push({ 
        path, 
        name: node.name, 
        is_dir: node.is_dir, 
        level,
        loaded: node.loaded,
        truncated: node.truncated,
        total: node.total
      });

      if (node.is_dir && expandedPaths.has(path)) {
        node.children.forEach(child => walk(child.path, level + 1, visited));
        
        if (node.truncated) {
          list.push({
            path: `${path}/_truncated_info`,
            name: `... and ${node.total - 1000} more items (too many to show)`,
            is_dir: false,
            level: level + 1,
            isInfo: true
          });
        }

        if (creatingItem && creatingItem.parentPath === path) {
           list.push({
             path: 'creating-placeholder',
             parentPath: path,
             name: '',
             is_dir: creatingItem.type === 'dir',
             level: level + 1,
             isPlaceholder: true,
             type: creatingItem.type
           });
        }
      }
    };

    if (rootPath) walk(rootPath, 0);
    return list;
  }, [nodes, expandedPaths, rootPath, creatingItem]);

  // Handle intersection/resize for virtualization
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      if (entries[0]) setContainerHeight(entries[0].contentRect.height);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const toggleExpand = async (path, isDir) => {
    try {
      if (!isDir) {
        const node = nodes.get(path);
        if (node) onFileClick?.({ name: node.name, is_dir: false }, path.substring(0, path.lastIndexOf('/')));
        return;
      }

      onFolderClick?.(path);
      const newExpanded = new Set(expandedPaths);
      
      if (newExpanded.has(path)) {
        // COLLAPSE & FORGET: Remove children from map to free memory
        newExpanded.delete(path);
        setNodes(prev => {
          const next = new Map(prev);
          // Reset the collapsed node so it will re-fetch on next expand
          const parentNode = next.get(path);
          if (parentNode) {
            next.set(path, { ...parentNode, loaded: false, children: [], truncated: false, total: 0 });
          }
          // Remove all descendant paths
          for (const [nodePath] of prev) {
            if (nodePath.startsWith(path + '/')) {
              next.delete(nodePath);
            }
          }
          return next;
        });
      } else {
        // EXPAND
        newExpanded.add(path);
        const node = nodes.get(path);
        if (!node?.loaded) fetchChildren(path);
      }
      setExpandedPaths(newExpanded);
    } catch (err) {
      console.error('toggleExpand error:', err);
    }
  };




  // Virtualization calculations
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 5);
  const endIndex = Math.min(flatList.length - 1, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + 5);
  const visibleItems = flatList.slice(startIndex, endIndex + 1);

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto custom-scrollbar relative"
      onScroll={(e) => setScrollTop(e.target.scrollTop)}
    >
      <div style={{ height: flatList.length * ITEM_HEIGHT, width: '100%', position: 'relative' }}>
        {visibleItems.map((item, index) => {
          const isSelected = selectedPath === item.path;
          const isActive = activeFile === item.path;
          const isExpanded = expandedPaths.has(item.path);
          const isCutting = clipboard && clipboard.path === item.path && clipboard.type === 'cut';

          return (
            <div 
              key={item.path}
              className={`absolute left-0 w-full flex items-center gap-1.5 px-3 cursor-pointer text-[12px] transition-colors group border-l-2 border-transparent ${
                isActive 
                  ? 'bg-accent/10 border-accent text-accent font-medium' 
                  : isSelected 
                    ? 'bg-bg-secondary text-text-primary border-accent/30' 
                    : 'text-text-secondary hover:bg-bg-secondary/50 hover:text-text-primary'
              } ${isCutting ? 'opacity-50 grayscale italic' : ''}`}
              style={{ 
                top: (startIndex + index) * ITEM_HEIGHT, 
                height: ITEM_HEIGHT,
                paddingLeft: `${item.level * 16 + 12}px`
              }}
              onClick={() => {
                if (item.isInfo) return;
                toggleExpand(item.path, item.is_dir);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (item.level === 0 || item.isInfo) return;
                onContextMenu(e, { name: item.name, is_dir: item.is_dir }, item.path.substring(0, item.path.lastIndexOf('/')));
              }}
            >
              {item.isInfo ? (
                <span className="text-[10px] italic opacity-40 py-1 flex items-center gap-2">
                   <div className="w-1 h-1 rounded-full bg-text-secondary" />
                   {item.name}
                </span>
              ) : item.isPlaceholder ? (
                <>
                   <span className="text-text-secondary opacity-70">
                    {item.type === 'file' ? <FileText size={14} /> : <Folder size={14} className="text-accent fill-current" />}
                  </span>
                  <input 
                    autoFocus
                    className="bg-bg-primary text-text-primary px-1 py-0.5 border border-accent/50 rounded outline-none w-full text-[11px]"
                    placeholder={item.type === 'file' ? "name.ext" : "folder name"}
                    onBlur={(e) => onCreationSubmit(item.parentPath, e.target.value, item.type)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCreationSubmit(item.parentPath, e.target.value, item.type);
                      if (e.key === 'Escape') onCreationSubmit(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </>
              ) : renamingPath === item.path ? (
                <input 
                  autoFocus
                  className="bg-bg-primary text-text-primary px-1 py-0.5 border border-accent/50 rounded outline-none w-full text-[11px]"
                  defaultValue={item.name}
                  onBlur={(e) => onRename(item.path, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onRename(item.path, e.target.value);
                    if (e.key === 'Escape') onRename(item.path, item.name);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  {item.is_dir ? (
                    <>
                      {item.level !== 0 && (
                        <span className="text-text-secondary/50 group-hover:text-text-secondary">
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                      )}
                      <Folder size={14} className={`${isExpanded ? 'text-accent' : 'text-text-secondary'} fill-current opacity-70`} />
                    </>
                  ) : (
                    getFileIcon(item.name, 'opacity-80')
                  )}
                  <span className="truncate flex-1">{item.name}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FileTree;
