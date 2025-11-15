const editor = document.getElementById('editor');
const wordCountDisplay = document.getElementById('wordCountDisplay');
let idleTimeout;
let saveTimer = 3000;
const dbName = 'editorDB';
const storeName = 'editorContent';

function showModal(message, callback, isConfirm = false) {
    const modal = document.getElementById('customModal');
    const messageElement = document.getElementById('modal-message');
    const confirmButton = document.getElementById('modal-confirm');
    const cancelButton = document.getElementById('modal-cancel');
    const closeButton = document.querySelector('.close');

    messageElement.textContent = message;
    modal.style.display = 'block';

    if (isConfirm) {
        confirmButton.style.display = 'inline-block';
        cancelButton.style.display = 'inline-block';
    } else {
        confirmButton.style.display = 'none';
        cancelButton.style.display = 'none';
    }

    confirmButton.onclick = cancelButton.onclick = closeButton.onclick = null;

    confirmButton.onclick = () => {
        modal.style.display = 'none';
        callback(true);
    };

    cancelButton.onclick = closeButton.onclick = () => {
        modal.style.display = 'none';
        callback(false);
    };

    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
            callback(false);
        }
    };
}

function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'id' });
            }
        };

        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveToIndexedDB(content, theme) {
    const db = await openIndexedDB();
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    store.put({ id: 'content', content: content, theme: theme });
    console.log("Content saved to IndexedDB.");
}

async function loadFromIndexedDB() {
    const db = await openIndexedDB();
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get('content');

    request.onsuccess = (e) => {
        const data = e.target.result;
        if (data) {
            editor.innerText = data.content;
            if (data.theme === 'dark') {
                document.body.classList.add('dark-mode');
                document.getElementById('darkModeToggle').checked = true;
            }
            updateWordCount();
        }
    };
}

async function clearIndexedDB() {
    const db = await openIndexedDB();
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    store.clear();
    console.log("Saved content cleared from IndexedDB.");
    editor.innerText = '';
    updateWordCount();
}

function addClearSavedContentButton() {
    const fileMenu = document.querySelector('.dropdown-content');
    const clearButton = document.createElement('a');
    clearButton.href = '#';
    clearButton.textContent = 'Clear Saved Content';
    clearButton.onclick = () => {
        if (confirm('Are you sure you want to clear the saved content?')) {
            clearIndexedDB();
        }
    };
    fileMenu.appendChild(clearButton);
}

function setupAutoSave() {
    editor.addEventListener('input', () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
            const content = editor.innerText;
            const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
            saveToIndexedDB(content, theme);
        }, saveTimer);
    });

    const darkModeToggle = document.getElementById('darkModeToggle');
    darkModeToggle.addEventListener('change', () => {
        const theme = darkModeToggle.checked ? 'dark' : 'light';
        saveToIndexedDB(editor.innerText, theme);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    addClearSavedContentButton();
    setupAutoSave();
    loadFromIndexedDB();
});

function updateWordCount() {
    const text = editor.innerText.trim();
    const wordCount = text ? text.split(/\s+/).filter(word => word !== '').length : 0;
    const charCount = text.length;

    const selectedText = window.getSelection().toString().trim();
    const selectedWordCount = selectedText ? selectedText.split(/\s+/).filter(word => word !== '').length : 0;
    const selectedCharCount = selectedText.length;

    wordCountDisplay.textContent = `Words: ${wordCount} - Characters: ${charCount} | Selected words: ${selectedWordCount} - Selected characters: ${selectedCharCount}`;
}

function newFile() {
    showModal(
        'Are you sure you want to create a new file? All unsaved changes will be lost.',
        (confirmed) => {
            if (confirmed) {
                editor.innerHTML = '';
                editor.innerText = '';
                updateWordCount();
                clearIndexedDB();
            }
        },
        true
    );
}

function openFile() {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.onchange = e => {
        let file = e.target.files[0];
        let reader = new FileReader();
        reader.onload = e => {
            editor.innerText = e.target.result;
            updateWordCount();

        };
        reader.readAsText(file);
    };
    input.click();
}

