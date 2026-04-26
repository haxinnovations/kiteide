import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Send, Loader2, FileCode, Check, Zap, FilePlus, Settings, Trash2, Key, ChevronDown, History } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import ReactMarkdown from 'react-markdown'

const BrowserPanel = ({ onClose, activeFile, onApplyEdits, onCreateFile }) => {
  const models = [
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
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
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('gemini-selected-model') || 'gemini-2.0-flash');
  const [contextLimit, setContextLimit] = useState(() => parseInt(localStorage.getItem('gemini-context-limit')) || 10);
  const [showSettings, setShowSettings] = useState(false);
  const [useContext, setUseContext] = useState(true);
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('codepad-gemini-history');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Sync temp key when settings open
  useEffect(() => {
    if (showSettings) setTempApiKey(apiKey);
  }, [showSettings, apiKey]);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem('codepad-gemini-history', JSON.stringify(messages));
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
    localStorage.removeItem('codepad-gemini-history');
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

      const systemInstruction = `You are the native CodePad AI Assistant. Return your response strictly as a JSON object. 
CRITICAL: All code content in 'replacement' or 'content' MUST be properly JSON-escaped. Especially double quotes must be escaped as \\".
For edits: include an 'edits' array with {'startLine', 'endLine', 'replacement'}. 
For new files: include a 'newFile' object with {'name', 'content'}. 
Format: {"reply": "markdown text", "edits": [], "newFile": null}`;

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
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: parsed.reply,
          edits: parsed.edits || [],
          newFile: parsed.newFile || null
        }]);
      } catch (e) {
        setMessages(prev => [...prev, { role: 'assistant', content: responseText }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ API Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="browser-panel">
      <div className="browser-header">
        <div className="browser-header-title">
          <Sparkles size={14} className="browser-icon" />
          <span>Gemini AI</span>
        </div>
        <div className="browser-header-actions">
          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className={`chat-action-btn ${showSettings ? 'active' : ''}`}
            title="Settings"
          >
            <Settings size={14} />
          </button>
          <button onClick={onClose} className="chat-action-btn"><X size={14} /></button>
        </div>
      </div>

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
      </div>

      <div className="chat-input-area">
        <div className="input-controls-row">
          {activeFile && (
            <div className="context-selector-wrapper">
              <div 
                className={`context-chip ${useContext ? 'active' : ''}`}
                onClick={() => setUseContext(!useContext)}
                title={useContext ? "Exclude file from context" : "Include file in context"}
              >
                <FileCode size={12} />
                <span className="context-name">{activeFile.name}</span>
              </div>
            </div>
          )}

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

        <div className="chat-input-wrapper">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask Gemini..."
            rows={1}
            disabled={loading}
          />
          <button onClick={handleSend} disabled={!input.trim() || loading} className="chat-send-btn">
            {loading ? <Loader2 size={14} className="spinning" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BrowserPanel;
