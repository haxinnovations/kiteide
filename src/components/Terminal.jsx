import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

const Terminal = ({ currentDir, id }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const hasSpawned = useRef(false);

  useEffect(() => {
    if (!terminalRef.current || hasSpawned.current || !id) return;
    hasSpawned.current = true;

    // Initialize xterm
    const term = new XTerm({
      theme: {
        background: '#ffffff',
        foreground: '#000000',
        cursor: '#000000',
        selectionBackground: '#dcdcdc',
        black: '#000000',
        red: '#cd3131',
        green: '#008700',
        yellow: '#000000',
        blue: '#0451a5',
        magenta: '#bc05bc',
        cyan: '#000000',
        white: '#555555',
        brightBlack: '#000000',
        brightRed: '#cd3131',
        brightGreen: '#14a314',
        brightYellow: '#000000',
        brightBlue: '#0451a5',
        brightMagenta: '#bc05bc',
        brightCyan: '#000000',
        brightWhite: '#000000'
      },
      fontSize: 13,
      fontFamily: '"JetBrains Mono", monospace',
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((event, url) => {
      openUrl(url).catch(err => console.error('Failed to open link:', err));
    }));
    term.open(terminalRef.current);
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Trigger initial fit
    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    // Spawn backend terminal with ID
    console.log(`Requesting terminal spawn for ${id} in:`, currentDir);
    invoke('spawn_terminal', { id, dir: currentDir }).catch(err => {
      console.error('Spawn Error:', err);
      term.write('\r\n\x1b[31mError spawning terminal: ' + err + '\x1b[0m\r\n');
    });

    // Resize handling with initialization delay
    const initTime = Date.now();
    const resizeObserver = new ResizeObserver(() => {
      // Don't resize for the first 500ms to allow shell to stabilize
      if (Date.now() - initTime < 500) return;

      if (fitAddonRef.current && terminalRef.current && terminalRef.current.offsetWidth > 0) {
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && dims.rows > 0 && dims.cols > 0) {
          console.log(`Resizing terminal ${id} to:`, dims);
          invoke('resize_terminal', { id, rows: dims.rows, cols: dims.cols })
            .catch(err => console.error('Resize Error:', err));
        }
      }
    });

    resizeObserver.observe(terminalRef.current);

    // Listen for unique backend output for this ID
    const unlistenPromise = listen(`terminal-output-${id}`, (event) => {
      term.write(event.payload);
    });

    // Handle user input with ID
    term.onData((data) => {
      invoke('write_to_terminal', { id, data }).catch(err => console.error(err));
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
      resizeObserver.disconnect();
      term.dispose();
      hasSpawned.current = false;
      // Tell backend to close this specific terminal
      invoke('close_terminal', { id }).catch(e => console.error('Close error:', e));
    };
  }, [id]);

  return (
    <div 
      ref={terminalRef} 
      className="terminal-container"
      style={{ 
        width: '100%', 
        height: '100%', 
        backgroundColor: '#ffffff',
        padding: '0'
      }} 
    />
  );
};

export default Terminal;
