// ========== State ==========
var keyboardHeight = 0;
var lastKnownHeight = window.innerHeight;
let autosaveTimer;
let idleTimer;

// ========== DOM Elements ==========
const editor = document.getElementById('editor');
const fontInput = document.getElementById('fontInput');
const fontSizeInput = document.getElementById('fontSizeInput');
const lineSpacingInput = document.getElementById('lineSpacingInput');
const charSpacingInput = document.getElementById('charSpacingInput');
const darkModeIcon = document.querySelector('.dark-mode-toggle i');
const autosaveStatusEl = document.getElementById('autosave-status');

// ========== Utility Functions ==========
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ========== Core Functions ==========
function toggleDropdown(listId) {
  const list = document.getElementById(listId);
  list.classList.toggle('show');
  document.querySelectorAll('.dropdown-list').forEach(l => {
    if (l.id !== listId) l.classList.remove('show');
  });
}

function selectFont(font) {
  editor.style.fontFamily = font;
  fontInput.value = font;
  toggleDropdown('fontList');
}

function applyFont() {
  const font = fontInput.value;
  editor.style.fontFamily = font;
  localStorage.setItem('npad-font', font);
}

function adjustValue(type, delta) {
  let inputElement, styleProperty, storageKey, currentValue, newValue, min, max, fixed;

  if (type === 'fontSize') {
    inputElement = fontSizeInput;
    styleProperty = 'fontSize';
    storageKey = 'npad-fontSize';
    currentValue = parseInt(inputElement.value);
    min = 8; max = 72; fixed = 0;
    newValue = Math.max(min, Math.min(max, currentValue + delta));
    editor.style[styleProperty] = newValue + 'px';
  } else if (type === 'lineSpacing') {
    inputElement = lineSpacingInput;
    styleProperty = 'lineHeight';
    storageKey = 'npad-lineSpacing';
    currentValue = parseFloat(inputElement.value);
    min = 0.8; max = 3.0; fixed = 1;
    newValue = Math.max(min, Math.min(max, currentValue + delta));
    editor.style[styleProperty] = newValue;
  } else if (type === 'charSpacing') {
    inputElement = charSpacingInput;
    styleProperty = 'letterSpacing';
    storageKey = 'npad-charSpacing';
    currentValue = parseFloat(inputElement.value);
    min = -2; max = 10; fixed = 1;
    newValue = Math.max(min, Math.min(max, currentValue + delta));
    editor.style[styleProperty] = newValue + 'px';
  }

  if (inputElement) {
    const displayValue = newValue.toFixed(fixed);
    inputElement.value = displayValue;

    if (type === 'fontSize') {
      document.getElementById('mobileFontSize').value = displayValue;
    } else if (type === 'lineSpacing') {
      document.getElementById('mobileLineSpacing').value = displayValue;
    } else if (type === 'charSpacing') {
      document.getElementById('mobileCharSpacing').value = displayValue;
    }

    localStorage.setItem(storageKey, displayValue);
    resetIdleTimer();
  }
}

function formatText(cmd) {
  if (cmd === 'directionRTL' || cmd === 'directionLTR') {
    const direction = cmd === 'directionRTL' ? 'rtl' : 'ltr';
    editor.style.direction = direction;
    localStorage.setItem('npad-direction', direction);
    ['directionRTL', 'directionLTR'].forEach(dirCmd => document.getElementById(dirCmd)?.classList.remove('active'));
    document.getElementById(cmd)?.classList.add('active');
  } else {
    document.execCommand(cmd, false, null);
  }
  updateToolbarStates();
}

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDarkMode = document.body.classList.contains('dark-mode');
  localStorage.setItem('npad-dark-mode', isDarkMode);
  darkModeIcon.classList.toggle('fa-moon', !isDarkMode);
  darkModeIcon.classList.toggle('fa-sun', isDarkMode);
}

