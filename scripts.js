const editor = document.getElementById('editor');
const wordCountDisplay = document.getElementById('wordCountDisplay');
let idleTimeout;
let saveTimer = 3000;
const dbName = 'editorDB';
const storeName = 'editorContent';

// --- TRACKING FUNCTION ---
function trackEvent(eventName) {
    try {
        const formData = new FormData();
        formData.append('event', eventName);
        
        // Use full URL to ensure it works from any page
        const trackUrl = 'https://npad.ir/track.php';
        
        if (navigator.sendBeacon) {
            navigator.sendBeacon(trackUrl, formData);
        } else {
            // Fallback for older browsers
            fetch(trackUrl, {
                method: 'POST',
                body: formData
            });
        }
        console.log('✓ Tracked:', eventName);
    } catch (e) {
        console.error('✗ Tracking failed:', e);
    }
}

// --- MODAL LOGIC ---
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

    const newConfirm = confirmButton.cloneNode(true);
    const newCancel = cancelButton.cloneNode(true);
    const newClose = closeButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirm, confirmButton);
    cancelButton.parentNode.replaceChild(newCancel, cancelButton);
    closeButton.parentNode.replaceChild(newClose, closeButton);

    newConfirm.onclick = () => {
        modal.style.display = 'none';
        callback(true);
    };

    newCancel.onclick = newClose.onclick = () => {
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

// --- DATABASE LOGIC ---
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
}

async function loadFromIndexedDB() {
    const db = await openIndexedDB();
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get('content');

    request.onsuccess = (e) => {
        const data = e.target.result;
        if (data) {
            editor.innerHTML = data.content;
            updateWordCount();
        }
    };
}

async function clearIndexedDB() {
    const db = await openIndexedDB();
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    store.clear();
    editor.innerText = '';
    updateWordCount();
}

// --- FILE OPERATIONS ---
function newFile() {
    showModal('Are you sure? Unsaved changes will be lost.', (confirmed) => {
        if (confirmed) {
            editor.innerHTML = '';
            updateWordCount();
            clearIndexedDB();
            trackEvent('new_file'); // TRACK
        }
    }, true);
}

