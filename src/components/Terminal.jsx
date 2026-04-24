import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

const Terminal = ({ currentDir }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const hasSpawned = useRef(false); // Prevents double spawning

  useEffect(() => {
    if (!terminalRef.current || hasSpawned.current) return;
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
    term.open(terminalRef.current);
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Trigger initial fit
    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    // Spawn backend terminal
    console.log('Requesting terminal spawn for:', currentDir);
    invoke('spawn_terminal', { dir: currentDir }).catch(err => {
      console.error('Spawn Error:', err);
      term.write('\r\n\x1b[31mError spawning terminal: ' + err + '\x1b[0m\r\n');
    });

    // Resize handling using ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          invoke('resize_terminal', { rows: dims.rows, cols: dims.cols })
            .catch(err => console.error('Resize Error:', err));
        }
      }
    });

    resizeObserver.observe(terminalRef.current);

    // Listen for backend output
    const unlistenPromise = listen('terminal-output', (event) => {
      term.write(event.payload);
    });

    // Handle user input
    term.onData((data) => {
      invoke('write_to_terminal', { data }).catch(err => console.error(err));
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
      resizeObserver.disconnect();
      term.dispose();
      hasSpawned.current = false;
    };
  }, []);

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
