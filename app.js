// Core state variables
let stream = null;
let animationFrameId = null;
let isScanning = false;
let currentFacingMode = 'environment'; // environment = back camera, user = front camera
let hasMultipleCameras = false;
let scanHistory = JSON.parse(localStorage.getItem('aura_scan_history') || '[]');

// DOM Elements
const video = document.getElementById('webcam-video');
const canvas = document.getElementById('hidden-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const cameraMessage = document.getElementById('camera-message');
const statusText = document.getElementById('status-text');
const statusDot = document.querySelector('.status-dot');

const switchCameraBtn = document.getElementById('switch-camera-btn');
const pauseScannerBtn = document.getElementById('pause-scanner-btn');

const tabCamera = document.getElementById('tab-camera');
const tabUpload = document.getElementById('tab-upload');
const viewCamera = document.getElementById('view-camera');
const viewUpload = document.getElementById('view-upload');
const tabSlider = document.querySelector('.tab-slider');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const selectFileBtn = document.getElementById('select-file-btn');
const uploadPreviewContainer = document.getElementById('upload-preview-container');
const uploadPreview = document.getElementById('upload-preview');
const clearUploadBtn = document.getElementById('clear-upload-btn');

const resultPlaceholder = document.getElementById('result-placeholder');
const resultContent = document.getElementById('result-content');
const flashOverlay = document.getElementById('flash-overlay');

const historyToggleBtn = document.getElementById('history-toggle-btn');
const historyBadge = document.getElementById('history-badge');
const historySheet = document.getElementById('history-sheet');
const historySheetOverlay = document.getElementById('history-sheet-overlay');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const sheetHandle = document.getElementById('sheet-handle');

// Check for camera devices
async function checkCameraDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        hasMultipleCameras = videoDevices.length > 1;
        
        if (hasMultipleCameras) {
            switchCameraBtn.classList.remove('hidden');
        } else {
            switchCameraBtn.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error listing camera devices:', error);
    }
}

// Start Camera Stream
async function startCamera() {
    showCameraMessage('<i data-lucide="loader-2" class="spin"></i><p>Accessing camera stream...</p>');
    stopCamera();

    const constraints = {
        video: {
            facingMode: currentFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 }
        },
        audio: false
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.setAttribute('playsinline', true); // crucial for iOS
        await video.play();
        
        hideCameraMessage();
        setStatus('Scanning...', 'pulsing');
        isScanning = true;
        updatePauseButtonState();
        
        // Start scanning tick loop
        animationFrameId = requestAnimationFrame(tick);
        lucide.createIcons();
    } catch (err) {
        console.error('Camera access error:', err);
        showCameraMessage(`
            <i data-lucide="camera-off" class="error-text"></i>
            <h3 class="error-text">Camera Access Failed</h3>
            <p>Please grant camera permissions or check if another app is using the camera.</p>
            <button class="pill-btn secondary" onclick="startCamera()" style="margin-top: 10px;">Try Again</button>
        `);
        setStatus('Camera Error', 'error');
        lucide.createIcons();
    }
}

// Stop Camera Stream
function stopCamera() {
    isScanning = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    video.srcObject = null;
}

// Update Status indicators
function setStatus(text, type) {
    statusText.textContent = text;
    statusDot.className = 'status-dot';
    
    if (type === 'pulsing') {
        statusDot.classList.add('pulsing');
        statusDot.style.backgroundColor = '#30d158'; // Green
    } else if (type === 'paused') {
        statusDot.style.backgroundColor = '#ff9f0a'; // Orange
    } else if (type === 'error') {
        statusDot.style.backgroundColor = '#ff453a'; // Red
    } else {
        statusDot.style.backgroundColor = '#86868b'; // Muted Gray
    }
}

// Show overlay camera message
function showCameraMessage(htmlContent) {
    cameraMessage.innerHTML = htmlContent;
    cameraMessage.classList.remove('hidden');
}

// Hide overlay camera message
function hideCameraMessage() {
    cameraMessage.classList.add('hidden');
}

// The core scanning tick loop
function tick() {
    if (!isScanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // Match canvas dimensions to video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
            handleScanSuccess(code.data);
            return; // stop execution loop since we got a code
        }
    }
    animationFrameId = requestAnimationFrame(tick);
}

