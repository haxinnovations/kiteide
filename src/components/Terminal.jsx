import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

const Terminal = ({ currentDir, id, theme }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const hasSpawned = useRef(false);

  const getTerminalTheme = (themeName) => {
    if (themeName === 'dark') {
      return {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#2f81f7',
        selectionBackground: 'rgba(47, 129, 247, 0.3)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#ffffff'
      };
    }
    return {
      background: '#ffffff',
      foreground: '#1f2328',
      cursor: '#0969da',
      selectionBackground: 'rgba(9, 105, 218, 0.2)',
      black: '#24292f',
      red: '#cf222e',
      green: '#1a7f37',
      yellow: '#9a6700',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7681',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#116329',
      brightYellow: '#4d2d00',
      brightBlue: '#0550ae',
      brightMagenta: '#6639ba',
      brightCyan: '#055d64',
      brightWhite: '#24292f'
    };
  };

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getTerminalTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!terminalRef.current || hasSpawned.current || !id) return;
    hasSpawned.current = true;

    // Initialize xterm
    const term = new XTerm({
      theme: getTerminalTheme(theme),
      fontSize: 12,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
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

    // Trigger initial fit and wait for custom fonts to load
    const doFit = () => {
      if (fitAddonRef.current && terminalRef.current && terminalRef.current.offsetWidth > 0) {
        fitAddonRef.current.fit();
      }
    };

    setTimeout(doFit, 100);
    setTimeout(doFit, 500); // Fallback for slower loads
    
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(doFit);
    }

    // Spawn backend terminal with ID
    console.log(`Requesting terminal spawn for ${id} in:`, currentDir);
    invoke('spawn_terminal', { id, dir: currentDir }).catch(err => {
      console.error('Spawn Error:', err);
      term.write('\r\n\x1b[31mError spawning terminal: ' + err + '\x1b[0m\r\n');
    });

    // Resize handling with stabilization
    let resizeTimer;
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current && terminalRef.current.offsetWidth > 0) {
        // Immediate frontend fit for visual responsiveness
        fitAddonRef.current.fit();
        
        // Debounce backend resize to avoid process thrashing
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims && dims.rows > 0 && dims.cols > 0) {
            invoke('resize_terminal', { id, rows: dims.rows, cols: dims.cols })
              .catch(err => console.error('Resize Error:', err));
          }
        }, 100);
      }
    });

    resizeObserver.observe(terminalRef.current);

    // Listen for unique backend output for this ID
    const unlistenPromise = listen(`terminal-output-${id}`, (event) => {
      term.write(event.payload, () => {
        term.scrollToBottom();
      });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div 
      ref={terminalRef} 
      className="w-full h-full bg-bg-primary overflow-hidden pl-3 pt-1 pb-2" 
    />
  );
};

export default Terminal;
