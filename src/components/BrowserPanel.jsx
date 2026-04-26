import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, Send, Loader2, FileCode, Check, Zap, FilePlus, Settings, Trash2, Key, ChevronDown, History, Terminal as TerminalIcon, Copy, ListTodo, CheckCircle2, Circle } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import ReactMarkdown from 'react-markdown'

const BrowserPanel = ({ onClose, activeFile, onApplyEdits, onCreateFile }) => {
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

  const clearHistory = () => {
    setMessages([]);
    localStorage.removeItem('kite-gemini-history');
    setShowSettings(false);
  };

  const handleSaveApiKey = () => {
    setApiKey(tempApiKey);
    localStorage.setItem('gemini-api-key', tempApiKey);
    setShowSettings(false);
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    if (!apiKey) {
      setShowSettings(true);
      return;
    }

    const text = input.trim();
    setInput('');
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setLoading(true);

    try {
      let prompt = text;
      if (useContext && activeFile) {
        const linesWithNumbers = activeFile.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
        prompt = `[FILE CONTEXT: ${activeFile.name}]\n\`\`\`\n${linesWithNumbers}\n\`\`\`\n\n[USER QUERY]\n${text}`;
      }

      const systemInstruction = mode === 'agent' 
        ? `You are the Kite AI Agent. You are highly proactive and focused on completing tasks. 
You can use terminal commands to explore the project (e.g., 'dir /s /b', 'tree /f', 'cat file'). 
When you suggest a command, it will be executed (automatically if AUTO is set, or via user confirmation). 
The output of the command will be sent back to you automatically.

TASK MANAGEMENT:
If a request requires multiple steps, you MUST return a 'tasks' array.
Format: {"tasks": [{"id": "unique-id", "title": "Do something", "completed": false}]}
When you finish a task, set 'taskCompleted': "id-of-finished-task".
The system will automatically send you the next pending task.

Return your response strictly as a JSON object. 
CRITICAL: All code content in 'replacement', 'content', or 'commands' MUST be properly JSON-escaped. 
For edits: include an 'edits' array with {'file', 'startLine', 'endLine', 'replacement'}. 
The 'file' field is the relative path from the project root. If omitted, the active file is assumed.
For new files: include a 'newFile' object with {'name', 'content'}. 
For terminal commands: include a 'commands' array of strings.
Format: {"reply": "markdown text", "edits": [], "newFile": null, "commands": [], "tasks": [], "taskCompleted": null}`
        : `You are the native Kite AI Assistant. Return your response strictly as a JSON object. 
CRITICAL: All code content in 'replacement', 'content', or 'commands' MUST be properly JSON-escaped. Especially double quotes must be escaped as \\".
For edits: include an 'edits' array with {'startLine', 'endLine', 'replacement'}. 
For new files: include a 'newFile' object with {'name', 'content'}. 
For terminal commands: include a 'commands' array of strings.
Format: {"reply": "markdown text", "edits": [], "newFile": null, "commands": []}`;

      // Trim history based on contextLimit
      const historyToKeep = messages.slice(-contextLimit);

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            ...historyToKeep.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            })),
            { role: 'user', parts: [{ text: prompt }] }
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
          content: parsed.reply,
          edits: parsed.edits || [],
          newFile: parsed.newFile || null,
          commands: parsed.commands || []
        };

        // Autonomous Execution for Agent Mode
        if (mode === 'agent' && !askBeforeDoing) {
          if (assistantMessage.edits.length > 0) {
            onApplyEdits(assistantMessage.edits);
            assistantMessage.applied = true;
          }
          if (assistantMessage.newFile) {
            onCreateFile(assistantMessage.newFile.name, assistantMessage.newFile.content);
            assistantMessage.applied = true;
          }
          if (assistantMessage.commands && assistantMessage.commands.length > 0) {
            for (const cmd of assistantMessage.commands) {
              await runCommand(cmd);
            }
          }

          // Handle Tasks
          if (assistantMessage.tasks && assistantMessage.tasks.length > 0) {
            setTasks(assistantMessage.tasks);
            setShowTasks(true);
            // Trigger first task if in AUTO mode
            if (!askBeforeDoing) {
              const firstTask = assistantMessage.tasks.find(t => !t.completed);
              if (firstTask) {
                setTimeout(() => handleSend(`Proceed with Task: ${firstTask.title}`), 1000);
              }
            }
          }

          if (assistantMessage.taskCompleted) {
            setTasks(prev => {
              const updated = prev.map(t => t.id === assistantMessage.taskCompleted ? { ...t, completed: true } : t);
              // Trigger next task if in AUTO mode
              if (!askBeforeDoing) {
                const nextTask = updated.find(t => !t.completed);
                if (nextTask) {
                  setTimeout(() => handleSend(`Proceed with Task: ${nextTask.title}`), 1000);
                }
              }
              return updated;
            });
          }
        }

        setMessages(prev => [...prev, assistantMessage]);
      } catch (e) {
        setMessages(prev => [...prev, { role: 'assistant', content: responseText }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ API Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

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
  }, [mode, askBeforeDoing]);

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
    } catch (err) {
      console.error("Failed to run command:", err);
      isCapturing.current = false;
    }
  };

  return (
    <div className="browser-panel">
      <div className="browser-header">
        <div className="header-left">
          <Sparkles size={16} className="sparkle-icon" />
          <span>Gemini Assistant</span>
        </div>
        <div className="header-actions">
          <button 
            className={`header-btn ${showTasks ? 'active' : ''}`}
            onClick={() => setShowTasks(!showTasks)}
            title="Task Manager"
          >
            <ListTodo size={16} />
            {tasks.filter(t => !t.completed).length > 0 && (
              <span className="task-badge">{tasks.filter(t => !t.completed).length}</span>
            )}
          </button>
          <button 
            className={`header-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            <Settings size={16} />
          </button>
          <button onClick={onClose} className="header-btn">
            <X size={16} />
          </button>
        </div>
      </div>

      {showTasks && (
        <div className="task-manager-overlay">
          <div className="task-manager-header">
            <span>Project Tasks</span>
            <button onClick={() => setShowTasks(false)}><X size={14} /></button>
          </div>
          <div className="task-list">
            {tasks.length === 0 ? (
              <div className="no-tasks">No active tasks</div>
            ) : (
              tasks.map(task => (
                <div key={task.id} className={`task-item ${task.completed ? 'completed' : ''}`}>
                  {task.completed ? <CheckCircle2 size={14} className="task-icon done" /> : <Circle size={14} className="task-icon" />}
                  <span className="task-title">{task.title}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showSettings && (
        <div className="chat-settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="chat-settings-card" onClick={e => e.stopPropagation()}>
            <div className="chat-settings-header">
              <h4><Settings size={14} /> Chat Settings</h4>
              <button className="close-settings-btn" onClick={() => setShowSettings(false)}>
                <X size={14} />
              </button>
            </div>
            
            <div className="settings-group">
              <label><Key size={12} /> Gemini API Key</label>
              <div className="api-key-input-wrapper">
                <input 
                  type="password" 
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="Paste your API key here..."
                />
              </div>
              <button className="save-api-key-btn" onClick={handleSaveApiKey} disabled={!tempApiKey.trim()}>
                <Check size={14} />
                <span>Save API Key</span>
              </button>
            </div>

            <div className="settings-divider" />

            <div className="settings-group">
              <div className="settings-label-row">
                <label><History size={12} /> Context History</label>
                <span className="settings-value">{contextLimit} messages</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="50" 
                value={contextLimit}
                onChange={(e) => setContextLimit(parseInt(e.target.value))}
                className="settings-slider"
              />
              <p className="settings-hint">Number of previous messages sent to AI</p>
            </div>

            <div className="settings-divider" />

            <button className="clear-history-btn" onClick={clearHistory}>
              <Trash2 size={14} />
              <span>Clear Chat History</span>
            </button>
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="gemini-empty-state">
            <Sparkles size={24} />
            <p>Ask Gemini anything</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message-wrapper ${msg.role}`}>
            <div className="message-content">
              <div className="role-label">{msg.role === 'assistant' ? 'GEMINI' : 'YOU'}</div>
              <div className="text-content markdown-body">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
                
                {msg.edits && msg.edits.length > 0 && (
                  <div className="apply-edits-container">
                    {msg.applied ? (
                      <div className="applied-label">
                        <Check size={12} />
                        <span>Changes applied</span>
                      </div>
                    ) : (
                      <button 
                        className="apply-edits-btn" 
                        onClick={() => {
                          onApplyEdits(msg.edits);
                          setMessages(prev => prev.map((m, idx) => 
                            idx === i ? { ...m, applied: true } : m
                          ));
                        }}
                      >
                        <Zap size={14} />
                        <span>Apply Changes to {activeFile?.name || 'File'}</span>
                      </button>
                    )}
                  </div>
                )}

                {msg.newFile && (
                  <div className="apply-edits-container">
                    {msg.applied ? (
                      <div className="applied-label">
                        <Check size={12} />
                        <span>File created: {msg.newFile.name}</span>
                      </div>
                    ) : (
                      <button 
                        className="apply-edits-btn" 
                        onClick={() => {
                          onCreateFile(msg.newFile.name, msg.newFile.content);
                          setMessages(prev => prev.map((m, idx) => 
                            idx === i ? { ...m, applied: true } : m
                          ));
                        }}
                      >
                        <FilePlus size={14} />
                        <span>Create {msg.newFile.name}</span>
                      </button>
                    )}
                  </div>
                )}
                
                {msg.commands && msg.commands.length > 0 && (
                  <div className="ai-commands-container">
                    <div className="ai-commands-header">
                      <div className="ai-commands-title">
                        <TerminalIcon size={12} />
                        <span>CMD</span>
                      </div>
                      <button 
                        className="header-copy-btn"
                        title="Copy all commands"
                        onClick={() => {
                          const allCmds = msg.commands.join('\n');
                          navigator.clipboard.writeText(allCmds);
                        }}
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                    <div className="ai-commands-list">
                      {msg.commands.map((cmd, idx) => (
                        <div key={idx} className="ai-command-row">
                          <code>{cmd}</code>
                          <div className="command-actions">
                            <button 
                              className="copy-command-btn"
                              title="Copy command"
                              onClick={() => navigator.clipboard.writeText(cmd)}
                            >
                              <Copy size={12} />
                            </button>
                            <button 
                              className="run-command-btn"
                              title="Run in Terminal"
                              onClick={() => runCommand(cmd)}
                            >
                              <Zap size={12} />
                              <span>Run</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="message-wrapper assistant">
            <div className="message-content">
              <div className="role-label">GEMINI</div>
              <div className="typing-indicator"><Loader2 size={14} className="spinning" /><span>Thinking...</span></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>      <div className="chat-input-area">
        <div className="input-context-bar">
          <div className="context-left">
            {activeFile && (
              <div 
                className={`context-chip ${useContext ? 'active' : ''}`}
                onClick={() => setUseContext(!useContext)}
                title={useContext ? "Exclude file from context" : "Include file in context"}
              >
                <FileCode size={12} />
                <span className="context-name">{activeFile.name}</span>
              </div>
            )}
          </div>
          
          {mode === 'agent' && (
            <div className="agent-options">
              <button 
                className={`agent-opt-btn ${askBeforeDoing ? 'active' : ''}`}
                onClick={() => setAskBeforeDoing(true)}
              >
                Ask
              </button>
              <button 
                className={`agent-opt-btn ${!askBeforeDoing ? 'active' : ''}`}
                onClick={() => setAskBeforeDoing(false)}
              >
                Auto
              </button>
            </div>
          )}
        </div>
        
        <div className="unified-input-container">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={mode === 'agent' ? "Tell Agent what to do..." : "Ask Gemini..."}
            rows={1}
            disabled={loading}
          />
          
          <div className="input-toolbar">
            <div className="toolbar-left">
              <div className="mode-toggle">
                <button 
                  className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
                  onClick={() => setMode('chat')}
                >
                  Chat
                </button>
                <button 
                  className={`mode-btn ${mode === 'agent' ? 'active' : ''}`}
                  onClick={() => setMode('agent')}
                >
                  Agent
                </button>
              </div>

              <div className="model-selector-wrapper">
                <select 
                  value={selectedModel} 
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="model-select"
                >
                  {models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <ChevronDown size={10} className="select-icon" />
              </div>
            </div>

            <div className="toolbar-right">
              <button 
                onClick={handleSend} 
                disabled={!input.trim() || loading} 
                className="chat-send-btn"
                title="Send Message"
              >
                {loading ? <Loader2 size={14} className="spinning" /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrowserPanel;