function saveFile() {
    let text = editor.innerText;
    let blob = new Blob([text], { type: 'text/plain' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = 'document.txt';
    a.click();
    URL.revokeObjectURL(url);
}

function printFile() {
    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow.document.write('<html><head><title>Print Editor Content</title>');
    printWindow.document.write('<style>');
    printWindow.document.write(`
        body { font-family: 'Vazirmatn', 'Arial', sans-serif; margin: 20px; }
        #editor-content {
            line-height: 1.6;
            color: #333;
            font-size: 16px;
        }
    `);
    printWindow.document.write('</style></head><body>');
    printWindow.document.write('<div id="editor-content">');
    printWindow.document.write(editor.innerHTML);
    printWindow.document.write('</div></body></html>');
    printWindow.document.close();
    printWindow.print();
}

function showDetails() {
    const wordCount = editor.innerText.split(/\s+/).filter(word => word !== '').length;
    const charCount = editor.innerText.length;

    showModal(`Words: ${wordCount}\nCharacters: ${charCount}`, () => {}, false);
}

function copyText() {
    editor.focus();
    document.execCommand('copy');
}

function cutText() {
    editor.focus();
    document.execCommand('cut');
}

async function pasteText() {
    editor.focus();
    try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
            if (item.types.includes('text/html')) {
                const htmlBlob = await item.getType('text/html');
                const htmlText = await new Response(htmlBlob).text();
                document.execCommand('insertHTML', false, htmlText);
                return;
            }
        }
        const plainText = await navigator.clipboard.readText();
        document.execCommand('insertText', false, plainText);
    } catch (err) {
        console.error('Failed to paste formatted content: ', err);
        alert('Your browser security settings prevent direct formatted paste via button. Please use Ctrl+V (or Cmd+V) to paste with formatting.');
    }
}

function pasteWithoutFormatting() {
    editor.focus();
    navigator.clipboard.readText().then(plainText => {
        document.execCommand('removeFormat', false, null);
        document.execCommand('unlink', false, null);
        document.execCommand('insertText', false, plainText);
    }).catch(err => {
        console.error('Failed to read clipboard contents for plain text paste:', err);
        alert('Could not read clipboard for plain text paste. Please use Ctrl+Shift+V (or Cmd+Shift+V) for paste without formatting.');
    });
}

function selectAll() {
    editor.focus();
    document.execCommand('selectAll');
}

function openShareModal() {
    document.getElementById('shareConfirmModal').style.display = 'block';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
}






let currentShareHash = null;

function showShareResult(hash, message) {
  currentShareHash = hash;
  const modal = document.getElementById('shareResultModal');
  const messageEl = document.getElementById('shareResultMessage');
  const linkContainer = document.getElementById('shareLinkContainer');
  
  messageEl.textContent = message;
  
  if (hash) {
    const link = `https://www.npad.ir/file/${hash}`;
    document.getElementById('shareLinkInput').value = link;
    linkContainer.style.display = 'block';
    document.getElementById('setPasswordBtn').onclick = () => {
      closeModal('shareResultModal');
      document.getElementById('setPasswordModal').style.display = 'block';
    };
  } else {
    linkContainer.style.display = 'none';
  }
  
  modal.style.display = 'block';
}

function submitPassword() {
  const password = document.getElementById('passwordInput').value;
  const confirmPassword = document.getElementById('confirmPasswordInput').value;
  
  if (!password || password !== confirmPassword) {
    alert('Passwords do not match or are empty');
    return;
  }
  
  fetch('api/set_password.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      hash: currentShareHash,
      password: password
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      closeModal('setPasswordModal');
      showShareResult(currentShareHash, 'Password set successfully!');
    } else {
      alert('Failed to set password: ' + (data.error || 'Unknown error'));
    }
  })
  .catch(err => {
    console.error('Password set error:', err);
    alert('An error occurred while setting password');
  });
}

function copyShareLink() {
  const input = document.getElementById('shareLinkInput');
  input.select();
  document.execCommand('copy');
  alert('Link copied to clipboard!');
}

// Modify confirmShare function
function confirmShare() {
  closeModal('shareConfirmModal');
  
  const htmlContent = DOMPurify.sanitize(editor.innerHTML);
  const password = prompt("Enter password (optional):") || null; // New password prompt
  
  showModal("Sending content to server...", () => {}, false);

  fetch('api/share.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      html: htmlContent,
      password: password // Send password if provided
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      closeCurrentModal(); // Close loading modal
      showShareResult(data.hash, password ? 
        'Password-protected file shared!' : 
        'File shared successfully!');
    } else {
      showModal("Failed to share your content. Please try again later.", () => {}, false);
    }
  })
  .catch(err => {
    console.error("Share error:", err);
    showModal("An error occurred while sharing.", () => {}, false);
  });
}

// Add helper to close any open modal
function closeCurrentModal() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.style.display = 'none';
  });
}















function getURLHash() {
    const path = window.location.pathname;
    const match = path.match(/^\/file\/([a-zA-Z0-9]{10})$/);
    return match ? match[1] : null;
}

