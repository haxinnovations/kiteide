import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, Loader2, FileCode, Check, Zap, FilePlus, Settings, Trash2, Key, ChevronDown, History, Terminal as TerminalIcon, Copy, ListTodo, CheckCircle2, Circle, ArrowUp, Bug, RotateCcw, Square } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import ReactMarkdown from 'react-markdown'

const BrowserPanel = ({ onClose, activeFile, onApplyEdits, onCreateFile, onRefresh, projectDir }) => {
  const models = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-pro-latest',
    'gemini-2.5-pro',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview'
  ];

  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini-api-key') || '');
  const [tempApiKey, setTempApiKey] = useState(apiKey);
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem('gemini-selected-model');
    return (saved && models.includes(saved)) ? saved : 'gemini-2.5-flash';
  });
  const [contextLimit, setContextLimit] = useState(() => parseInt(localStorage.getItem('gemini-context-limit')) || 10);
  const [showSettings, setShowSettings] = useState(false);
  const [useContext, setUseContext] = useState(true);
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('kite-gemini-history');
    return saved ? JSON.parse(saved) : [];
  });
  const [mode, setMode] = useState('chat'); // 'chat' or 'agent'
  const [askBeforeDoing, setAskBeforeDoing] = useState(true);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [showTasks, setShowTasks] = useState(false);
   const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  
  const terminalBuffer = useRef('');
  const isCapturing = useRef(false);
  const captureTimeout = useRef(null);

  // Sync temp key when settings open
  useEffect(() => {
    if (showSettings) setTempApiKey(apiKey);
  }, [showSettings, apiKey]);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem('kite-gemini-history', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('gemini-api-key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('gemini-selected-model', selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem('gemini-context-limit', contextLimit);
  }, [contextLimit]);

  // Scroll to bottom
  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ 
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end'
    });
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => scrollToBottom(), 100);
    return () => clearTimeout(timeoutId);
  }, [messages, loading]);

  useEffect(() => {
    scrollToBottom(false);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      if (!input) {
        textarea.style.height = '100px'; // Increased min-height
      } else {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 400)}px`;
      }
    }
  }, [input]);

  const clearHistory = () => {
    setMessages([]);
    setTasks([]);
    setShowTasks(false);
    localStorage.removeItem('kite-gemini-history');
    setShowSettings(false);
  };

  const handleSaveApiKey = () => {
    setApiKey(tempApiKey);
    localStorage.setItem('gemini-api-key', tempApiKey);
    setShowSettings(false);
  };

  const handleRetry = useCallback(() => {
    if (messages.length === 0 || loading) return;
    
    // Find last assistant message
    const lastAssistantIdx = [...messages].reverse().findIndex(m => m.role === 'assistant');
    if (lastAssistantIdx === -1) return;
    
    const actualIdx = messages.length - 1 - lastAssistantIdx;
    const historyBeforeAssistant = messages.slice(0, actualIdx);
    const lastUserMessage = historyBeforeAssistant[historyBeforeAssistant.length - 1];
    
    if (!lastUserMessage || lastUserMessage.role !== 'user') return;

    // Remove assistant message and its triggering user message
    // handleSend will re-add the user message
    const baseHistory = historyBeforeAssistant.slice(0, -1);
    setMessages(baseHistory);
    
    // Use a small timeout to ensure state has updated or handleSend uses the right base
    setTimeout(() => {
      handleSend(lastUserMessage.content, baseHistory, 0);
    }, 0);
  }, [messages, loading]);

  const handleSend = useCallback(async (manualPrompt, overrideHistory = null, retryCount = 0) => {
    if (!apiKey) {
      setShowSettings(true);
      return;
    }

    let newMessages = overrideHistory || [...messages];
    let text;
    if (manualPrompt) {
      const msgObj = typeof manualPrompt === 'string' 
        ? { role: 'user', content: manualPrompt }
        : { role: 'user', ...manualPrompt };
      newMessages.push(msgObj);
      text = msgObj.content;
      if (typeof manualPrompt !== 'object') setInput('');
    } else if (!overrideHistory) {
      // Direct user input from the text field
      text = input.trim();
      if (!text || loading) return;
      newMessages.push({ role: 'user', content: text });
      setInput('');
    } else {
      // Background process or retry - use the last message in history
      text = newMessages[newMessages.length - 1]?.content || "";
    }

    if (!text && !overrideHistory) return;
    
    setMessages(newMessages);
    
    // Abort existing request if any
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      let prompt = text;
      if (useContext && activeFile) {
        const linesWithNumbers = activeFile.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
        prompt = `[FILE CONTEXT: ${activeFile.name}]\n\`\`\`\n${linesWithNumbers}\n\`\`\`\n\n[USER QUERY]\n${text}`;
      }

      const systemInstruction = mode === 'agent' 
        ? `You are the Kite AI Agent. You are highly proactive and focused on completing complex workflows.

PROJECT ENVIRONMENT:
- Active Directory: ${projectDir || 'Not specified'}
- All file paths (listFiles, readFile, edits) should be relative to this directory unless absolute.
- DIRECTORY CREATION: If you want to create a file in a directory that does not exist, you MUST first create that folder using a terminal command (e.g., "mkdir -p src/components").
- FILE EXISTENCE: Before creating a new file, you MUST check if the file or its parent directory already exists using 'listFiles' if that information is not already in the conversation context. Do not overwrite files blindly.
- TASK ORDER: You MUST follow the roadmap tasks in strict sequential order. Finish existing incomplete tasks before starting any new tasks you've added. Never skip a task. Even if you want to perform multiple tasks at once, you must mark them as completed in order.

TOOL PRIORITIZATION:
1. PRIMARY (Code Changes): Use the 'edits' array and 'newFile' object for all file creation and modifications. This is safer and more reliable than terminal commands.
2. SECONDARY (Environment): Use 'commands' ONLY for terminal-based tasks like listing directories (dir, ls), installing packages (npm install), running code, or checking git status.

ROADMAP & TASK MANAGEMENT:
- If a request involves multiple steps, provide a 'tasks' array to build or EXTEND the Roadmap.
- Format: {"tasks": [{"id": "id-1", "title": "Analyze project", "completed": false}, ...]}
- Tasks are ADDED to the existing list if their ID is new. Do not repeat existing tasks unless you want to update them.
- As you complete each step, return 'taskCompleted': "id-of-step" in your response.
- The system will automatically prompt you with: "Proceed with Task: [Title]" once a task is completed.

Return your response strictly as a JSON object. 
CRITICAL: All code content in 'replacement', 'content', or 'commands' MUST be properly JSON-escaped. 
For edits: include an 'edits' array with {'file', 'startLine', 'endLine', 'replacement'}. 
For new files: include a 'newFile' object with {'name', 'content'}. 
For listing files: include a 'listFiles' string (the path to list).
- For reading files: include a 'readFile' string (the path to read).
- For viewing tasks: include a 'viewTasks' boolean (set to true to see the roadmap).
- For terminal commands: include a 'commands' array of strings.
Format: {"reply": "markdown text", "edits": [], "newFile": null, "listFiles": null, "readFile": null, "viewTasks": false, "commands": [], "tasks": [], "taskCompleted": null}`
        : `You are the native Kite AI Assistant. Return your response strictly as a JSON object. 
PROJECT ENVIRONMENT:
- Active Directory: ${projectDir || 'Not specified'}
- DIRECTORY CREATION: If you want to create a file in a directory that does not exist, you MUST first create that folder using a terminal command (e.g., "mkdir -p src/components").
- FILE EXISTENCE: Before creating a new file, you MUST check if it already exists using 'listFiles' if the directory context is not already present in the chat.
CRITICAL: All code content in 'replacement', 'content', or 'commands' MUST be properly JSON-escaped. Especially double quotes must be escaped as \\".
- For edits: include an 'edits' array with {'startLine', 'endLine', 'replacement'}. 
- For new files: include a 'newFile' object with {'name', 'content'}. 
For terminal commands: include a 'commands' array of strings.
Format: {"reply": "markdown text", "edits": [], "newFile": null, "listFiles": null, "readFile": null, "commands": []}`;

      // Trim history based on contextLimit (excluding the current prompt which is added manually)
      const historyToKeep = newMessages.slice(0, -1).slice(-contextLimit);

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            ...historyToKeep.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content || " " }]
            })),
            { role: 'user', parts: [{ text: prompt || " " }] }
          ],
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            response_mime_type: "application/json"
          }
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'API request failed');

      let responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      try {
        let jsonCandidate = responseText.trim();
        const firstBrace = jsonCandidate.indexOf('{');
        const lastBrace = jsonCandidate.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonCandidate = jsonCandidate.substring(firstBrace, lastBrace + 1);
        }

        let parsed = JSON.parse(jsonCandidate);
        const assistantMessage = { 
          role: 'assistant', 
          content: parsed.reply || "",
          edits: Array.isArray(parsed.edits) ? parsed.edits : [],
          newFile: parsed.newFile || null,
          commands: Array.isArray(parsed.commands) ? parsed.commands : [],
          listFiles: parsed.listFiles || null,
          readFile: parsed.readFile || null,
          viewTasks: parsed.viewTasks || false,
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          taskCompleted: parsed.taskCompleted || null,
          raw: jsonCandidate
        };

        // 1. Unified Task (Roadmap) Management - Only in Agent Mode
        let updatedTasks = [...tasks];
        if (mode === 'agent' && (assistantMessage.tasks.length > 0 || assistantMessage.taskCompleted)) {
          // Calculate the new state locally for immediate tool use
          let newTasks = [...tasks];
          if (assistantMessage.tasks.length > 0) {
            const currentMaxOrder = newTasks.length > 0 ? Math.max(...newTasks.map(t => t.order || 0)) : 0;
            assistantMessage.tasks.forEach((task, idx) => {
              const existingIdx = newTasks.findIndex(t => t.id === task.id);
              if (existingIdx !== -1) {
                newTasks[existingIdx] = { ...newTasks[existingIdx], ...task };
              } else {
                newTasks.push({ ...task, order: task.order !== undefined ? task.order : (currentMaxOrder + idx + 1) });
              }
            });
            setShowTasks(true);
          }
          if (assistantMessage.taskCompleted) {
            const target = assistantMessage.taskCompleted.toString().toLowerCase().trim();
            newTasks = newTasks.map(t => {
              const idMatch = t.id?.toString().toLowerCase().trim() === target;
              const titleMatch = t.title?.toLowerCase().trim() === target;
              return (idMatch || titleMatch) ? { ...t, completed: true } : t;
            });
          }
          newTasks.sort((a, b) => (a.order || 0) - (b.order || 0));
          updatedTasks = newTasks;
          setTasks(newTasks);
        }

        // 2. Mode-Specific Execution
        if (mode === 'agent') {
          const toolResults = [];
          
          const resolvePath = (p) => {
            if (!p) return projectDir;
            if (p.startsWith('/') || p.includes(':')) return p;
            if (p === '.' || p === './') return projectDir;
            const base = (projectDir || '').replace(/[\\/]$/, '');
            const sub = (p || '').replace(/^[\\/]/, '');
            return `${base}/${sub}`;
          };

          if (assistantMessage.listFiles) {
            try {
              const resolvedDir = resolvePath(assistantMessage.listFiles);
              const results = await invoke('list_files', { dir: resolvedDir });
              const summary = (results || []).map(f => `${f.is_dir ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
              toolResults.push(`### Directory contents of ${assistantMessage.listFiles}:\n${summary || '(Empty directory)'}`);
            } catch (err) {
              toolResults.push(`Error listing directory ${assistantMessage.listFiles}: ${err.message}`);
            }
          }

          if (assistantMessage.readFile) {
            try {
              const resolvedPath = resolvePath(assistantMessage.readFile);
              const lastSlash = Math.max(resolvedPath.lastIndexOf('/'), resolvedPath.lastIndexOf('\\'));
              const dir = lastSlash !== -1 ? resolvedPath.substring(0, lastSlash) : '.';
              const name = lastSlash !== -1 ? resolvedPath.substring(lastSlash + 1) : resolvedPath;
              const content = await invoke('read_file', { dir, name });
              const lines = content.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
              toolResults.push(`### Contents of ${assistantMessage.readFile}:\n\`\`\`\n${lines}\n\`\`\``);
            } catch (err) {
              toolResults.push(`Error reading file ${assistantMessage.readFile}: ${err.message}`);
            }
          }

          if (assistantMessage.viewTasks) {
            const summary = updatedTasks.map(t => `[${t.completed ? 'DONE' : 'PENDING'}] #${t.order || 0} ${t.title}`).join('\n');
            toolResults.push(`### Current Project Roadmap:\n${summary || 'No tasks defined yet.'}`);
          }

          if (!askBeforeDoing) {
            if (assistantMessage.edits.length > 0) onApplyEdits(assistantMessage.edits);
            if (assistantMessage.newFile) onCreateFile(assistantMessage.newFile.name, assistantMessage.newFile.content);
            if (assistantMessage.commands.length > 0) {
              for (const cmd of assistantMessage.commands) await runCommand(cmd);
            }
            assistantMessage.applied = true;
          }

          const finalMessages = [...newMessages, assistantMessage];
          setMessages(finalMessages);

          if (toolResults.length > 0) {
            const feedback = toolResults.join('\n\n---\n\n');
            const files = toolResults
              .filter(r => r.includes('### Contents of'))
              .map(r => r.match(/### Contents of (.*?):/)?.[1])
              .filter(Boolean);
            
            const dirs = toolResults
              .filter(r => r.includes('### Directory contents of'))
              .map(r => r.match(/### Directory contents of (.*?):/)?.[1])
              .filter(Boolean);

            setTimeout(() => handleSend({ 
              content: feedback, 
              isToolOutput: true, 
              viewedFiles: files,
              viewedDirs: dirs
            }, finalMessages, 0), 500);
          } else if (!askBeforeDoing && assistantMessage.commands.length === 0) {
            const currentTasks = [...(assistantMessage.tasks.length > 0 ? assistantMessage.tasks : tasks)].sort((a, b) => (a.order || 0) - (b.order || 0));
            const nextTask = currentTasks.find(t => !t.completed && t.id !== assistantMessage.taskCompleted && t.title !== assistantMessage.taskCompleted);
            
            if (nextTask) {
              const nextIdx = currentTasks.findIndex(t => t.id === nextTask.id);
              const pendingBefore = currentTasks.slice(0, nextIdx).filter(t => !t.completed && t.id !== assistantMessage.taskCompleted);
              
              let feedbackPrompt = `Proceed with Task: ${nextTask.title}`;
              if (pendingBefore.length > 0) {
                const pendingList = pendingBefore.map(t => `- ${t.title}`).join('\n');
                feedbackPrompt = `PENDING PREVIOUS TASKS:\n${pendingList}\n\nNext Task: ${nextTask.title}`;
              }
              setTimeout(() => handleSend(feedbackPrompt, finalMessages, 0), 1000);
            }
          }
        } else {
          setMessages(prev => [...prev, assistantMessage]);
        }
      } catch (e) {
        console.error('JSON Parse/Tool Execution Error:', e);
        if (retryCount < 1) {
          console.log('Retrying due to parse error (Attempt 1)...');
          const feedbackMessages = [...newMessages, 
            { role: 'assistant', content: responseText }, 
            { role: 'user', content: "Your last response was not a valid JSON. Please repeat your response strictly as a JSON object." }
          ];
          setTimeout(() => handleSend(null, feedbackMessages, retryCount + 1), 500);
        } else {
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            content: "⚠️ **invalid agent response**",
            raw: responseText
          }]);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Generation stopped by user');
      } else {
        console.error('API Error:', err);
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ API Error: ${err.message}` }]);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, loading, apiKey, messages, useContext, activeFile, mode, selectedModel, contextLimit, askBeforeDoing, onApplyEdits, onCreateFile, tasks]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
    }
  }, []);

  // ANSI Stripper
  const stripAnsi = (str) => {
    const pattern = [
      '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~]*)*)?\\u0007)',
      '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
    ].join('|');
    return str.replace(new RegExp(pattern, 'g'), '');
  };

  const handleCommandFeedback = useCallback((output) => {
    if (!isCapturing.current) return;
    
    terminalBuffer.current += stripAnsi(output);
    
    if (captureTimeout.current) clearTimeout(captureTimeout.current);
    captureTimeout.current = setTimeout(() => {
      if (terminalBuffer.current.trim()) {
        const feedback = terminalBuffer.current.trim();
        terminalBuffer.current = '';
        isCapturing.current = false;
        
        // Automatically send feedback to Gemini
        handleSend(`[TERMINAL_OUTPUT]\n${feedback}`);
      }
    }, 1500); // Wait for 1.5s of silence
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSend]);

  useEffect(() => {
    const unlisten = listen('terminal-output-default', (event) => {
      handleCommandFeedback(event.payload);
    });
    return () => {
      unlisten.then(u => u());
    };
  }, [handleCommandFeedback]);

  const runCommand = async (cmd) => {
    try {
      isCapturing.current = true;
      terminalBuffer.current = '';
      // On Windows PowerShell, \r is often more reliable than \n
      await invoke('write_to_terminal', { id: 'default', data: cmd + '\r' });
      
      // Trigger a refresh of the file explorer since the command might have changed the FS
      if (onRefresh) {
        // We wait a bit because terminal execution is async in the shell
        setTimeout(() => onRefresh(), 300);
        setTimeout(() => onRefresh(), 1000); // Second refresh for slower operations
      }
    } catch (err) {
      console.error("Failed to run command:", err);
      isCapturing.current = false;
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary relative overflow-hidden border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 border-b border-border bg-bg-primary h-10 flex-shrink-0">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-xs">
          <Sparkles size={14} className="text-accent" />
          <span>Gemini Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            className={`p-1.5 rounded-custom hover:bg-bg-secondary transition-colors relative ${showTasks ? 'bg-bg-secondary text-accent' : 'text-text-secondary'}`}
            onClick={() => setShowTasks(!showTasks)}
            title="Task Manager"
          >
            <ListTodo size={14} />
            {tasks.filter(t => !t.completed).length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-accent text-white text-[8px] font-bold px-1 rounded-full min-w-[12px] h-[12px] flex items-center justify-center border border-bg-primary">
                {tasks.filter(t => !t.completed).length}
              </span>
            )}
          </button>
          <button 
            className={`p-1.5 rounded-custom hover:bg-bg-secondary transition-colors ${showSettings ? 'bg-bg-secondary text-accent' : 'text-text-secondary'}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            <Settings size={14} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-custom hover:bg-bg-secondary text-text-secondary transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>



      {/* Settings Overlay */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/5 backdrop-blur-[1px] z-50 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-bg-primary w-full max-w-[280px] rounded-lg border border-border shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-border flex justify-between items-center bg-bg-secondary">
              <h4 className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <Settings size={14} /> Chat Settings
              </h4>
              <button className="text-text-secondary hover:text-accent transition-colors" onClick={() => setShowSettings(false)}>
                <X size={14} />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                  <Key size={12} /> Gemini API Key
                </label>
                <div className="space-y-2">
                  <input 
                    type="password"
                    value={tempApiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                    placeholder="Paste your key here..."
                    className="w-full px-3 py-2 text-xs bg-bg-secondary border border-border rounded-custom focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button onClick={handleSaveApiKey} className="w-full bg-accent text-white px-3 py-2 rounded-custom text-xs font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-sm">
                    <Check size={14} /> Save API Key
                  </button>
                </div>
              </div>

              <div className="h-[1px] bg-border/50" />

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="flex items-center gap-2 text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                    <History size={12} /> Context
                  </label>
                  <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">{contextLimit} msgs</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="50" 
                  value={contextLimit}
                  onChange={(e) => setContextLimit(parseInt(e.target.value))}
                  className="w-full accent-accent h-1.5 bg-bg-secondary rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-[10px] text-text-secondary italic">Number of previous messages sent to AI</p>
              </div>

              <div className="h-[1px] bg-border/50" />

              <button 
                onClick={clearHistory}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-custom transition-colors border border-transparent hover:border-red-100"
              >
                <Trash2 size={14} />
                Clear Chat History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Roadmap / Tasks */}
      {showTasks && tasks.length > 0 && (
        <div className="bg-bg-secondary/30 border-b border-border/10">
          <div className="max-w-3xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ListTodo size={16} className="text-accent" strokeWidth={2.5} />
                <h3 className="text-[11px] font-black uppercase tracking-widest text-text-primary/70">Project Roadmap</h3>
                <span className="ml-2 text-[9px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                  {tasks.filter(t => t.completed).length} / {tasks.length} DONE
                </span>
              </div>
              <button 
                onClick={() => setShowTasks(false)}
                className="p-1 hover:bg-bg-secondary rounded-lg transition-colors text-text-secondary"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 py-1 group">
                  <div className="flex-shrink-0">
                    {task.completed ? (
                      <CheckCircle2 size={16} className="text-green-500" />
                    ) : (
                      <Circle size={16} className="text-text-secondary/30" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[10px] font-black font-mono text-accent/40 w-6">#{task.order || 0}</span>
                    <span className={`text-[12.5px] truncate ${task.completed ? 'text-text-secondary line-through opacity-50' : 'text-text-primary font-medium'}`}>
                      {task.title}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-0 scroll-smooth custom-scrollbar cursor-default">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-30 py-12 px-6">
            <Sparkles size={48} className="mb-4 text-accent animate-pulse" />
            <h3 className="text-sm font-bold mb-1 tracking-tight">Kite AI Assistant</h3>
            <p className="text-[11px] max-w-[180px] leading-relaxed">Ask questions about your code or let the Agent build features for you.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`group py-4 px-6 ${msg.role === 'user' ? 'bg-bg-secondary/40 border-y border-border/10' : ''} animate-in fade-in slide-in-from-bottom-1 duration-300`}>
            <div className="max-w-3xl mx-auto">
              <div className="prose prose-sm max-w-none text-[13.5px] leading-relaxed text-text-primary prose-p:my-1 prose-pre:bg-bg-secondary prose-pre:text-text-primary prose-code:text-accent relative cursor-text">
                {msg.isToolOutput && (msg.viewedFiles?.length > 0 || msg.viewedDirs?.length > 0) ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {msg.viewedDirs?.map((dir, idx) => (
                        <div key={`dir-${idx}`} className="flex items-center gap-2 bg-purple-500/5 border border-purple-500/10 px-3 py-1.5 rounded-lg text-purple-500 text-[11px] font-black uppercase tracking-wider animate-pulse">
                          <History size={13} />
                          <span>Exploring: {dir === '.' ? 'Project Structure' : dir}</span>
                        </div>
                      ))}
                      {msg.viewedFiles?.map((file, idx) => (
                        <div key={`file-${idx}`} className="flex items-center gap-2 bg-accent/5 border border-accent/10 px-3 py-1.5 rounded-lg text-accent text-[11px] font-black uppercase tracking-wider animate-pulse">
                          <FileCode size={13} />
                          <span>Analyzing: {file}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-[11px] text-text-secondary/60 italic font-medium">
                      <ReactMarkdown>
                        {msg.content.split('\n\n---\n\n')
                          .filter(p => !p.includes('### Contents of') && !p.includes('### Directory contents of'))
                          .join('\n\n---\n\n')}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                )}

                
                {/* Tools Usage Indicator */}
                {msg.role === 'assistant' && (msg.edits?.length > 0 || msg.newFile || msg.commands?.length > 0 || msg.listFiles || msg.readFile) && (
                  <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap gap-2">
                    {msg.edits?.length > 0 && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10 text-blue-500 text-[9px] font-bold uppercase tracking-wider">
                        <Zap size={10} /> {msg.edits.length} Edits
                      </div>
                    )}
                    {msg.newFile && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 text-[9px] font-bold uppercase tracking-wider">
                        <FilePlus size={10} /> Create: {msg.newFile.name}
                      </div>
                    )}
                    {msg.listFiles && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-500/10 text-purple-500 text-[9px] font-bold uppercase tracking-wider">
                        <History size={10} /> List: {msg.listFiles}
                      </div>
                    )}
                    {msg.readFile && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-500/10 text-orange-500 text-[9px] font-bold uppercase tracking-wider">
                        <FileCode size={10} /> Read: {msg.readFile}
                      </div>
                    )}
                    {msg.commands?.length > 0 && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-500/10 text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                        <TerminalIcon size={10} /> {msg.commands.length} Commands
                      </div>
                    )}
                  </div>
                )}

                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => handleRetry()}
                      className="p-1 hover:bg-bg-secondary rounded transition-colors text-text-secondary hover:text-accent"
                      title="Retry Response"
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button 
                      onClick={() => {
                        setMessages(prev => prev.map((m, idx) => idx === i ? { ...m, showRaw: !m.showRaw } : m));
                      }}
                      className={`p-1 hover:bg-bg-secondary rounded transition-colors ${msg.showRaw ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-red-400'}`}
                      title="View Raw JSON"
                    >
                      <Bug size={12} />
                    </button>
                  </div>
                )}
              </div>

              {msg.showRaw && (
                <div className="mt-2 p-3 bg-bg-secondary rounded-lg border border-border/50 font-mono text-[10px] overflow-x-auto text-text-secondary max-h-[300px] animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex justify-between items-center mb-2 pb-1 border-b border-border/30">
                    <span className="font-bold uppercase tracking-widest text-[9px]">Raw AI Output</span>
                    <button onClick={() => {
                      setMessages(prev => prev.map((m, idx) => idx === i ? { ...m, showRaw: false } : m));
                    }} className="hover:text-accent">
                      <X size={10} />
                    </button>
                  </div>
                  <pre>{JSON.stringify(JSON.parse(msg.raw), null, 2)}</pre>
                </div>
              )}

                {/* Edit Actions */}
                {msg.edits && msg.edits.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/30 max-w-md">
                    {msg.applied ? (
                      <div className="flex items-center gap-1.5 text-green-600 text-[11px] font-bold py-1">
                        <Check size={14} /> <span>Changes applied successfully</span>
                      </div>
                    ) : (
                      <button 
                        className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-xl text-[12px] font-bold shadow-md hover:opacity-90 active:scale-95 transition-all w-full justify-center group"
                        onClick={() => {
                          onApplyEdits(msg.edits);
                          setMessages(prev => prev.map((m, idx) => idx === i ? { ...m, applied: true } : m));
                        }}
                      >
                        <Zap size={14} className="group-hover:animate-pulse" />
                        <span>
                          Apply Changes to {
                            [...new Set(msg.edits.map(e => e.file || activeFile?.name))].join(', ') || 'File'
                          }
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {msg.newFile && (
                  <div className="mt-4 pt-4 border-t border-border/30 max-w-md">
                    {msg.applied ? (
                      <div className="flex items-center gap-1.5 text-green-600 text-[11px] font-bold py-1">
                        <Check size={14} /> <span>File created: {msg.newFile.name}</span>
                      </div>
                    ) : (
                      <button 
                        className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-xl text-[12px] font-bold shadow-md hover:opacity-90 active:scale-95 transition-all w-full justify-center group"
                        onClick={() => {
                          onCreateFile(msg.newFile.name, msg.newFile.content);
                          setMessages(prev => prev.map((m, idx) => idx === i ? { ...m, applied: true } : m));
                        }}
                      >
                        <FilePlus size={14} className="group-hover:scale-110 transition-transform" />
                        <span>Create {msg.newFile.name}</span>
                      </button>
                    )}
                  </div>
                )}
                
                {/* Commands */}
                {msg.commands && msg.commands.length > 0 && msg.commands.map((cmd, idx) => (
                  <div key={idx} className="mt-4 bg-bg-secondary/30 rounded-xl border border-border/50 overflow-hidden max-w-md">
                    <div className="px-4 py-2 bg-bg-secondary/50 border-b border-border/50 flex justify-between items-center">
                      <div className="flex items-center gap-2 text-[9px] font-black text-text-secondary/60 tracking-[0.2em] uppercase">
                        <TerminalIcon size={12} strokeWidth={2.5} />
                        <span>CMD</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          className="p-1.5 text-text-secondary/40 hover:text-accent rounded-lg hover:bg-white/50 transition-all"
                          onClick={() => navigator.clipboard.writeText(cmd)}
                          title="Copy Command"
                        >
                          <Copy size={11} />
                        </button>
                        <button 
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-accent text-white rounded-lg hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent/10"
                          onClick={() => typeof runCommand !== 'undefined' ? runCommand(cmd) : console.warn('runCommand not defined')}
                          title="Run in Terminal"
                        >
                          <Zap size={11} />
                          <span className="text-[10px] font-black uppercase tracking-wider">Run</span>
                        </button>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <code className="text-[12px] font-mono text-text-primary/80 break-all leading-relaxed">{cmd}</code>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
        {loading && (
          <div className="py-6 px-6 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className="max-w-3xl mx-auto flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 bg-accent/40 rounded-full animate-pulse"></span>
                <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-pulse [animation-delay:200ms]"></span>
                <span className="w-1.5 h-1.5 bg-accent/40 rounded-full animate-pulse [animation-delay:400ms]"></span>
              </div>
              <span className="text-[10px] font-black text-accent/50 uppercase tracking-[0.3em] animate-pulse">Thinking</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-6 pb-6 pt-4 border-t-2 border-border/20 bg-bg-primary">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* Header Controls */}
          <div className="flex items-center justify-between px-0 h-6">
            <div className="flex items-center gap-2">
              {activeFile && (
                <button 
                  onClick={() => setUseContext(!useContext)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-bold transition-all border ${
                    useContext 
                      ? 'bg-accent/5 border-accent/10 text-accent' 
                      : 'bg-transparent border-transparent text-text-secondary/40 hover:text-text-secondary'
                  }`}
                >
                  <FileCode size={10} />
                  <span className="max-w-[100px] truncate">{activeFile.name}</span>
                </button>
              )}
            </div>

            {mode === 'agent' && (
              <div className="flex bg-bg-secondary/30 p-0.5 rounded-lg border border-border/50 overflow-hidden">
                <button 
                  className={`px-3 py-1 text-[9px] font-black tracking-wider rounded-md transition-all ${askBeforeDoing ? 'bg-white text-accent shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                  onClick={() => setAskBeforeDoing(true)}
                >
                  ASK
                </button>
                <button 
                  className={`px-3 py-1 text-[9px] font-black tracking-wider rounded-md transition-all ${!askBeforeDoing ? 'bg-white text-accent shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                  onClick={() => setAskBeforeDoing(false)}
                >
                  AUTO
                </button>
              </div>
            )}
          </div>

          {/* Integrated Input Area */}
          <div className="relative border-y border-border/20 group">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={mode === 'agent' ? "How can I help you build today?" : "Ask Gemini anything..."}
              className="w-full bg-transparent px-0 py-5 pr-12 text-[14px] leading-relaxed focus:outline-none resize-none min-h-[100px] max-h-[400px] placeholder:text-text-secondary/30 text-text-primary custom-scrollbar cursor-text"
              rows={1}
              disabled={loading}
            />
            
            <div className="absolute right-0 bottom-5 flex items-center gap-2">
              {loading && (
                <button 
                  onClick={stopGeneration}
                  className="p-2 rounded-xl text-white bg-red-500 shadow-lg shadow-red-500/20 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
                  title="Stop Generating"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              )}
              <button 
                onClick={() => handleSend()} 
                disabled={!input.trim() || loading} 
                className={`p-2 rounded-xl transition-all duration-300 flex items-center justify-center ${
                  !input.trim() || loading 
                    ? 'text-text-secondary/20 bg-transparent' 
                    : 'text-white bg-accent shadow-lg shadow-accent/20 hover:scale-105 active:scale-95'
                }`}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.5} />}
              </button>
            </div>
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-between px-0">
            <div className="flex bg-bg-secondary/30 p-0.5 rounded-lg border border-border/50 overflow-hidden">
              <button 
                className={`px-3 py-1 text-[9px] font-black tracking-wider rounded-md transition-all ${mode === 'chat' ? 'bg-white text-accent shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                onClick={() => setMode('chat')}
              >
                CHAT
              </button>
              <button 
                className={`px-3 py-1 text-[9px] font-black tracking-wider rounded-md transition-all ${mode === 'agent' ? 'bg-white text-accent shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                onClick={() => setMode('agent')}
              >
                AGENT
              </button>
            </div>

            <div className="relative group/model">
              <select 
                value={selectedModel} 
                onChange={(e) => setSelectedModel(e.target.value)}
                className="appearance-none bg-transparent pl-5 pr-4 py-1 text-[10px] font-bold text-text-secondary cursor-pointer hover:text-accent transition-colors focus:outline-none"
              >
                {models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <Sparkles size={10} className="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-none" />
              <ChevronDown size={10} className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrowserPanel;
