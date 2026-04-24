import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Send, LogIn, Loader2, ExternalLink, FileCode, Check, Zap } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import ReactMarkdown from 'react-markdown'

const GEMINI_URL = 'https://gemini.google.com/';

const BrowserPanel = ({ onClose, activeFile, onApplyEdits }) => {
  const [loggedIn, setLoggedIn] = useState(() => localStorage.getItem('gemini-logged-in') === 'true');
  const [useContext, setUseContext] = useState(true);
  const [showWebview, setShowWebview] = useState(false);
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('codepad-gemini-history');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const viewportRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Save messages to localStorage
  useEffect(() => {
    localStorage.setItem('codepad-gemini-history', JSON.stringify(messages));
  }, [messages]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Boot Gemini offscreen on mount (if logged in)
  useEffect(() => {
    if (loggedIn) {
      invoke('open_browser', {
        url: GEMINI_URL,
        x: -9999, y: -9999,
        width: 1024, height: 768
      }).catch(console.error);
    }
    return () => {
      invoke('hide_browser').catch(console.error);
    };
  }, [loggedIn]);

  // Show webview for login
  const handleShowLogin = async () => {
    setShowWebview(true);
    // Wait for the viewport to render
    setTimeout(async () => {
      if (viewportRef.current) {
        const rect = viewportRef.current.getBoundingClientRect();
        await invoke('open_browser', {
          url: GEMINI_URL,
          x: rect.left, y: rect.top,
          width: rect.width, height: rect.height
        });
      }
    }, 100);
  };

  // Resize webview with container  
  useEffect(() => {
    if (!showWebview || !viewportRef.current) return;
    const observer = new ResizeObserver(() => {
      if (!viewportRef.current) return;
      const rect = viewportRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        invoke('resize_browser', {
          x: rect.left, y: rect.top,
          width: rect.width, height: rect.height
        }).catch(console.error);
      }
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [showWebview]);

  const handleLoginDone = async () => {
    setLoggedIn(true);
    setShowWebview(false);
    localStorage.setItem('gemini-logged-in', 'true');
    // Move webview offscreen
    await invoke('hide_browser').catch(console.error);
    // Boot it offscreen for background use
    await invoke('open_browser', {
      url: GEMINI_URL,
      x: -9999, y: -9999,
      width: 1024, height: 768
    }).catch(console.error);
  };

  const pollIntervalRef = useRef(null);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      // Get baseline response count before sending
      let baselineCount = 0;
      try {
        const preData = await invoke('read_gemini_response');
        if (preData) {
          const parts = preData.split(':');
          baselineCount = parseInt(parts[0]) || 0;
        }
      } catch(e) {}

      // Prepare context
      let messageToSend = text;
      if (useContext && activeFile) {
        // Prepend line numbers to the code so Gemini can reference them accurately
        const linesWithNumbers = activeFile.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
        messageToSend = `[FILE CONTEXT: ${activeFile.name}]\n\`\`\`\n${linesWithNumbers}\n\`\`\`\n\n[USER QUERY]\n${text}`;
      }

      // Append System Prompt to force JSON output without newlines
      const systemPrompt = ` | [SYSTEM INSTRUCTION: You are the native CodePad AI Assistant. Return your response strictly as a JSON object. If you suggest code changes, include an 'edits' array with objects containing 'startLine', 'endLine', and 'replacement' content. Format: {"reply": "markdown response", "edits": [{"startLine": 10, "endLine": 15, "replacement": "new code"}]}]`;
      await invoke('send_to_gemini', { message: messageToSend + systemPrompt });

      // Poll for new response
      let attempts = 0;
      const maxAttempts = 150; // Increased to ~2 minutes for longer JSON generations
      let lastText = '';

      const poll = async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(pollIntervalRef.current);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '⏱️ Response timed out or was invalid. Here is the raw output:\n\n' + lastText
          }]);
          setLoading(false);
          return;
        }

        try {
          const data = await invoke('read_gemini_response');
          if (!data) return;

          // Format: count:done:base64payload
          const colonIdx1 = data.indexOf(':');
          const colonIdx2 = data.indexOf(':', colonIdx1 + 1);
          if (colonIdx1 === -1 || colonIdx2 === -1) return;

          const count = parseInt(data.substring(0, colonIdx1));
          const payload = data.substring(colonIdx2 + 1);

          if (count > baselineCount && payload) {
            // Decode base64 → UTF-8 text
            let decoded = '';
            try {
              decoded = decodeURIComponent(escape(atob(payload)));
            } catch(e) {
              decoded = atob(payload);
            }

            if (decoded && decoded.trim()) {
              lastText = decoded.trim();

              // Robust JSON extraction: Find the first '{' and last '}'
              let jsonCandidate = lastText;
              const firstBrace = jsonCandidate.indexOf('{');
              const lastBrace = jsonCandidate.lastIndexOf('}');
              
              if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                jsonCandidate = jsonCandidate.substring(firstBrace, lastBrace + 1);
              }
 
              try {
                const parsed = JSON.parse(jsonCandidate);
                if (parsed && parsed.reply) {
                  clearInterval(pollIntervalRef.current);
                  setMessages(prev => [...prev, { 
                    role: 'assistant', 
                    content: parsed.reply,
                    edits: parsed.edits // Store edits for later application
                  }]);
                  setLoading(false);
                }
              } catch (e) {
                // Keep polling until JSON is complete
              }
            }
          }
        } catch(e) {
          console.error('Poll error:', e);
        }
      };

      // Start polling after a brief delay for Gemini to begin processing
      setTimeout(() => {
        pollIntervalRef.current = setInterval(poll, 800);
      }, 1500);

    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err}` }]);
      setLoading(false);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const clearHistory = () => {
    setMessages([]);
    localStorage.removeItem('codepad-gemini-history');
  };

  // Login screen
  if (!loggedIn && !showWebview) {
    return (
      <div className="browser-panel">
        <div className="browser-header">
          <div className="browser-header-title">
            <Sparkles size={14} className="browser-icon" />
            <span>Gemini</span>
          </div>
          <div className="browser-header-actions">
            <button onClick={onClose} className="chat-action-btn"><X size={14} /></button>
          </div>
        </div>
        <div className="gemini-login-screen">
          <Sparkles size={40} className="gemini-login-icon" />
          <h3>Connect to Gemini</h3>
          <p>Sign in with your Google account to use Gemini directly inside CodePad — no API key needed.</p>
          <button className="gemini-login-btn" onClick={handleShowLogin}>
            <LogIn size={16} />
            <span>Sign in to Google</span>
          </button>
        </div>
      </div>
    );
  }

  // Webview login screen
  if (showWebview) {
    return (
      <div className="browser-panel">
        <div className="browser-header">
          <div className="browser-header-title">
            <Sparkles size={14} className="browser-icon" />
            <span>Sign in to Gemini</span>
          </div>
          <div className="browser-header-actions">
            <button className="gemini-done-btn" onClick={handleLoginDone}>
              Done
            </button>
            <button onClick={() => { setShowWebview(false); invoke('hide_browser'); }} className="chat-action-btn"><X size={14} /></button>
          </div>
        </div>
        <div className="browser-viewport" ref={viewportRef} />
      </div>
    );
  }

  // Chat UI (logged in)
  return (
    <div className="browser-panel">
      <div className="browser-header">
        <div className="browser-header-title">
          <Sparkles size={14} className="browser-icon" />
          <span>Gemini</span>
        </div>
        <div className="browser-header-actions">
          <button 
            onClick={() => handleShowLogin()} 
            className="chat-action-btn" 
            title="Open Gemini in webview"
          >
            <ExternalLink size={14} />
          </button>
          <button onClick={onClose} className="chat-action-btn"><X size={14} /></button>
        </div>
      </div>

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
        {activeFile && (
          <div className="context-selector-wrapper">
            <div 
              className={`context-chip ${useContext ? 'active' : ''}`}
              onClick={() => setUseContext(!useContext)}
              title={useContext ? "Click to exclude file from context" : "Click to include file in context"}
            >
              <FileCode size={12} />
              <span className="context-name">{activeFile.name}</span>
              {useContext && <Check size={12} className="context-check" />}
            </div>
          </div>
        )}
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