async function loadSharedContent() {
    const hash = getURLHash();
    if (!hash) return;

    // First attempt without password
    const response = await fetch(`/api/fetch.php?hash=${hash}`);
    const result = await response.json();

    if (result.password_required) {
        showPasswordModal(hash);
    } else if (result.success) {
        editor.innerHTML = result.html;
        updateWordCount();
    } else {
        showModal("Failed to load shared file: " + (result.error || "Unknown error"), () => {}, false);
    }
}

function showPasswordModal(hash) {
    // Create password modal elements
    const passwordModal = document.createElement('div');
    passwordModal.className = 'modal';
    passwordModal.style.display = 'block';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    
    const closeBtn = document.createElement('span');
    closeBtn.className = 'close';
    closeBtn.innerHTML = '&times;';
    closeBtn.style.position = 'absolute';
    closeBtn.style.right = '20px';
    closeBtn.style.top = '10px';
    closeBtn.style.fontSize = '28px';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = () => {
        document.body.removeChild(passwordModal);
        window.location.href = 'https://npad.ir';
    };
    
    const message = document.createElement('p');
    message.textContent = "This file is password protected. Please enter the password:";
    message.style.marginTop = '30px'; // Give space for close button
    
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.id = 'passwordInput';
    passwordInput.placeholder = 'Enter password';
    passwordInput.style.width = '100%';
    passwordInput.style.padding = '10px';
    passwordInput.style.margin = '15px 0';
    passwordInput.style.borderRadius = '4px';
    passwordInput.style.border = '1px solid #ccc';
    
    const errorMsg = document.createElement('div');
    errorMsg.id = 'passwordError';
    errorMsg.style.color = 'red';
    errorMsg.style.marginBottom = '10px';
    errorMsg.style.display = 'none';
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.marginTop = '10px';
    
    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit';
    submitBtn.style.flex = '1';
    submitBtn.style.padding = '10px';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.flex = '1';
    cancelBtn.style.padding = '10px';
    cancelBtn.style.backgroundColor = 'transparent';
    cancelBtn.style.border = '1px solid #ccc';
    cancelBtn.onclick = () => {
        document.body.removeChild(passwordModal);
        window.location.href = 'https://npad.ir';
    };
    
    // Build modal structure
    buttonContainer.appendChild(submitBtn);
    buttonContainer.appendChild(cancelBtn);
    
    modalContent.appendChild(closeBtn);
    modalContent.appendChild(message);
    modalContent.appendChild(passwordInput);
    modalContent.appendChild(errorMsg);
    modalContent.appendChild(buttonContainer);
    
    passwordModal.appendChild(modalContent);
    document.body.appendChild(passwordModal);
    
    // Focus on password input
    passwordInput.focus();
    
    // Handle password submission
    const handleSubmit = async () => {
        const password = passwordInput.value.trim();
        if (!password) {
            showError('Please enter a password');
            return;
        }
        
        try {
            const response = await fetch(`/api/fetch.php?hash=${hash}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
            });
            
            const result = await response.json();
            if (result.success) {
                document.body.removeChild(passwordModal);
                editor.innerHTML = result.html;
                updateWordCount();
            } else {
                showError('Incorrect password. Please try again.');
                passwordInput.value = '';
                passwordInput.focus();
            }
        } catch (err) {
            showError('Failed to verify password. Please try again.');
            console.error('Password verification error:', err);
        }
    };
    
    submitBtn.onclick = handleSubmit;
    
    // Handle Enter key
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    });
    
    // Show error message
    function showError(text) {
        errorMsg.textContent = text;
        errorMsg.style.display = 'block';
    }
}







document.addEventListener('DOMContentLoaded', () => {
    const toolbar = document.getElementById('toolbar');
    const fontSelect = document.getElementById('fontSelect');
    const sizeSelect = document.getElementById('sizeSelect');
    const foreColorInput = document.getElementById('foreColorInput');
    const backColorInput = document.getElementById('backColorInput');
    const darkModeToggle = document.getElementById('darkModeToggle');

    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        darkModeToggle.checked = true;
    }

    darkModeToggle.addEventListener('change', () => {
        if (darkModeToggle.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('darkMode', 'enabled');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('darkMode', 'disabled');
        }
        updateButtonStates();
    });

    function applyFormat(command, value = null) {
        editor.focus();
        if (command === 'createLink' && value) {
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                document.execCommand(command, false, value);
            } else {
                const linkText = prompt('Enter text for the link:', value);
                if (linkText) {
                    document.execCommand('insertHTML', false, `<a href="${value}" target="_blank">${linkText}</a>`);
                }
            }
        } else if (command === 'removeFormat') {
            document.execCommand(command, false, value);
            document.execCommand('unlink', false, null);
        } else {
            document.execCommand(command, false, value);
        }
        updateButtonStates();
    }

    function updateButtonStates() {
        const buttons = toolbar.querySelectorAll('button');
        buttons.forEach(button => {
            let command = '';
            switch (button.id) {
                case 'boldBtn': command = 'bold'; break;
                case 'italicBtn': command = 'italic'; break;
                case 'underlineBtn': command = 'underline'; break;
                case 'strikeBtn': command = 'strikeThrough'; break;
                case 'subscriptBtn': command = 'subscript'; break;
                case 'superscriptBtn': command = 'superscript'; break;
                case 'alignLeftBtn': command = 'justifyLeft'; break;
                case 'alignCenterBtn': command = 'justifyCenter'; break;
                case 'alignRightBtn': command = 'justifyRight'; break;
                case 'alignJustifyBtn': command = 'justifyFull'; break;
                case 'bulletListBtn': command = 'insertUnorderedList'; break;
                case 'orderedListBtn': command = 'insertOrderedList'; break;
            }
            if (command && document.queryCommandState(command)) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        const currentFont = document.queryCommandValue('fontName');
        fontSelect.value = currentFont || 'Arial';

        const currentSize = document.queryCommandValue('fontSize');
        sizeSelect.value = currentSize || '2';

        try {
            const currentColor = document.queryCommandValue('foreColor');
            foreColorInput.value = currentColor !== 'transparent' ? rgbToHex(currentColor) : '#333333';
        } catch (e) {
            foreColorInput.value = '#333333';
        }

        try {
            const currentBackColor = document.queryCommandValue('backColor');
            backColorInput.value = currentBackColor !== 'transparent' ? rgbToHex(currentBackColor) : '#FFFF00';
        } catch (e) {
            backColorInput.value = '#FFFF00';
        }
    }

    function rgbToHex(rgb) {
        if (rgb.startsWith('#')) return rgb;
        const parts = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!parts) return '#000000';
        return `#${[1, 2, 3].map(i => parseInt(parts[i]).toString(16).padStart(2, '0')).join('')}`;
    }

    toolbar.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target) return;

        const id = target.id;
        switch (id) {
            case 'boldBtn': applyFormat('bold'); break;
            case 'italicBtn': applyFormat('italic'); break;
            case 'underlineBtn': applyFormat('underline'); break;
            case 'strikeBtn': applyFormat('strikeThrough'); break;
            case 'subscriptBtn': applyFormat('subscript'); break;
            case 'superscriptBtn': applyFormat('superscript'); break;
            case 'alignLeftBtn': applyFormat('justifyLeft'); break;
            case 'alignCenterBtn': applyFormat('justifyCenter'); break;
            case 'alignRightBtn': applyFormat('justifyRight'); break;
            case 'alignJustifyBtn': applyFormat('justifyFull'); break;
            case 'bulletListBtn': applyFormat('insertUnorderedList'); break;
            case 'orderedListBtn': applyFormat('insertOrderedList'); break;
            case 'undoBtn': applyFormat('undo'); break;
            case 'redoBtn': applyFormat('redo'); break;
            case 'indentBtn': applyFormat('indent'); break;
            case 'outdentBtn': applyFormat('outdent'); break;
            case 'removeFormatBtn': applyFormat('removeFormat'); break;
            case 'createLinkBtn':
                const url = prompt('Enter the URL (e.g., https://example.com):');
                if (url && isValidURL(url)) {
                    applyFormat('createLink', url);
                } else {
                    alert('Please enter a valid URL.');
                }
                break;
        }
    });

    function isValidURL(url) {
        const pattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
        return pattern.test(url);
    }

    fontSelect.addEventListener('change', (event) => {
        applyFormat('fontName', event.target.value);
    });

    sizeSelect.addEventListener('change', (event) => {
        applyFormat('fontSize', event.target.value);
    });

    foreColorInput.addEventListener('input', (event) => {
        applyFormat('foreColor', event.target.value);
    });

    backColorInput.addEventListener('input', (event) => {
        applyFormat('backColor', event.target.value);
    });

    editor.addEventListener('input', updateWordCount);
    editor.addEventListener('mouseup', updateWordCount);
    editor.addEventListener('keyup', updateWordCount);
    editor.addEventListener('mouseup', updateButtonStates);
    editor.addEventListener('keyup', updateButtonStates);
    toolbar.addEventListener('click', updateButtonStates);
    updateButtonStates();
    loadSharedContent();
});