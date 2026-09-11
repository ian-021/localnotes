import React from 'react';
import { createRoot } from 'react-dom/client';
import Notes from './Notes.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<Notes theme="dark" sidebarOpen={true} />);