// Handle scan success trigger
function handleScanSuccess(data) {
    // Vibrate device (haptic vibe)
    if (navigator.vibrate) {
        navigator.vibrate([80]);
    }

    // Flash animation
    flashOverlay.classList.add('active');
    setTimeout(() => {
        flashOverlay.classList.remove('active');
    }, 120);

    // Pause scanning state
    isScanning = false;
    setStatus('Scan Complete', 'paused');
    updatePauseButtonState();

    // Parse data & render smart card
    const parsed = parseQRData(data);
    renderResultCard(parsed);
    
    // Add to history
    addToHistory(parsed);
}

// Parsing logic for QR data
function parseQRData(rawText) {
    const text = rawText.trim();
    
    // WiFi Check
    if (text.toUpperCase().startsWith('WIFI:')) {
        const wifiData = parseWiFi(text);
        if (wifiData) {
            return {
                type: 'wifi',
                raw: text,
                title: wifiData.ssid || 'WiFi Network',
                subtitle: `Secured via ${wifiData.type || 'WPA/WEP'}`,
                details: wifiData
            };
        }
    }
    
    // vCard Contact Check
    if (text.toUpperCase().includes('BEGIN:VCARD') && text.toUpperCase().includes('END:VCARD')) {
        const contactData = parseVCard(text);
        if (contactData) {
            return {
                type: 'contact',
                raw: text,
                title: contactData.name || 'vCard Contact',
                subtitle: contactData.phone || contactData.email || 'Contact Info',
                details: contactData
            };
        }
    }
    
    // URL Check
    if (isValidURL(text)) {
        let cleanURL = text;
        if (!/^https?:\/\//i.test(text)) {
            cleanURL = 'https://' + text;
        }
        try {
            const urlObj = new URL(cleanURL);
            return {
                type: 'url',
                raw: text,
                title: urlObj.hostname.replace('www.', ''),
                subtitle: text,
                details: {
                    href: cleanURL,
                    host: urlObj.hostname,
                    pathname: urlObj.pathname
                }
            };
        } catch(e) {}
    }
    
    // Fallback: Plain Text
    return {
        type: 'text',
        raw: text,
        title: 'Plain Text Scan',
        subtitle: text,
        details: {
            text: text
        }
    };
}

// WiFi Config String Parser
function parseWiFi(text) {
    const clean = text.substring(5);
    const result = { ssid: '', type: 'WPA', password: '', hidden: false };
    
    let current = "";
    const parts = [];
    
    for (let i = 0; i < clean.length; i++) {
        // Split by semicolons, but skip escaped semicolons
        if (clean[i] === ';' && (i === 0 || clean[i-1] !== '\\')) {
            parts.push(current);
            current = "";
        } else {
            current += clean[i];
        }
    }
    
    parts.forEach(part => {
        const colonIdx = part.indexOf(':');
        if (colonIdx > -1) {
            const key = part.substring(0, colonIdx);
            const val = part.substring(colonIdx + 1).replace(/\\;/g, ';').replace(/\\:/g, ':').replace(/\\,/g, ',');
            
            if (key === 'S') result.ssid = val;
            else if (key === 'T') result.type = val;
            else if (key === 'P') result.password = val;
            else if (key === 'H') result.hidden = val === 'true';
        }
    });
    
    return result;
}

// vCard Parser
function parseVCard(text) {
    const result = { name: '', phone: '', email: '', org: '', url: '', formattedAddr: '' };
    const lines = text.split(/\r?\n/);
    
    lines.forEach(line => {
        const upperLine = line.toUpperCase();
        if (upperLine.startsWith('FN:')) {
            result.name = line.substring(3).trim();
        } else if (upperLine.startsWith('N:') && !result.name) {
            const parts = line.substring(2).split(';');
            result.name = parts.filter(Boolean).reverse().join(' ').trim();
        } else if (upperLine.startsWith('TEL')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > -1) result.phone = line.substring(colonIdx + 1).trim();
        } else if (upperLine.startsWith('EMAIL')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > -1) result.email = line.substring(colonIdx + 1).trim();
        } else if (upperLine.startsWith('ORG')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > -1) result.org = line.substring(colonIdx + 1).trim();
        } else if (upperLine.startsWith('URL')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > -1) result.url = line.substring(colonIdx + 1).trim();
        } else if (upperLine.startsWith('ADR')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > -1) {
                const parts = line.substring(colonIdx + 1).split(';');
                result.formattedAddr = parts.filter(Boolean).join(', ').trim();
            }
        }
    });
    
    if (!result.name) {
        if (result.phone || result.email) {
            result.name = "vCard Contact";
        } else {
            return null;
        }
    }
    
    return result;
}