function downloadNote() {
  const text = editor.innerText;
  const blob = new Blob([text], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "note.txt";
  link.click();
  URL.revokeObjectURL(link.href);
}

function printNote() {
  const content = editor.innerHTML;
  const font = editor.style.fontFamily || 'Inter';
  const fontSize = editor.style.fontSize || '16px';
  const win = window.open('', '', 'width=800,height=600');
  win.document.write(`
    <html>
      <head>
        <title>Print Note</title>
        <style>
          body { font-family: ${font}, sans-serif; padding: 40px; font-size: ${fontSize}; line-height: 1.5; color: #000; }
          @media print { body { margin: 0; padding: 0; font-size: 14pt; } }
        </style>
      </head>
      <body>${content}</body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
  win.close();
}

function showAutosaveStatus(msg) {
  autosaveStatusEl.textContent = msg;
  autosaveStatusEl.classList.add('visible');
  setTimeout(() => autosaveStatusEl.classList.remove('visible'), 2000);
}

function autosaveContent() {
  const content = editor.innerHTML;
  localStorage.setItem('npad-content', content);
  showAutosaveStatus('Draft Saved.');
}

function triggerAutosave() {
  showAutosaveStatus('Auto saving...');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveContent, 400);
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(triggerAutosave, 1000);
}

function updateToolbarStates() {
  const toggleableCommands = ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript'];
  toggleableCommands.forEach(cmd => {
    const btn = document.getElementById(cmd);
    if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
  });

  const alignmentCommands = ['justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];
  let isAnyAlignmentActive = false;
  alignmentCommands.forEach(cmd => {
    const btn = document.getElementById(cmd);
    if (btn) {
      const isActive = document.queryCommandState(cmd);
      btn.classList.toggle('active', isActive);
      if (isActive) isAnyAlignmentActive = true;
    }
  });

  if (!isAnyAlignmentActive) {
    document.getElementById('justifyLeft').classList.add('active');
  }
}

function loadInitialState() {
  console.log('Loading initial state...');
  document.getElementById('year').textContent = new Date().getFullYear();

  const savedContent = localStorage.getItem('npad-content');
  if (savedContent) {
    editor.innerHTML = savedContent;
    console.log('Loaded saved content from localStorage');
  }

  const isDarkMode = localStorage.getItem('npad-dark-mode') === 'true';
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
    darkModeIcon.classList.remove('fa-moon');
    darkModeIcon.classList.add('fa-sun');
    console.log('Dark mode enabled from localStorage');
  }

  const applySetting = (key, inputEl, styleProp, defaultValue, unit = '') => {
    const savedValue = localStorage.getItem(`npad-${key}`) || defaultValue;
    if (inputEl) inputEl.value = savedValue;
    editor.style[styleProp] = savedValue + unit;
    console.log(`Applied ${key}: ${savedValue}${unit}`);
  };

  applySetting('font', fontInput, 'fontFamily', 'Inter');
  applySetting('fontSize', fontSizeInput, 'fontSize', '16', 'px');
  applySetting('lineSpacing', lineSpacingInput, 'lineHeight', '1.2');
  applySetting('charSpacing', charSpacingInput, 'letterSpacing', '0', 'px');

  const savedDirection = localStorage.getItem('npad-direction') || 'ltr';
  editor.style.direction = savedDirection;
  if (savedDirection === 'rtl') {
    document.getElementById('directionRTL').classList.add('active');
  } else {
    document.getElementById('directionLTR').classList.add('active');
  }
  console.log(`Text direction set to: ${savedDirection}`);

  updateToolbarStates();
}

function newFile() {
  const content = editor.innerText.trim();
  if (content.length > 0) {
    const save = confirm("Do you want to download the current note before starting a new one?");
    if (save) {
      downloadNote();
    }
  }
  editor.innerHTML = "";
  console.log('New file created');
}

function openFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const content = editor.innerText.trim();
  const proceed = () => {
    const reader = new FileReader();
    reader.onload = function (e) {
      editor.innerText = e.target.result;
      console.log(`File opened: ${file.name}`);
    };
    reader.readAsText(file);
  };

  if (content.length > 0) {
    const save = confirm("Do you want to download the current note before opening a new one?");
    if (save) {
      downloadNote();
    }
  }

  proceed();
  event.target.value = "";
}

function undoAction() {
  document.execCommand('undo', false, null);
  console.log('Undo action performed');
}

function redoAction() {
  document.execCommand('redo', false, null);
  console.log('Redo action performed');
}

function insertHorizontalRule() {
  document.execCommand("insertHorizontalRule", false, null);
  console.log('Inserted horizontal rule');
}

function insertDateTime() {
  const date = new Date();
  const formatted = date.toLocaleString();
  document.execCommand("insertText", false, formatted);
  console.log(`Inserted date/time: ${formatted}`);
}

function showWordCount() {
  const text = editor.innerText.trim();
  const words = text.length > 0 ? text.split(/\s+/).length : 0;
  const chars = text.length;
  alert(`Words: ${words}\nCharacters: ${chars}`);
  console.log(`Word count: ${words}, Character count: ${chars}`);
}

function updateLiveCount() {
  const display = document.getElementById("countDisplay");
  const text = editor.innerText.trim();
  const selection = window.getSelection();
  const selectedText = selection && selection.toString().trim();

  const totalWords = text ? text.split(/\s+/).length : 0;
  const totalChars = text.length;
  const selectedWords = selectedText ? selectedText.split(/\s+/).length : 0;
  const selectedChars = selectedText ? selectedText.length : 0;

  const charLimit = 5000;
  let warningClass = totalChars > charLimit ? "warning" : "";
  display.className = `count-display ${warningClass}`;
  display.textContent = `Total: ${totalWords} words, ${totalChars} chars — Selected: ${selectedWords} words, ${selectedChars} chars`;
  console.log(`Live count updated: Total ${totalWords} words, ${totalChars} chars; Selected ${selectedWords} words, ${selectedChars} chars`);
}

function adjustFontSize() {
  adjustValue('fontSize', 2);
  console.log('Font size adjusted');
}

function toggleAlignment() {
  const alignments = ['justifyLeft', 'justifyCenter', 'justifyRight'];
  const current = alignments.findIndex(cmd => document.queryCommandState(cmd));
  const next = (current + 1) % alignments.length;
  formatText(alignments[next]);
  console.log(`Alignment toggled to: ${alignments[next]}`);
}

function toggleMobileOptions() {
  const options = document.querySelector('.mobile-options');
  const expandButton = document.querySelector('.expand-button');
  options.classList.toggle('expanded');
  expandButton.classList.toggle('expanded');
  updateEditorPadding();
  console.log(`Mobile options toggled, expanded: ${options.classList.contains('expanded')}`);
}

function applyMobileFontSize() {
  const size = document.getElementById('mobileFontSize').value;
  if (size >= 8 && size <= 72) {
    editor.style.fontSize = size + 'px';
    fontSizeInput.value = size;
    localStorage.setItem('npad-fontSize', size);
    console.log(`Applied mobile font size: ${size}px`);
  }
}

function initMobileValues() {
  document.getElementById

('mobileFontSize').value = fontSizeInput.value;
  document.getElementById('mobileCharSpacing').value = charSpacingInput.value;
  document.getElementById('mobileLineSpacing').value = lineSpacingInput.value;

  const fontSelect = document.querySelector('.mobile-font-select');
  if (fontSelect) {
    fontSelect.value = fontInput.value || 'Inter';
  }
  console.log('Initialized mobile values');
}

function updateMobileToolbarVisibility() {
  const mobileToolbar = document.querySelector('.mobile-toolbar');
  if (window.innerWidth <= 994) {
    mobileToolbar.style.display = 'flex';
    document.querySelector('.toolbar').style.display = 'none';
  } else {
    mobileToolbar.style.display = 'none';
    document.querySelector('.toolbar').style.display = 'flex';
  }
  console.log(`Mobile toolbar visibility updated, window.innerWidth: ${window.innerWidth}`);
}

function updateToolbarPosition() {
  const mobileToolbar = document.querySelector('.mobile-toolbar');
  if (!mobileToolbar) {
    console.log('Mobile toolbar not found');
    return;
  }

  const currentHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const offset = lastKnownHeight - currentHeight;

  console.log(`updateToolbarPosition: Offset=${offset}, CurrentHeight=${currentHeight}, LastKnownHeight=${lastKnownHeight}, KeyboardHeight=${keyboardHeight}`);

  if (offset > 50 && currentHeight < lastKnownHeight) {
    keyboardHeight = offset;
    mobileToolbar.classList.add('keyboard-active');
    document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    console.log(`Keyboard detected, height: ${keyboardHeight}px, added keyboard-active class`);
  } else {
    keyboardHeight = 0;
    mobileToolbar.classList.remove('keyboard-active');
    document.documentElement.style.setProperty('--keyboard-height', '0px');
    console.log('No keyboard detected, reset keyboardHeight and removed keyboard-active class');
  }

  lastKnownHeight = window.innerHeight;
}

function updateEditorPadding() {
  if (window.innerWidth <= 768) {
    const toolbarHeight = document.querySelector('.mobile-toolbar')?.offsetHeight || 0;
    const isExpanded = document.querySelector('.mobile-options')?.classList.contains('expanded');
    const padding = isExpanded ? toolbarHeight + keyboardHeight + 150 : toolbarHeight + keyboardHeight + 20;
    editor.style.paddingBottom = `${padding}px`;
    console.log(`Editor padding updated: window.innerWidth=${window.innerWidth}, toolbarHeight=${toolbarHeight}, keyboardHeight=${keyboardHeight}, isExpanded=${isExpanded}, padding=${padding}px`);
  } else {
    editor.style.paddingBottom = '24px';
    console.log('Editor padding reset to 24px for desktop');
  }
}

function setupKeyboardDetection() {
  console.log('Setting up keyboard detection...');
  const debouncedUpdateToolbar = debounce(updateToolbarPosition, 100);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      console.log('visualViewport resize event triggered');
      debouncedUpdateToolbar();
    });
    window.visualViewport.addEventListener('scroll', () => {
      console.log('visualViewport scroll event triggered');
      debouncedUpdateToolbar();
    });
  } else {
    console.log('visualViewport not supported, using window.resize fallback');
  }

  window.addEventListener('resize', () => {
    console.log('Window resize event triggered');
    debouncedUpdateToolbar();
  });

  document.addEventListener('focusin', (e) => {
    if (
      e.target.isContentEditable ||
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA'
    ) {
      console.log(`Focusin on editable element: ${e.target.tagName}, id=${e.target.id || 'none'}`);
      setTimeout(debouncedUpdateToolbar, 300);
    }
  });

  document.addEventListener('focusout', () => {
    console.log('Focusout event triggered');
    setTimeout(() => {
      if (!document.activeElement || !document.activeElement.matches('input, textarea, [contenteditable]')) {
        keyboardHeight = 0;
        const mobileToolbar = document.querySelector('.mobile-toolbar');
        if (mobileToolbar) {
          mobileToolbar.classList.remove('keyboard-active');
          document.documentElement.style.setProperty('--keyboard-height', '0px');
          console.log('Focusout: No editable element focused, reset keyboardHeight and toolbar');
        }
      } else {
        console.log(`Focusout: Still focused on ${document.activeElement.tagName}, id=${document.activeElement.id || 'none'}`);
      }
    }, 300);
  });

  window.addEventListener('orientationchange', () => {
    console.log('Orientation change event triggered');
    setTimeout(debouncedUpdateToolbar, 300);
  });
}

// ========== Initialization ==========
document.addEventListener('DOMContentLoaded', function () {
  console.log('DOM fully loaded, initializing...');
  console.log(`Initial window.innerHeight: ${window.innerHeight}, visualViewport.height: ${window.visualViewport ? window.visualViewport.height : 'N/A'}`);

  // Check DOM elements
  console.log(`Editor element: ${editor ? 'Found' : 'Not found'}`);
  console.log(`Mobile toolbar element: ${document.querySelector('.mobile-toolbar') ? 'Found' : 'Not found'}`);
  console.log(`Mobile options element: ${document.querySelector('.mobile-options') ? 'Found' : 'Not found'}`);

  loadInitialState();
  initMobileValues();
  updateLiveCount();
  setupKeyboardDetection();
  updateMobileToolbarVisibility();
  updateEditorPadding();

  window.addEventListener('resize', () => {
    console.log('Window resize event (global) triggered');
    updateMobileToolbarVisibility();
    updateEditorPadding();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown-container')) {
      document.querySelectorAll('.dropdown-list').forEach(l => l.classList.remove('show'));
      console.log('Closed dropdowns on outside click');
    }
  });

  editor.addEventListener('input', () => {
    resetIdleTimer();
    console.log('Editor input event triggered');
  });
  editor.addEventListener('keyup', () => {
    updateToolbarStates();
    console.log('Editor keyup event triggered');
  });
  editor.addEventListener('mouseup', () => {
    updateToolbarStates();
    console.log('Editor mouseup event triggered');
  });

  const toolbar = document.querySelector('.toolbar');
  toolbar.addEventListener('click', (e) => {
    if (e.target.closest('button')) {
      resetIdleTimer();
      console.log('Toolbar button clicked');
    }
  });

  const style = document.createElement('style');
  style.textContent = `
	.mobile-toolbar {
	  position: fixed;
	  bottom: 20px;
	  left: 10%;
	  right: 0;
	  width: 80%;
	  box-sizing: border-box;
	  transform: translateY(0%);
	  transition: transform 0.2s ease;
	}
	.mobile-toolbar.keyboard-active {
	  transform: translateY(calc(-1 * var(--keyboard-height, 0px)));
	}
  `;
  document.head.appendChild(style);
  console.log('Dynamic CSS for mobile-toolbar positioning added');
});