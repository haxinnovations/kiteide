import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const LSP_CONFIGS = {
  html: {
    command: 'node',
    entry: './node_modules/vscode-langservers-extracted/lib/html-language-server/node/htmlServerMain.js',
    id: 'html-lsp'
  },
  css: {
    command: 'node',
    entry: './node_modules/vscode-langservers-extracted/lib/css-language-server/node/cssServerMain.js',
    id: 'css-lsp'
  },
  py: {
    command: 'node',
    entry: './node_modules/pyright/langserver.index.js',
    id: 'python-lsp'
  }
};

export default function LspManager({ activeFile, content, onDiagnostics }) {
  const fileVersionRef = useRef(new Map());
  const runningSpawns = useRef(new Set()); // IDs of servers currently being spawned
  const activeServers = useRef(new Set()); // IDs of servers fully started and listening
  const pendingRequests = useRef(new Map());
  const requestIdCounter = useRef(1);
  const unlisteners = useRef(new Map()); // id -> unlistenFn

  const getExt = (path) => path?.split('.').pop()?.toLowerCase();

  const getUri = (path) => {
    if (!path) return '';
    try {
      const normalizedPath = path.replace(/\\/g, '/');
      const fullPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;
      const uri = new URL('file://' + fullPath).href;
      return decodeURIComponent(uri).toLowerCase();
    } catch {
      return path.toLowerCase();
    }
  };

  const sendLspRequest = useCallback((lspId, method, params) => {
    const id = requestIdCounter.current++;
    return new Promise((resolve, reject) => {
      pendingRequests.current.set(id, { resolve, reject });
      
      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };

      console.log(`[LSP ${lspId}] Request ${id}: ${method}`);
      invoke('write_to_lsp', { id: lspId, message: JSON.stringify(message) })
        .catch(err => {
          pendingRequests.current.delete(id);
          reject(err);
        });
      
      setTimeout(() => {
        if (pendingRequests.current.has(id)) {
          pendingRequests.current.delete(id);
          reject(new Error(`Request ${id} (${method}) timed out`));
        }
      }, 15000); // 15s timeout
    });
  }, []);

  const sendLspNotification = useCallback(async (lspId, method, params) => {
    try {
      console.log(`[LSP ${lspId}] Notify: ${method}`);
      await invoke('write_to_lsp', { id: lspId, message: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params
      }) });
    } catch (err) {
      console.error(`[LSP ${lspId}] Notify error:`, err);
    }
  }, []);

  // Ensure server is running and listening
  const ensureServer = async (config) => {
    if (activeServers.current.has(config.id)) return true;
    if (runningSpawns.current.has(config.id)) {
      // Wait for it to become active
      while (runningSpawns.current.has(config.id) && !activeServers.current.has(config.id)) {
        await new Promise(r => setTimeout(r, 100));
      }
      return activeServers.current.has(config.id);
    }

    runningSpawns.current.add(config.id);
    try {
      console.log(`[LSP] Spawning ${config.id}...`);
      await invoke('spawn_lsp', { 
        id: config.id, 
        command: config.command, 
        args: [config.entry, '--stdio'] 
      });

      const unlisten = await listen(`lsp-message-${config.id}`, (event) => {
        try {
          const data = JSON.parse(event.payload);
          
          if (data.id && pendingRequests.current.has(data.id)) {
            const { resolve } = pendingRequests.current.get(data.id);
            pendingRequests.current.delete(data.id);
            resolve(data.result);
          }

          if (data.method === 'textDocument/publishDiagnostics') {
            onDiagnostics(event.payload);
          }
        } catch (e) {
          console.error(`[LSP ${config.id}] Parse error:`, e);
        }
      });

      unlisteners.current.set(config.id, unlisten);

      // Initialize
      const lastSlash = Math.max(activeFile.lastIndexOf('/'), activeFile.lastIndexOf('\\'));
      const rootDir = lastSlash !== -1 ? activeFile.substring(0, lastSlash) : '.';
      
      await sendLspRequest(config.id, "initialize", {
        processId: null,
        rootPath: rootDir,
        rootUri: getUri(rootDir),
        capabilities: {
          textDocument: {
            synchronization: { 
              dynamicRegistration: true, 
              didSave: true,
              willSave: true
            },
            publishDiagnostics: { 
              relatedInformation: true,
              tagSupport: { valueSet: [1, 2] },
              labelSupport: true
            }
          }
        },
        initializationOptions: {
          embeddedLanguages: { css: true, javascript: true },
          provideFormatter: true,
          settings: {
            html: { 
              validate: true,
              scripts: true,
              styles: true,
              suggest: { html5: true }
            },
            css: { validate: true },
            python: { 
              analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true }
            }
          }
        }
      });

      await sendLspNotification(config.id, "initialized", {});
      
      // Also send configuration after initialized
      await sendLspNotification(config.id, "workspace/didChangeConfiguration", {
        settings: {
          html: { 
            validate: true,
            scripts: true,
            styles: true,
            suggest: { html5: true }
          },
          css: { validate: true },
          python: { 
            analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true }
          }
        }
      });

      activeServers.current.add(config.id);
      return true;
    } catch (err) {
      console.error(`[LSP] Failed to start ${config.id}:`, err);
      return false;
    } finally {
      runningSpawns.current.delete(config.id);
    }
  };

  useEffect(() => {
    if (!activeFile) return;
    const ext = getExt(activeFile);
    const config = LSP_CONFIGS[ext];
    if (!config) return;

    let isEffectMounted = true;

    const run = async () => {
      const ready = await ensureServer(config);
      if (!ready || !isEffectMounted) return;

      const uri = getUri(activeFile);
      const languageIdMap = {
        'htm': 'html',
        'html': 'html',
        'css': 'css',
        'py': 'python'
      };
      const languageId = languageIdMap[ext] || ext;

      // didOpen if version is 0
      if (!fileVersionRef.current.has(uri)) {
        fileVersionRef.current.set(uri, 1);
        await sendLspNotification(config.id, "textDocument/didOpen", {
          textDocument: {
            uri,
            languageId,
            version: 1,
            text: content
          }
        });
      } else {
        // didChange
        const newVersion = fileVersionRef.current.get(uri) + 1;
        fileVersionRef.current.set(uri, newVersion);
        await sendLspNotification(config.id, "textDocument/didChange", {
          textDocument: { uri, version: newVersion },
          contentChanges: [{ text: content }]
        });
      }
    };

    run();

    return () => {
      isEffectMounted = false;
    };
  }, [activeFile, content, sendLspNotification]);

  // Clean up all on unmount
  useEffect(() => {
    return () => {
      unlisteners.current.forEach(u => u());
    };
  }, []);

  return null;
}