// URL Validator
function isValidURL(str) {
    const pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
      '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name
      '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
      '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
      '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
      '(\\#[-a-z\\d_]*)?$','i'); // fragment locator
    return !!pattern.test(str);
}

// Render dynamic results card
function renderResultCard(parsed) {
    resultPlaceholder.classList.add('hidden');
    resultContent.className = `result-card type-${parsed.type}`;
    resultContent.innerHTML = ''; // Clear prior content

    let cardIconHTML = '';
    let detailsHTML = '';

    // Assign type icons
    if (parsed.type === 'url') cardIconHTML = '<i data-lucide="globe"></i>';
    else if (parsed.type === 'wifi') cardIconHTML = '<i data-lucide="wifi"></i>';
    else if (parsed.type === 'contact') cardIconHTML = '<i data-lucide="user"></i>';
    else cardIconHTML = '<i data-lucide="file-text"></i>';

    // Build smart detail layout
    if (parsed.type === 'url') {
        detailsHTML = `
            <div class="rich-detail-wrapper">
                <div class="rich-header">
                    <div>
                        <span class="rich-type-badge">Website URL</span>
                        <h2 class="rich-title">${parsed.title}</h2>
                    </div>
                    <div class="card-icon">${cardIconHTML}</div>
                </div>
                <div class="rich-subtitle">${parsed.subtitle}</div>
                <div class="rich-actions">
                    <a href="${parsed.details.href}" target="_blank" class="pill-btn primary">
                        <i data-lucide="external-link"></i> Open Website
                    </a>
                    <button class="pill-btn secondary" onclick="copyToClipboard('${parsed.raw}')">
                        <i data-lucide="copy"></i> Copy Link
                    </button>
                </div>
            </div>
        `;
    } 
    else if (parsed.type === 'wifi') {
        const ssid = parsed.details.ssid;
        const pass = parsed.details.password;
        const security = parsed.details.type || 'None';
        
        detailsHTML = `
            <div class="rich-detail-wrapper">
                <div class="rich-header">
                    <div>
                        <span class="rich-type-badge">WiFi Configuration</span>
                        <h2 class="rich-title">${ssid}</h2>
                    </div>
                    <div class="card-icon">${cardIconHTML}</div>
                </div>
                
                <div class="rich-meta-grid">
                    <div class="meta-item">
                        <span class="meta-label">SSID</span>
                        <span class="meta-val">${ssid}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Security</span>
                        <span class="meta-val">${security}</span>
                    </div>
                    ${pass ? `
                    <div class="meta-item" style="grid-column: span 2;">
                        <span class="meta-label">Password</span>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                            <span class="meta-val" id="wifi-pass-display">••••••••</span>
                            <button class="text-btn" onclick="toggleWifiPassword('${pass}')" style="font-size: 11px;">Show</button>
                        </div>
                    </div>
                    ` : ''}
                </div>

                <div class="rich-actions">
                    ${pass ? `
                    <button class="pill-btn primary" onclick="copyToClipboard('${pass}')">
                        <i data-lucide="key-round"></i> Copy Password
                    </button>
                    ` : ''}
                    <button class="pill-btn secondary" onclick="copyToClipboard('${parsed.raw}')">
                        <i data-lucide="copy"></i> Copy Config
                    </button>
                </div>
            </div>
        `;
    } 
    else if (parsed.type === 'contact') {
        const name = parsed.details.name;
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        detailsHTML = `
            <div class="rich-detail-wrapper">
                <div class="rich-header">
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <div class="contact-avatar" style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, var(--color-contact), #ff453a); display: flex; justify-content: center; align-items: center; font-weight: 700; color: white; font-size: 14px;">
                            ${initials}
                        </div>
                        <div>
                            <span class="rich-type-badge">Contact Card</span>
                            <h2 class="rich-title">${name}</h2>
                        </div>
                    </div>
                    <div class="card-icon">${cardIconHTML}</div>
                </div>

                <div class="rich-meta-grid">
                    ${parsed.details.phone ? `
                    <div class="meta-item">
                        <span class="meta-label">Phone</span>
                        <span class="meta-val">${parsed.details.phone}</span>
                    </div>` : ''}
                    ${parsed.details.email ? `
                    <div class="meta-item">
                        <span class="meta-label">Email</span>
                        <span class="meta-val">${parsed.details.email}</span>
                    </div>` : ''}
                    ${parsed.details.org ? `
                    <div class="meta-item" style="grid-column: span 2;">
                        <span class="meta-label">Company</span>
                        <span class="meta-val">${parsed.details.org}</span>
                    </div>` : ''}
                </div>

                <div class="rich-actions">
                    <button class="pill-btn primary" onclick="downloadContactVCard('${parsed.raw.replace(/'/g, "\\'")}', '${name}')">
                        <i data-lucide="user-plus"></i> Save Contact
                    </button>
                    ${parsed.details.phone ? `
                    <a href="tel:${parsed.details.phone}" class="pill-btn secondary" style="flex: 0; width: 44px; padding: 0;">
                        <i data-lucide="phone"></i>
                    </a>` : ''}
                    ${parsed.details.email ? `
                    <a href="mailto:${parsed.details.email}" class="pill-btn secondary" style="flex: 0; width: 44px; padding: 0;">
                        <i data-lucide="mail"></i>
                    </a>` : ''}
                </div>
            </div>
        `;
    } 
    else {
        // Plain text card
        detailsHTML = `
            <div class="rich-detail-wrapper">
                <div class="rich-header">
                    <div>
                        <span class="rich-type-badge">Plain Text Data</span>
                        <h2 class="rich-title">${parsed.title}</h2>
                    </div>
                    <div class="card-icon">${cardIconHTML}</div>
                </div>
                <div class="rich-subtitle" style="white-space: pre-wrap; font-family: monospace; max-height: 120px; background: rgba(0,0,0,0.15); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.03); margin: 4px 0;">${parsed.subtitle}</div>
                <div class="rich-actions">
                    <button class="pill-btn primary" onclick="copyToClipboard('${parsed.raw.replace(/'/g, "\\'")}')">
                        <i data-lucide="copy"></i> Copy Text
                    </button>
                </div>
            </div>
        `;
    }

    resultContent.innerHTML = detailsHTML;
    resultContent.classList.remove('hidden');
    
    // Scan Another code overlay prompt
    if (pauseScannerBtn.classList.contains('paused') === false) {
        pauseScannerBtn.innerHTML = '<i data-lucide="play"></i><span>Scan Again</span>';
        pauseScannerBtn.className = 'pill-btn primary pulsing-btn';
    }

    lucide.createIcons();
}

