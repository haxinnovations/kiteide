import { useRef } from 'react';

const CodeEditor = ({ content, setContent, activeFile }) => {
  const lineNumbersRef = useRef(null);
  const editorRef = useRef(null);

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
  };

  const highlightContent = (text) => {
    if (!text) return '';
    
    // Always escape HTML special chars to prevent injection and show literal characters
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
      
    // Only apply HTML tag highlighting if it's an HTML file
    if (activeFile?.endsWith('.html') || activeFile?.endsWith('.htm')) {
      return escaped.replace(/(&lt;\/?[a-zA-Z0-9]+.*?&gt;)/g, '<span class="html-tag">$1</span>');
    }
    
    return escaped;
  };

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
      
      let newValue;
      let newPos;

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
  };

  return (
    <div className="h-full flex items-stretch">
      <div className="w-12 bg-bg-primary border-r border-border/50 flex flex-col items-center pt-4 select-none shrink-0" ref={lineNumbersRef}>
        {(content || '').split('\n').map((_, i) => (
          <div key={i + 1} className="text-[11px] leading-6 font-mono text-text-secondary/30 h-6">{i + 1}</div>
        ))}
      </div>
      <div className="flex-1 relative bg-bg-primary overflow-hidden">
        <div 
          className="absolute inset-0 p-4 font-mono text-[13px] leading-6 whitespace-pre pointer-events-none overflow-hidden highlight-layer"
          dangerouslySetInnerHTML={{ __html: highlightContent(content) + '\n' }}
        />
        <textarea
          ref={editorRef}
          className="absolute inset-0 w-full h-full p-4 bg-transparent text-transparent caret-accent font-mono text-[13px] leading-6 resize-none outline-none overflow-auto custom-scrollbar"
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
  );
};

export default CodeEditor;
