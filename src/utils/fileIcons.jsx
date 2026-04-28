import React from 'react'
import { Code2, Palette, Braces, FileText, Image, Settings } from 'lucide-react'

// Import asset images so Vite can bundle them and provide correct production URLs
import jsIcon from '../assets/icons/js.png'
import reactIcon from '../assets/icons/react.png'
import htmlIcon from '../assets/icons/html.png'
import pythonIcon from '../assets/icons/python.png'

/**
 * Utility to get consistent file icons across the application.
 * Using imports ensures icons work in both development and production builds.
 */
export const getFileIcon = (filename, extraClasses = "") => {
  const ext = filename.split('.').pop().toLowerCase();
  
  const icons = {
    js: { icon: <img src={jsIcon} className="w-3.5 h-3.5 object-contain" alt="JS" />, color: '' },
    jsx: { icon: <img src={reactIcon} className="w-3.5 h-3.5 object-contain" alt="JSX" />, color: '' },
    ts: { icon: <Code2 size={14} />, color: 'text-blue-600' },
    tsx: { icon: <Code2 size={14} />, color: 'text-blue-500' },
    css: { icon: <Palette size={14} />, color: 'text-blue-500' },
    scss: { icon: <Palette size={14} />, color: 'text-pink-500' },
    html: { icon: <img src={htmlIcon} className="w-3.5 h-3.5 object-contain" alt="HTML" />, color: '' },
    htm: { icon: <img src={htmlIcon} className="w-3.5 h-3.5 object-contain" alt="HTML" />, color: '' },
    py: { icon: <img src={pythonIcon} className="w-3.5 h-3.5 object-contain" alt="Python" />, color: '' },
    json: { icon: <Braces size={14} />, color: 'text-yellow-600' },
    md: { icon: <FileText size={14} />, color: 'text-text-secondary' },
    png: { icon: <Image size={14} />, color: 'text-purple-500' },
    jpg: { icon: <Image size={14} />, color: 'text-purple-500' },
    svg: { icon: <Image size={14} />, color: 'text-orange-400' },
    toml: { icon: <Settings size={14} />, color: 'text-text-secondary' },
    yaml: { icon: <Settings size={14} />, color: 'text-text-secondary' },
  };

  const iconData = icons[ext] || { icon: <FileText size={14} />, color: 'text-text-secondary' };
  
  return (
    <span className={`${iconData.color} shrink-0 opacity-80 group-hover:opacity-100 transition-opacity ${extraClasses}`}>
      {iconData.icon}
    </span>
  );
};