// Copy clipboard utility
function copyToClipboard(val) {
    navigator.clipboard.writeText(val).then(() => {
        // Show temp toast or visual indication
        const prevStatusText = statusText.textContent;
        const prevStatusDotStyle = statusDot.style.backgroundColor;
        
        setStatus('Copied to Clipboard!', 'copied');
        statusDot.style.backgroundColor = 'var(--color-secondary)';
        
        setTimeout(() => {
            statusText.textContent = prevStatusText;
            statusDot.style.backgroundColor = prevStatusDotStyle;
        }, 1500);
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

// Toggle WiFi password visibility
let wifiPassVisible = false;
function toggleWifiPassword(pass) {
    const el = document.getElementById('wifi-pass-display');
    const btn = el.nextElementSibling;
    wifiPassVisible = !wifiPassVisible;
    if (wifiPassVisible) {
        el.textContent = pass;
        btn.textContent = 'Hide';
    } else {
        el.textContent = '••••••••';
        btn.textContent = 'Show';
    }
}

// Download vCard (.vcf) helper
function downloadContactVCard(vCardText, name) {
    const cleanName = name.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
    const blob = new Blob([vCardText], { type: "text/vcard;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `${cleanName}.vcf`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Tab Switcher handler
function switchTab(tabName) {
    if (tabName === 'camera') {
        tabCamera.classList.add('active');
        tabUpload.classList.remove('active');
        viewCamera.classList.add('active');
        viewUpload.classList.remove('active');
        tabSlider.style.left = '3px';
        startCamera();
    } else {
        tabCamera.classList.remove('active');
        tabUpload.classList.add('active');
        viewCamera.classList.remove('active');
        viewUpload.classList.add('active');
        tabSlider.style.left = 'calc(50% - 0px)';
        stopCamera();
        setStatus('Ready to Upload', 'muted');
    }
}

tabCamera.addEventListener('click', () => switchTab('camera'));
tabUpload.addEventListener('click', () => switchTab('upload'));

// Flip Camera Facing Mode
switchCameraBtn.addEventListener('click', () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    startCamera();
});

// Pause / Resume Scanning Button
pauseScannerBtn.addEventListener('click', () => {
    if (isScanning) {
        // Pause scan
        isScanning = false;
        setStatus('Scan Paused', 'paused');
        updatePauseButtonState();
    } else {
        // Resume scan
        isScanning = true;
        setStatus('Scanning...', 'pulsing');
        updatePauseButtonState();
        
        // Reset Result display back to placeholder
        resultContent.classList.add('hidden');
        resultPlaceholder.classList.remove('hidden');

        // Restart animation frame loop
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(tick);
        }
    }
});

function updatePauseButtonState() {
    if (isScanning) {
        pauseScannerBtn.innerHTML = '<i data-lucide="pause"></i><span>Pause Scan</span>';
        pauseScannerBtn.className = 'pill-btn secondary';
    } else {
        pauseScannerBtn.innerHTML = '<i data-lucide="play"></i><span>Resume Scan</span>';
        pauseScannerBtn.className = 'pill-btn primary';
    }
    lucide.createIcons();
}

// File Drop Zone Scanning Logic
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        processUploadedFile(e.dataTransfer.files[0]);
    }
});

selectFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        processUploadedFile(e.target.files[0]);
    }
});

function processUploadedFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please drop/upload a valid image file containing a QR code.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        uploadPreview.src = e.target.result;
        uploadPreviewContainer.classList.remove('hidden');
        
        const img = new Image();
        img.onload = () => {
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            tempCtx.drawImage(img, 0, 0);
            
            const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const decoded = jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: "dontInvert",
            });
            
            if (decoded && decoded.data) {
                handleScanSuccess(decoded.data);
            } else {
                setStatus('Scan Failed', 'error');
                resultPlaceholder.classList.add('hidden');
                resultContent.className = 'result-card type-text';
                resultContent.innerHTML = `
                    <div class="rich-detail-wrapper">
                        <div class="rich-header">
                            <div>
                                <span class="rich-type-badge" style="background: rgba(255, 69, 58, 0.15); color: #ff453a; border-color: rgba(255, 69, 58, 0.2);">No QR Detected</span>
                                <h2 class="rich-title">Scanning Failed</h2>
                            </div>
                            <div class="card-icon" style="background: rgba(255, 69, 58, 0.1); color: #ff453a;"><i data-lucide="alert-circle"></i></div>
                        </div>
                        <div class="rich-subtitle">AuraScan couldn't find a readable QR code. Try an image with higher contrast or clear focus.</div>
                    </div>
                `;
                lucide.createIcons();
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

clearUploadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    uploadPreviewContainer.classList.add('hidden');
    uploadPreview.src = '';
    fileInput.value = '';
    
    // Reset Result
    resultContent.classList.add('hidden');
    resultPlaceholder.classList.remove('hidden');
    setStatus('Ready to Upload', 'muted');
});

// Scan History Management
function addToHistory(parsedItem) {
    const newItem = {
        id: Date.now().toString(),
        type: parsedItem.type,
        title: parsedItem.title,
        subtitle: parsedItem.subtitle,
        raw: parsedItem.raw,
        timestamp: Date.now()
    };
    
    // Avoid duplicating consecutive identical scans in history
    if (scanHistory.length > 0 && scanHistory[0].raw === newItem.raw) {
        // Move to top if scanned again
        scanHistory = [newItem, ...scanHistory.filter(i => i.raw !== newItem.raw)];
    } else {
        scanHistory.unshift(newItem);
    }
    
    // Limit to 40 entries
    if (scanHistory.length > 40) {
        scanHistory.pop();
    }
    
    localStorage.setItem('aura_scan_history', JSON.stringify(scanHistory));
    updateHistoryUI();
}