function openFile() {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt, .html';
    input.onchange = e => {
        let file = e.target.files[0];
        let reader = new FileReader();
        reader.onload = e => {
            editor.innerText = e.target.result;
            updateWordCount();
            trackEvent('open_file'); // TRACK
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
    trackEvent('download_txt'); // TRACK
}

function printFile() {
    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow.document.write('<html><head><title>Print</title>');
    printWindow.document.write('<style>body{font-family:sans-serif;padding:20px;}#content{white-space:pre-wrap;}</style>');
    printWindow.document.write('</head><body><div id="content">');
    printWindow.document.write(editor.innerHTML);
    printWindow.document.write('</div></body></html>');
    printWindow.document.close();
    printWindow.print();
    trackEvent('print_used'); // TRACK
}

function showDetails() {
    const wordCount = editor.innerText.split(/\s+/).filter(w => w !== '').length;
    const charCount = editor.innerText.length;
    showModal(`Words: ${wordCount}\nCharacters: ${charCount}`, () => {}, false);
    trackEvent('view_details'); // TRACK
}

// --- CLIPBOARD OPERATIONS ---
function copyText() { 
    editor.focus(); 
    document.execCommand('copy'); 
    trackEvent('copy_used'); // TRACK
}

function cutText() { 
    editor.focus(); 
    document.execCommand('cut'); 
    trackEvent('cut_used'); // TRACK
}

function selectAll() { 
    editor.focus(); 
    document.execCommand('selectAll'); 
}

async function pasteText() {
    try {
        const clipboardItems = await navigator.clipboard.read();
        let pasted = false;

        for (const item of clipboardItems) {
            if (item.types.includes('text/html')) {
                const blob = await item.getType('text/html');
                const html = await blob.text();
                editor.focus();
                document.execCommand('insertHTML', false, html);
                pasted = true;
                break;
            }
        }
        
        if (!pasted) {
            const text = await navigator.clipboard.readText();
            editor.focus();
            document.execCommand('insertText', false, text);
        }
        trackEvent('paste_used'); // TRACK
    } catch (err) {
        try {
            const text = await navigator.clipboard.readText();
            editor.focus();
            document.execCommand('insertText', false, text);
            trackEvent('paste_used'); // TRACK
        } catch (e) {
            alert("Browser blocked automated paste. Please use Ctrl+V.");
        }
    }
}

async function pasteWithoutFormatting() {
    try {
        const text = await navigator.clipboard.readText();
        editor.focus();
        document.execCommand('insertText', false, text);
        trackEvent('paste_plain_used'); // TRACK
    } catch (err) {
        console.error("Paste failed", err);
        alert("Browser blocked automated paste. Please use Ctrl+Shift+V.");
    }
}

function updateWordCount() {
    const text = editor.innerText.trim();
    const wordCount = text ? text.split(/\s+/).filter(word => word !== '').length : 0;
    const charCount = text.length;
    wordCountDisplay.textContent = `Words: ${wordCount} - Characters: ${charCount}`;
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    
    // TRACK PAGE VIEW
    trackEvent('page_view');
    
    // DARK MODE LOGIC
    const darkModeToggle = document.getElementById('darkModeToggle');
    
    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        darkModeToggle.checked = true;
    }

    darkModeToggle.addEventListener('change', () => {
        if (darkModeToggle.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('darkMode', 'enabled');
            saveToIndexedDB(editor.innerHTML, 'dark');
            trackEvent('dark_mode_enabled'); // TRACK
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('darkMode', 'disabled');
            saveToIndexedDB(editor.innerHTML, 'light');
            trackEvent('dark_mode_disabled'); // TRACK
        }
    });

    // AUTOSAVE LOGIC
    editor.addEventListener('input', () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
            const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
            saveToIndexedDB(editor.innerHTML, theme);
            updateWordCount();
        }, saveTimer);
    });

    // TOOLBAR LOGIC
    const fontSelect = document.getElementById('fontSelect');
    const sizeSelect = document.getElementById('sizeSelect');
    const foreColorInput = document.getElementById('foreColorInput');
    const backColorInput = document.getElementById('backColorInput');

    function applyFormat(command, value = null) {
        editor.focus();
        document.execCommand(command, false, value);
        updateButtonStates();
    }

    fontSelect.addEventListener('change', (e) => applyFormat('fontName', e.target.value));
    sizeSelect.addEventListener('change', (e) => applyFormat('fontSize', e.target.value));
    foreColorInput.addEventListener('input', (e) => applyFormat('foreColor', e.target.value));
    backColorInput.addEventListener('input', (e) => applyFormat('backColor', e.target.value));

    document.getElementById('toolbar').addEventListener('click', (event) => {
        const btn = event.target.closest('button');
        if (!btn) return;
        
        const id = btn.id;
        if (id === 'createLinkBtn') {
            const url = prompt('Enter URL:');
            if (url) {
                applyFormat('createLink', url);
                trackEvent('link_created'); // TRACK
            }
            return;
        }

        const commands = {
            'boldBtn': 'bold', 'italicBtn': 'italic', 'underlineBtn': 'underline',
            'strikeBtn': 'strikeThrough', 'subscriptBtn': 'subscript', 'superscriptBtn': 'superscript',
            'alignLeftBtn': 'justifyLeft', 'alignCenterBtn': 'justifyCenter', 
            'alignRightBtn': 'justifyRight', 'alignJustifyBtn': 'justifyFull',
            'bulletListBtn': 'insertUnorderedList', 'orderedListBtn': 'insertOrderedList',
            'undoBtn': 'undo', 'redoBtn': 'redo', 
            'indentBtn': 'indent', 'outdentBtn': 'outdent', 'removeFormatBtn': 'removeFormat'
        };

        if (commands[id]) {
            applyFormat(commands[id]);
        }
    });

    function updateButtonStates() {
        const buttons = document.querySelectorAll('#toolbar button');
        buttons.forEach(btn => {
            let cmd = null;
            if(btn.id === 'boldBtn') cmd = 'bold';
            if(btn.id === 'italicBtn') cmd = 'italic';
            if(btn.id === 'underlineBtn') cmd = 'underline';
            if (cmd && document.queryCommandState(cmd)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    loadFromIndexedDB();
    
    const fileMenu = document.querySelector('.dropdown-content');
    const clearLink = document.createElement('a');
    clearLink.textContent = "Clear Saved Data";
    clearLink.href = "#";
    clearLink.onclick = () => {
        showModal("Clear all saved data?", (yes) => { 
            if(yes) {
                clearIndexedDB();
                trackEvent('clear_data'); // TRACK
            }
        }, true);
    };
    fileMenu.appendChild(clearLink);
});