function updateHistoryUI() {
    const count = scanHistory.length;
    if (count > 0) {
        historyBadge.textContent = count;
        historyBadge.classList.remove('hidden');
        historyList.innerHTML = '';
        historyEmpty.classList.add('hidden');
        
        scanHistory.forEach(item => {
            const el = document.createElement('div');
            el.className = `history-item type-${item.type}`;
            
            let iconHTML = '';
            if (item.type === 'url') iconHTML = '<i data-lucide="globe"></i>';
            else if (item.type === 'wifi') iconHTML = '<i data-lucide="wifi"></i>';
            else if (item.type === 'contact') iconHTML = '<i data-lucide="user"></i>';
            else iconHTML = '<i data-lucide="file-text"></i>';

            el.innerHTML = `
                <div class="history-item-icon">${iconHTML}</div>
                <div class="history-item-details">
                    <div class="history-item-title">${item.title}</div>
                    <div class="history-item-time">${formatTime(item.timestamp)}</div>
                </div>
                <button class="history-item-delete" aria-label="Delete item">
                    <i data-lucide="trash-2"></i>
                </button>
            `;
            
            // Show item details on click
            el.addEventListener('click', (e) => {
                if (e.target.closest('.history-item-delete')) {
                    e.stopPropagation();
                    deleteHistoryItem(item.id);
                } else {
                    const parsed = parseQRData(item.raw);
                    renderResultCard(parsed);
                    closeHistory();
                }
            });
            
            historyList.appendChild(el);
        });
        
    } else {
        historyBadge.classList.add('hidden');
        historyList.innerHTML = '';
        historyEmpty.classList.remove('hidden');
    }
    lucide.createIcons();
}

function deleteHistoryItem(id) {
    scanHistory = scanHistory.filter(item => item.id !== id);
    localStorage.setItem('aura_scan_history', JSON.stringify(scanHistory));
    updateHistoryUI();
}

// Clear History Button
clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Clear your entire scan history?')) {
        scanHistory = [];
        localStorage.setItem('aura_scan_history', JSON.stringify(scanHistory));
        updateHistoryUI();
    }
});

// Relative timestamp formatter
function formatTime(timestamp) {
    const diffMs = Date.now() - timestamp;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffSecs < 10) return 'Just now';
    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Bottom Sheet Open / Close Management
function openHistory() {
    updateHistoryUI();
    historySheetOverlay.classList.add('active');
    historySheet.classList.add('active');
}

function closeHistory() {
    historySheetOverlay.classList.remove('active');
    historySheet.classList.remove('active');
    historySheet.style.transform = ''; // reset drag style
}

historyToggleBtn.addEventListener('click', openHistory);
historySheetOverlay.addEventListener('click', closeHistory);

// Slide gesture drag to dismiss
let startY = 0;
let currentY = 0;
let isDragging = false;

sheetHandle.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    isDragging = true;
    historySheet.style.transition = 'none'; // Disable transition during drag
    sheetHandle.setPointerCapture(e.pointerId);
});

sheetHandle.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const deltaY = e.clientY - startY;
    if (deltaY > 0) {
        historySheet.style.transform = `translate(-50%, ${deltaY}px)`;
        currentY = deltaY;
    }
});

sheetHandle.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    historySheet.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    sheetHandle.releasePointerCapture(e.pointerId);
    
    if (currentY > 120) {
        closeHistory();
    } else {
        historySheet.style.transform = 'translate(-50%, 0)';
    }
    currentY = 0;
});

// Window startup Initialization
window.addEventListener('DOMContentLoaded', () => {
    // Check cameras & initialize Lucide icons
    checkCameraDevices();
    lucide.createIcons();
    
    // Display initial history badge count
    updateHistoryUI();
    
    // Automatically start webcam if the user is on camera tab (default)
    startCamera();
});

// Pause camera when document is hidden (minimize battery/camera usage)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (tabCamera.classList.contains('active')) {
            stopCamera();
        }
    } else {
        if (tabCamera.classList.contains('active')) {
            startCamera();
        }
    }
});
