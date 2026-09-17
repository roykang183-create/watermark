/**
 * SecureStamp - Client-Side PDF Watermark Overlay Engine
 * 100% In-Memory Local Processing (No server uploads)
 */

// Initialize Lucide Icons
function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Application State
const state = {
  files: [], // Array of { id, name, size, pageCount, arrayBuffer, pdfJsDoc }
  selectedFileId: null,
  currentPage: 1,
  totalPages: 1,
  zoomScale: 1.0,
  theme: 'dark',
  koreanFontBytes: null,
  fontLoadStatus: 'pending', // 'pending', 'loaded', 'failed'
  
  // Watermark Settings
  watermark: {
    name: '홍길동 (보안운영팀)',
    ip: '192.168.1.105',
    timestamp: '',
    notice: '무단 복제 및 외부 유출 금지',
    autoTime: true,
    fontSize: 9,
    opacity: 0.25,
    angle: -30,
    density: 1, // 1: 조밀하게(140px), 2: 보통(200px), 3: 넓게(260px)
    color: '#555555'
  }
};

// Setup PDF.js worker
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// DOM Elements
const dom = {
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIcon: document.getElementById('themeIcon'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  samplePdfBtn: document.getElementById('samplePdfBtn'),
  previewSampleBtn: document.getElementById('previewSampleBtn'),
  
  userNameInput: document.getElementById('userNameInput'),
  userIpInput: document.getElementById('userIpInput'),
  refreshIpBtn: document.getElementById('refreshIpBtn'),
  timestampInput: document.getElementById('timestampInput'),
  autoTimeBtn: document.getElementById('autoTimeBtn'),
  customNoticeInput: document.getElementById('customNoticeInput'),
  
  fontSizeRange: document.getElementById('fontSizeRange'),
  fontSizeVal: document.getElementById('fontSizeVal'),
  opacityRange: document.getElementById('opacityRange'),
  opacityVal: document.getElementById('opacityVal'),
  angleRange: document.getElementById('angleRange'),
  angleVal: document.getElementById('angleVal'),
  densityRange: document.getElementById('densityRange'),
  densityVal: document.getElementById('densityVal'),
  resetStyleBtn: document.getElementById('resetStyleBtn'),
  colorSwatches: document.querySelectorAll('.color-swatch'),
  
  fileCount: document.getElementById('fileCount'),
  fileQueueEmpty: document.getElementById('fileQueueEmpty'),
  fileQueueList: document.getElementById('fileQueueList'),
  clearAllFilesBtn: document.getElementById('clearAllFilesBtn'),
  
  previewViewport: document.getElementById('previewViewport'),
  previewPlaceholder: document.getElementById('previewPlaceholder'),
  canvasWrapper: document.getElementById('canvasWrapper'),
  previewCanvas: document.getElementById('previewCanvas'),
  renderingOverlay: document.getElementById('renderingOverlay'),
  previewSubText: document.getElementById('previewSubText'),
  watermarkPreviewSnippet: document.getElementById('watermarkPreviewSnippet'),
  
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomFitBtn: document.getElementById('zoomFitBtn'),
  zoomLevel: document.getElementById('zoomLevel'),
  pageNavControls: document.getElementById('pageNavControls'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  pageIndicator: document.getElementById('pageIndicator'),
  
  batchStatusText: document.getElementById('batchStatusText'),
  downloadCurrentPdfBtn: document.getElementById('downloadCurrentPdfBtn'),
  downloadBatchZipBtn: document.getElementById('downloadBatchZipBtn'),
  
  progressModal: document.getElementById('progressModal'),
  modalTitle: document.getElementById('modalTitle'),
  modalSub: document.getElementById('modalSub'),
  progressBarFill: document.getElementById('progressBarFill'),
  progressDetail: document.getElementById('progressDetail'),
  progressPercent: document.getElementById('progressPercent')
};

// ==========================================================================
// 1. Korean Font Preloading (For TrueType embedding in pdf-lib)
// ==========================================================================
const FONT_URLS = [
  // Fast CJK Korean Web Font (OTF/TTF format for fontkit)
  'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.1/GmarketSansMedium.woff',
  'https://fonts.gstatic.com/ea/notosanskr/v2/NotoSansKR-Regular.otf'
];

async function loadKoreanFont() {
  // Try loading a lightweight, reliable Korean font
  const candidateUrls = [
    // Nanum Gothic or Noto Sans TTF/OTF subset
    'https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans@gh-pages/subset/SpoqaHanSans/SpoqaHanSansRegular.ttf',
    'https://fonts.gstatic.com/ea/notosanskr/v2/NotoSansKR-Regular.otf'
  ];

  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url, { cache: 'force-cache' });
      if (resp.ok) {
        state.koreanFontBytes = await resp.arrayBuffer();
        state.fontLoadStatus = 'loaded';
        console.log('[SecureStamp] Korean font loaded successfully:', url);
        return;
      }
    } catch (err) {
      console.warn('[SecureStamp] Font download attempt failed from', url, err);
    }
  }
  state.fontLoadStatus = 'failed';
  console.warn('[SecureStamp] Unable to load external Korean font. Fallback standard fonts will be used.');
}

// ==========================================================================
// 2. Timestamp & IP Utilities
// ==========================================================================
function formatCurrentTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${date} ${hours}:${mins}:${secs}`;
}

function updateTimestamp() {
  if (state.watermark.autoTime) {
    const formatted = formatCurrentTime();
    state.watermark.timestamp = formatted;
    if (dom.timestampInput) dom.timestampInput.value = formatted;
    updateSnippetText();
    schedulePreviewRedraw();
  }
}

async function detectClientIp() {
  dom.userIpInput.placeholder = 'IP 감지 중...';
  
  // 1. Try public IP lookup
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ip) {
        state.watermark.ip = data.ip;
        dom.userIpInput.value = data.ip;
        updateSnippetText();
        schedulePreviewRedraw();
        return;
      }
    }
  } catch (e) {
    console.log('[SecureStamp] Public IP lookup skipped or timed out.');
  }

  // 2. Fallback to plausible local office IP
  if (!state.watermark.ip || state.watermark.ip === '감지 중...') {
    state.watermark.ip = '192.168.1.105';
    dom.userIpInput.value = state.watermark.ip;
  }
  updateSnippetText();
  schedulePreviewRedraw();
}

function updateSnippetText() {
  const time = state.watermark.timestamp || formatCurrentTime();
  const ip = state.watermark.ip || '127.0.0.1';
  const name = state.watermark.name || '출력자 미지정';
  const notice = state.watermark.notice ? ` [우측상단: ${state.watermark.notice}]` : '';
  dom.watermarkPreviewSnippet.textContent = `[${time}] IP: ${ip} | ${name}${notice}`;
}

// ==========================================================================
// 3. File Queue Management
// ==========================================================================
async function handleFilesUpload(filesList) {
  const validFiles = Array.from(filesList).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  
  if (validFiles.length === 0) {
    alert('선택된 파일 중 PDF 형식이 없습니다. 올바른 PDF 파일을 업로드해주세요.');
    return;
  }

  for (const file of validFiles) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      // Load with PDF.js to get page count and enable rendering
      const pdfJsDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      
      const fileRecord = {
        id: 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        name: file.name,
        size: formatBytes(file.size),
        pageCount: pdfJsDoc.numPages,
        arrayBuffer: arrayBuffer,
        pdfJsDoc: pdfJsDoc
      };

      state.files.push(fileRecord);
    } catch (err) {
      console.error('Failed to load PDF file:', file.name, err);
      alert(`'${file.name}' 파일을 읽는 중 오류가 발생했습니다.`);
    }
  }

  if (!state.selectedFileId && state.files.length > 0) {
    selectFile(state.files[0].id);
  }

  renderFileList();
  updateActionButtons();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function selectFile(id) {
  state.selectedFileId = id;
  state.currentPage = 1;
  const file = state.files.find(f => f.id === id);
  if (file) {
    state.totalPages = file.pageCount;
    dom.pageIndicator.textContent = `${state.currentPage} / ${state.totalPages}`;
    dom.pageNavControls.style.display = file.pageCount > 1 ? 'flex' : 'none';
    dom.previewSubText.textContent = `'${file.name}' (${file.pageCount} 페이지 중 ${state.currentPage}페이지 미리보기)`;
  }
  renderFileList();
  updateActionButtons();
  schedulePreviewRedraw({ redrawBasePage: true });
}

function removeFile(id, event) {
  if (event) event.stopPropagation();
  state.files = state.files.filter(f => f.id !== id);
  
  if (state.selectedFileId === id) {
    state.selectedFileId = state.files.length > 0 ? state.files[0].id : null;
    state.currentPage = 1;
  }
  
  renderFileList();
  updateActionButtons();
  schedulePreviewRedraw({ redrawBasePage: true });
}

function clearAllFiles() {
  if (state.files.length === 0) return;
  if (confirm('등록된 모든 문서를 목록에서 제거하시겠습니까?')) {
    state.files = [];
    state.selectedFileId = null;
    renderFileList();
    updateActionButtons();
    schedulePreviewRedraw({ redrawBasePage: true });
  }
}

function renderFileList() {
  dom.fileCount.textContent = state.files.length;
  
  if (state.files.length === 0) {
    dom.fileQueueEmpty.style.display = 'block';
    dom.fileQueueList.innerHTML = '';
    dom.clearAllFilesBtn.style.display = 'none';
    return;
  }

  dom.fileQueueEmpty.style.display = 'none';
  dom.clearAllFilesBtn.style.display = 'inline-flex';
  dom.fileQueueList.innerHTML = '';

  state.files.forEach(file => {
    const li = document.createElement('li');
    li.className = `file-queue-item ${file.id === state.selectedFileId ? 'active' : ''}`;
    li.onclick = () => selectFile(file.id);

    li.innerHTML = `
      <i data-lucide="file-text" class="file-item-icon"></i>
      <div class="file-item-info">
        <div class="file-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
        <div class="file-item-meta">
          <span>${file.size}</span>
          <span>•</span>
          <span>${file.pageCount} 페이지</span>
        </div>
      </div>
      <div class="file-item-actions">
        <button type="button" class="btn-item-action" title="이 파일 즉시 워터마크 PDF 다운로드" onclick="downloadSinglePdfById('${file.id}', event)">
          <i data-lucide="download"></i>
        </button>
        <button type="button" class="btn-item-action delete" title="제거" onclick="removeFile('${file.id}', event)">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `;

    dom.fileQueueList.appendChild(li);
  });

  refreshIcons();
}

function updateActionButtons() {
  const count = state.files.length;
  const hasSelected = !!state.selectedFileId;

  dom.downloadCurrentPdfBtn.disabled = !hasSelected;
  dom.downloadBatchZipBtn.disabled = count === 0;

  if (count === 0) {
    dom.batchStatusText.textContent = '워터마크를 인자할 PDF 문서를 업로드해 주세요.';
  } else {
    dom.batchStatusText.textContent = `총 ${count}개의 문서 준비 완료 (인쇄 보안 워터마크 적용 준비)`;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================================================
// 4. In-Memory Sample PDF Generator (For Instant Testing)
// ==========================================================================
async function generateSamplePdf() {
  try {
    const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Page 1: Confidential Business Plan Cover
    const page1 = pdfDoc.addPage([595.28, 841.89]); // A4 Size
    const { width, height } = page1.getSize();

    page1.drawRectangle({
      x: 40,
      y: height - 120,
      width: width - 80,
      height: 60,
      color: rgb(0.95, 0.96, 0.98)
    });

    page1.drawText('CONFIDENTIAL REPORT', {
      x: 60,
      y: height - 90,
      size: 18,
      font: helveticaBold,
      color: rgb(0.1, 0.2, 0.4)
    });

    page1.drawText('2026 Global AI Security Strategy & Architecture', {
      x: 60,
      y: height - 110,
      size: 11,
      font: helveticaFont,
      color: rgb(0.3, 0.4, 0.5)
    });

    const bodyParagraphs = [
      '1. Executive Summary',
      'This document contains highly sensitive and proprietary intellectual property.',
      'All rights are reserved. Any unauthorized reproduction, distribution, or dissemination',
      'of this document or its contents without prior written consent is strictly prohibited.',
      '',
      '2. Document Tracking and Compliance',
      'This document is digitally fingerprinted upon printing. Each page is stamped with',
      'the requester identity, network terminal IP address, and timestamp.',
      'Any leak or unauthorized photocopy can be traced directly to the individual operator.',
      '',
      '3. Security Guidelines for Document Handlers',
      '- Do not leave printed copies unattended in common printer trays or meeting rooms.',
      '- Dispose of printed copies in designated secure shredder bins after business review.',
      '- External sharing requires formal clearance from the Chief Information Security Officer.'
    ];

    let currentY = height - 180;
    for (const line of bodyParagraphs) {
      if (line.startsWith('1.') || line.startsWith('2.') || line.startsWith('3.')) {
        page1.drawText(line, { x: 60, y: currentY, size: 13, font: helveticaBold, color: rgb(0.15, 0.2, 0.25) });
      } else {
        page1.drawText(line, { x: 60, y: currentY, size: 10, font: helveticaFont, color: rgb(0.25, 0.25, 0.25) });
      }
      currentY -= 20;
    }

    // Page 2: Financial & Operational Data Table
    const page2 = pdfDoc.addPage([595.28, 841.89]);
    page2.drawText('Appendix: Operational Security Metrics & Audits', {
      x: 60,
      y: height - 80,
      size: 14,
      font: helveticaBold,
      color: rgb(0.1, 0.2, 0.4)
    });

    page2.drawText('Quarterly Access Log & Verification Status Table', {
      x: 60,
      y: height - 100,
      size: 10,
      font: helveticaFont,
      color: rgb(0.4, 0.4, 0.4)
    });

    for (let i = 0; i < 8; i++) {
      const rowY = height - 140 - (i * 30);
      page2.drawRectangle({
        x: 60,
        y: rowY,
        width: width - 120,
        height: 24,
        color: i % 2 === 0 ? rgb(0.96, 0.97, 0.98) : rgb(1, 1, 1),
        borderColor: rgb(0.85, 0.88, 0.92),
        borderWidth: 1
      });
      page2.drawText(`SEC-AUDIT-LOG #2026-00${i + 1}`, { x: 70, y: rowY + 7, size: 9, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
      page2.drawText(`Access Level: RESTRICTED-LEVEL-4`, { x: 260, y: rowY + 7, size: 9, font: helveticaFont, color: rgb(0.3, 0.3, 0.3) });
      page2.drawText(`VERIFIED [PASS]`, { x: 440, y: rowY + 7, size: 8, font: helveticaBold, color: rgb(0.1, 0.6, 0.3) });
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const file = new File([blob], '대외비_보안전략기획서_2026.pdf', { type: 'application/pdf' });
    
    await handleFilesUpload([file]);
  } catch (err) {
    console.error('Failed to create sample PDF:', err);
    alert('샘플 PDF 생성 중 오류가 발생했습니다.');
  }
}

// ==========================================================================
// 5. Canvas Real-Time Preview Engine (With Base Page Caching)
// ==========================================================================
let redrawTimer = null;
let currentRenderTask = null;
let cachedBaseCanvas = null;
let cachedFileId = null;
let cachedPageNum = null;
let cachedScale = null;

function schedulePreviewRedraw(options = { redrawBasePage: false }) {
  if (options.redrawBasePage) {
    cachedBaseCanvas = null;
  }
  if (redrawTimer) cancelAnimationFrame(redrawTimer);
  redrawTimer = requestAnimationFrame(() => {
    drawLivePreview();
  });
}

async function drawLivePreview() {
  const currentFile = state.files.find(f => f.id === state.selectedFileId);
  
  if (!currentFile || !currentFile.pdfJsDoc) {
    dom.previewPlaceholder.style.display = 'block';
    dom.canvasWrapper.style.display = 'none';
    cachedBaseCanvas = null;
    return;
  }

  dom.previewPlaceholder.style.display = 'none';
  dom.canvasWrapper.style.display = 'inline-block';

  try {
    const page = await currentFile.pdfJsDoc.getPage(state.currentPage);
    
    // Viewport calculation with zoom scale
    const baseViewport = page.getViewport({ scale: 1.0 });
    const containerWidth = dom.previewViewport.clientWidth - 80;
    const fitScale = Math.min(1.4, Math.max(0.6, containerWidth / baseViewport.width));
    const finalScale = fitScale * state.zoomScale;
    
    const viewport = page.getViewport({ scale: finalScale });

    const canvas = dom.previewCanvas;
    const ctx = canvas.getContext('2d');

    // Check if we can reuse the cached rendered PDF base page
    const needsBaseRender = !cachedBaseCanvas || 
      cachedFileId !== currentFile.id || 
      cachedPageNum !== state.currentPage || 
      Math.abs(cachedScale - finalScale) > 0.001;

    if (needsBaseRender) {
      // Cancel previous ongoing render task if still active
      if (currentRenderTask) {
        try {
          currentRenderTask.cancel();
        } catch (e) {
          // ignore cancel error
        }
        currentRenderTask = null;
      }

      // Create or resize offscreen base canvas
      if (!cachedBaseCanvas) {
        cachedBaseCanvas = document.createElement('canvas');
      }
      cachedBaseCanvas.width = viewport.width;
      cachedBaseCanvas.height = viewport.height;
      const baseCtx = cachedBaseCanvas.getContext('2d');

      const renderContext = {
        canvasContext: baseCtx,
        viewport: viewport
      };

      currentRenderTask = page.render(renderContext);
      await currentRenderTask.promise;
      currentRenderTask = null;

      cachedFileId = currentFile.id;
      cachedPageNum = state.currentPage;
      cachedScale = finalScale;
    }

    // Set preview canvas dimensions to match viewport
    if (canvas.width !== viewport.width || canvas.height !== viewport.height) {
      canvas.width = viewport.width;
      canvas.height = viewport.height;
    }

    // 1. Draw cached clean PDF base page
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cachedBaseCanvas, 0, 0);

    // 2. Overlay client watermark on top of the base PDF
    renderWatermarkOnCanvas(ctx, canvas.width, canvas.height, finalScale);

  } catch (err) {
    if (err && err.name === 'RenderingCancelledException') {
      // Expected when superseding with a newer redraw request
      return;
    }
    console.error('Canvas preview render error:', err);
  }
}

function renderWatermarkOnCanvas(ctx, canvasWidth, canvasHeight, scale) {
  const { name, ip, timestamp, notice, fontSize, opacity, angle, density, color } = state.watermark;

  // 1. Diagonal repeating grid watermark (only timestamp, IP, operator name)
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const scaledFontSize = fontSize * scale * 1.33;
  ctx.font = `600 ${scaledFontSize}px Pretendard, -apple-system, sans-serif`;

  const line1 = `[인쇄보안] ${timestamp || formatCurrentTime()}`;
  const line2 = `IP: ${ip || '127.0.0.1'} | ${name || '출력자 미지정'}`;
  const lines = [line1, line2];

  const lineHeight = scaledFontSize * 1.4;

  // Spacing based on density setting
  const densityBase = density === 1 ? 130 : (density === 2 ? 190 : 260);
  const stepX = densityBase * scale;
  const stepY = densityBase * scale;

  const rad = (angle * Math.PI) / 180;
  const diag = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight);

  // Translate to center and rotate for diagonal overlay
  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  ctx.rotate(rad);

  const startX = -diag;
  const endX = diag;
  const startY = -diag;
  const endY = diag;

  let rowCount = 0;
  for (let y = startY; y < endY; y += stepY) {
    rowCount++;
    const offsetX = (rowCount % 2 === 0) ? stepX / 2 : 0;

    for (let x = startX + offsetX; x < endX; x += stepX) {
      lines.forEach((txt, idx) => {
        const lineOffsetY = (idx - (lines.length - 1) / 2) * lineHeight;
        ctx.fillText(txt, x, y + lineOffsetY);
      });
    }
  }

  ctx.restore();

  // 2. Top-Right Security Notice Stamp
  if (notice && notice.trim()) {
    ctx.save();
    const noticeText = notice.startsWith('[') ? notice : `[대외비] ${notice}`;
    const badgeFontSize = Math.max(9, Math.round(9.5 * scale));
    ctx.font = `600 ${badgeFontSize}px Pretendard, -apple-system, sans-serif`;

    const textMetrics = ctx.measureText(noticeText);
    const textWidth = textMetrics.width;
    const padX = 10 * scale;
    const padY = 5 * scale;
    const badgeWidth = textWidth + padX * 2;
    const badgeHeight = badgeFontSize + padY * 2;

    const marginX = 22 * scale;
    const marginY = 18 * scale;
    const badgeX = canvasWidth - marginX - badgeWidth;
    const badgeY = marginY;

    // Background
    ctx.globalAlpha = Math.min(0.9, opacity + 0.4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);

    // Border
    const badgeBorderColor = color === '#111111' || color === '#555555' ? '#c0392b' : color;
    ctx.strokeStyle = badgeBorderColor;
    ctx.lineWidth = Math.max(1, 1.2 * scale);
    ctx.strokeRect(badgeX, badgeY, badgeWidth, badgeHeight);

    // Text
    ctx.fillStyle = badgeBorderColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(noticeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2 + (0.5 * scale));

    ctx.restore();
  }
}

// ==========================================================================
// 6. PDF Watermark Baking Engine (pdf-lib)
// ==========================================================================
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  return { r, g, b };
}

async function applyWatermarkToPdfBuffer(srcArrayBuffer, onProgress) {
  const { PDFDocument, rgb, degrees, StandardFonts } = window.PDFLib;
  
  const pdfDoc = await PDFDocument.load(srcArrayBuffer.slice(0));

  // Try embedding Korean font if loaded and fontkit is available
  let customFont = null;
  if (window.fontkit && state.koreanFontBytes && state.fontLoadStatus === 'loaded') {
    try {
      pdfDoc.registerFontkit(window.fontkit);
      customFont = await pdfDoc.embedFont(state.koreanFontBytes, { subset: true });
    } catch (fontErr) {
      console.warn('[SecureStamp] FontKit embedding failed. Falling back to Helvetica.', fontErr);
    }
  }

  const fallbackFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontToUse = customFont || fallbackFont;

  const pages = pdfDoc.getPages();
  const totalPages = pages.length;

  const { name, ip, timestamp, notice, fontSize, opacity, angle, density, color } = state.watermark;
  const rgbColor = hexToRgb(color);
  const pdfRgb = rgb(rgbColor.r, rgbColor.g, rgbColor.b);

  // If Korean font is not loaded, sanitize text for Helvetica to avoid WinAnsi errors
  const isKoreanFont = !!customFont;

  const safeName = isKoreanFont ? name : sanitizeToAscii(name, 'User');
  const safeNotice = isKoreanFont ? notice : sanitizeToAscii(notice, 'CONFIDENTIAL');
  const timeStr = timestamp || formatCurrentTime();
  const ipStr = ip || '127.0.0.1';

  const line1 = `[PRINT-SEC] ${timeStr}`;
  const line2 = `IP: ${ipStr} | ${safeName}`;
  const lines = [line1, line2];

  const densityBase = density === 1 ? 130 : (density === 2 ? 190 : 260);

  for (let i = 0; i < totalPages; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const diag = Math.sqrt(width * width + height * height);

    const stepX = densityBase;
    const stepY = densityBase;
    const lineHeight = fontSize * 1.35;

    // Center of page
    const cx = width / 2;
    const cy = height / 2;

    // 1. Diagonal grid repeating watermark
    let rowIdx = 0;
    for (let yRel = -diag; yRel < diag; yRel += stepY) {
      rowIdx++;
      const offset = (rowIdx % 2 === 0) ? stepX / 2 : 0;

      for (let xRel = -diag + offset; xRel < diag; xRel += stepX) {
        const rad = (angle * Math.PI) / 180;
        
        lines.forEach((txt, lIdx) => {
          const lOffsetY = (lIdx - (lines.length - 1) / 2) * lineHeight;
          
          const localX = xRel;
          const localY = yRel + lOffsetY;

          const rotX = cx + (localX * Math.cos(rad) - localY * Math.sin(rad));
          const rotY = cy + (localX * Math.sin(rad) + localY * Math.cos(rad));

          if (rotX >= -100 && rotX <= width + 100 && rotY >= -100 && rotY <= height + 100) {
            try {
              page.drawText(txt, {
                x: rotX,
                y: rotY,
                size: fontSize,
                font: fontToUse,
                color: pdfRgb,
                opacity: opacity,
                rotate: degrees(angle)
              });
            } catch (drawErr) {
              // Ignore encoding character fallbacks gracefully
            }
          }
        });
      }
    }

    // 2. Top-Right Security Notice Stamp
    if (notice && notice.trim()) {
      try {
        const stampText = isKoreanFont 
          ? (notice.startsWith('[') ? notice : `[대외비] ${notice}`) 
          : (safeNotice.startsWith('[') ? safeNotice : `[CONFIDENTIAL] ${safeNotice}`);
        
        const stampFontSize = 8.5;
        let textWidth = stampFontSize * stampText.length * 0.6;
        if (fontToUse && fontToUse.widthOfTextAtSize) {
          try {
            textWidth = fontToUse.widthOfTextAtSize(stampText, stampFontSize);
          } catch (wErr) {
            // fallback estimation
          }
        }

        const padH = 8;
        const padV = 4;
        const boxW = textWidth + padH * 2;
        const boxH = stampFontSize + padV * 2;

        const marginR = 25;
        const marginT = 20;
        const boxX = width - marginR - boxW;
        const boxY = height - marginT - boxH;

        // Stamp Box Border
        page.drawRectangle({
          x: boxX,
          y: boxY,
          width: boxW,
          height: boxH,
          borderColor: pdfRgb,
          borderWidth: 0.8,
          opacity: Math.min(1.0, opacity + 0.35)
        });

        // Stamp Text
        page.drawText(stampText, {
          x: boxX + padH,
          y: boxY + padV + 1,
          size: stampFontSize,
          font: fontToUse,
          color: pdfRgb,
          opacity: Math.min(1.0, opacity + 0.45)
        });
      } catch (stampErr) {
        console.warn('Top-right notice stamp error:', stampErr);
      }
    }

    if (onProgress) {
      onProgress(i + 1, totalPages);
    }
  }

  const finalPdfBytes = await pdfDoc.save();
  return finalPdfBytes;
}

function sanitizeToAscii(str, defaultFallback) {
  if (!str) return '';
  // Check if string contains CJK or non-ascii
  const asciiOnly = str.replace(/[^\x00-\x7F]/g, '');
  return asciiOnly.trim() || defaultFallback;
}

// ==========================================================================
// 7. Download Workflows (Single PDF & Batch ZIP)
// ==========================================================================
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Single PDF Download
async function downloadSinglePdfById(fileId, event) {
  if (event) event.stopPropagation();
  const file = state.files.find(f => f.id === fileId);
  if (!file) return;

  showProgressModal(`'${file.name}' 워터마크 변환 중...`, '문서 페이지에 출력자 정보를 각인하고 있습니다.');

  try {
    const stampedBytes = await applyWatermarkToPdfBuffer(file.arrayBuffer, (curr, total) => {
      updateProgressModal(curr, total, `'${file.name}' (${curr}/${total} 페이지 각인 완료)`);
    });

    const blob = new Blob([stampedBytes], { type: 'application/pdf' });
    const originalNameNoExt = file.name.replace(/\.[^/.]+$/, '');
    const outName = `${originalNameNoExt}_[워터마크_인쇄보안].pdf`;
    
    downloadBlob(blob, outName);
  } catch (err) {
    console.error('Failed to stamp PDF:', err);
    alert('워터마크 적용 중 오류가 발생했습니다: ' + err.message);
  } finally {
    hideProgressModal();
  }
}

// Download Currently Selected PDF
async function downloadCurrentPdf() {
  if (!state.selectedFileId) return;
  await downloadSinglePdfById(state.selectedFileId);
}

// Batch ZIP Download
async function downloadBatchZip() {
  if (state.files.length === 0) return;
  if (!window.JSZip) {
    alert('압축 라이브러리(JSZip)를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
    return;
  }

  showProgressModal('전체 문서 일괄 워터마크 변환 중...', '모든 문서를 로컬 메모리에서 처리하여 ZIP으로 압축합니다.');

  try {
    const zip = new window.JSZip();
    const totalDocs = state.files.length;

    for (let docIdx = 0; docIdx < totalDocs; docIdx++) {
      const file = state.files[docIdx];
      
      updateProgressModal(docIdx, totalDocs, `[${docIdx + 1}/${totalDocs}] '${file.name}' 워터마크 각인 중...`);

      const stampedBytes = await applyWatermarkToPdfBuffer(file.arrayBuffer, (pageCurr, pageTotal) => {
        const subPercent = Math.round(((docIdx + (pageCurr / pageTotal)) / totalDocs) * 100);
        dom.progressPercent.textContent = `${subPercent}%`;
        dom.progressBarFill.style.width = `${subPercent}%`;
        dom.progressDetail.textContent = `문서 ${docIdx + 1}/${totalDocs} (${pageCurr}/${pageTotal} 페이지)`;
      });

      const originalNameNoExt = file.name.replace(/\.[^/.]+$/, '');
      const stampedFileName = `${originalNameNoExt}_[워터마크_인쇄보안].pdf`;
      zip.file(stampedFileName, stampedBytes);
    }

    dom.modalTitle.textContent = 'ZIP 압축 파일 패키징 중...';
    dom.progressDetail.textContent = '클라이언트 메모리 상에서 ZIP 파일 생성 중';

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    }, (meta) => {
      dom.progressPercent.textContent = `${Math.round(meta.percent)}%`;
      dom.progressBarFill.style.width = `${meta.percent}%`;
    });

    const nowStr = formatCurrentTime().replace(/[- :]/g, '').slice(0, 12);
    const zipFileName = `인쇄보안_워터마크_문서_${nowStr}.zip`;
    downloadBlob(zipBlob, zipFileName);

  } catch (err) {
    console.error('Batch ZIP creation failed:', err);
    alert('일괄 압축 생성 중 오류가 발생했습니다: ' + err.message);
  } finally {
    hideProgressModal();
  }
}

// Progress Modal Controls
function showProgressModal(title, sub) {
  dom.modalTitle.textContent = title;
  dom.modalSub.textContent = sub;
  dom.progressBarFill.style.width = '0%';
  dom.progressPercent.textContent = '0%';
  dom.progressDetail.textContent = '준비 중...';
  dom.progressModal.style.display = 'flex';
}

function updateProgressModal(curr, total, detailText) {
  const pct = Math.round((curr / total) * 100);
  dom.progressBarFill.style.width = `${pct}%`;
  dom.progressPercent.textContent = `${pct}%`;
  if (detailText) dom.progressDetail.textContent = detailText;
}

function hideProgressModal() {
  dom.progressModal.style.display = 'none';
}

// ==========================================================================
// 8. Event Listeners & Interactions
// ==========================================================================
function setupEventListeners() {
  // Theme Toggle
  dom.themeToggleBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    dom.themeIcon.setAttribute('data-lucide', state.theme === 'dark' ? 'moon' : 'sun');
    refreshIcons();
  });

  // Drag & Drop
  dom.dropzone.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesUpload(e.target.files);
      dom.fileInput.value = '';
    }
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dom.dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dom.dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.dropzone.classList.remove('dragover');
    });
  });

  dom.dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesUpload(e.dataTransfer.files);
    }
  });

  // Sample PDF Buttons
  dom.samplePdfBtn.addEventListener('click', () => generateSamplePdf());
  dom.previewSampleBtn.addEventListener('click', () => generateSamplePdf());

  // Watermark Form Inputs
  dom.userNameInput.addEventListener('input', (e) => {
    state.watermark.name = e.target.value.trim();
    updateSnippetText();
    schedulePreviewRedraw();
  });

  dom.userIpInput.addEventListener('input', (e) => {
    state.watermark.ip = e.target.value.trim();
    updateSnippetText();
    schedulePreviewRedraw();
  });

  dom.refreshIpBtn.addEventListener('click', () => detectClientIp());

  dom.autoTimeBtn.addEventListener('click', () => {
    state.watermark.autoTime = !state.watermark.autoTime;
    dom.autoTimeBtn.style.color = state.watermark.autoTime ? 'var(--accent-primary)' : 'var(--text-muted)';
    if (state.watermark.autoTime) updateTimestamp();
  });

  dom.customNoticeInput.addEventListener('input', (e) => {
    state.watermark.notice = e.target.value.trim();
    updateSnippetText();
    schedulePreviewRedraw();
  });

  // Range Sliders
  dom.fontSizeRange.addEventListener('input', (e) => {
    state.watermark.fontSize = parseFloat(e.target.value);
    dom.fontSizeVal.textContent = `${state.watermark.fontSize} pt`;
    schedulePreviewRedraw();
  });

  dom.opacityRange.addEventListener('input', (e) => {
    state.watermark.opacity = parseInt(e.target.value, 10) / 100;
    dom.opacityVal.textContent = `${e.target.value}%`;
    schedulePreviewRedraw();
  });

  dom.angleRange.addEventListener('input', (e) => {
    state.watermark.angle = parseInt(e.target.value, 10);
    dom.angleVal.textContent = `${state.watermark.angle}°`;
    schedulePreviewRedraw();
  });

  dom.densityRange.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.watermark.density = val;
    const labels = { 1: '조밀하게', 2: '보통', 3: '넓게' };
    dom.densityVal.textContent = labels[val] || '조밀하게';
    schedulePreviewRedraw();
  });

  // Color Swatches
  dom.colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      dom.colorSwatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      state.watermark.color = swatch.getAttribute('data-color');
      schedulePreviewRedraw();
    });
  });

  // Reset Style
  dom.resetStyleBtn.addEventListener('click', () => {
    dom.fontSizeRange.value = 9;
    dom.fontSizeVal.textContent = '9 pt';
    state.watermark.fontSize = 9;

    dom.opacityRange.value = 25;
    dom.opacityVal.textContent = '25%';
    state.watermark.opacity = 0.25;

    dom.angleRange.value = -30;
    dom.angleVal.textContent = '-30°';
    state.watermark.angle = -30;

    dom.densityRange.value = 1;
    dom.densityVal.textContent = '조밀하게';
    state.watermark.density = 1;

    dom.colorSwatches.forEach((s, idx) => {
      if (idx === 0) s.classList.add('active');
      else s.classList.remove('active');
    });
    state.watermark.color = '#555555';

    schedulePreviewRedraw();
  });

  // Clear Files
  dom.clearAllFilesBtn.addEventListener('click', clearAllFiles);

  // Zoom Controls
  dom.zoomInBtn.addEventListener('click', () => {
    state.zoomScale = Math.min(2.5, state.zoomScale + 0.15);
    dom.zoomLevel.textContent = `${Math.round(state.zoomScale * 100)}%`;
    schedulePreviewRedraw({ redrawBasePage: true });
  });

  dom.zoomOutBtn.addEventListener('click', () => {
    state.zoomScale = Math.max(0.4, state.zoomScale - 0.15);
    dom.zoomLevel.textContent = `${Math.round(state.zoomScale * 100)}%`;
    schedulePreviewRedraw({ redrawBasePage: true });
  });

  dom.zoomFitBtn.addEventListener('click', () => {
    state.zoomScale = 1.0;
    dom.zoomLevel.textContent = '100%';
    schedulePreviewRedraw({ redrawBasePage: true });
  });

  // Page Navigation
  dom.prevPageBtn.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      dom.pageIndicator.textContent = `${state.currentPage} / ${state.totalPages}`;
      schedulePreviewRedraw({ redrawBasePage: true });
    }
  });

  dom.nextPageBtn.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) {
      state.currentPage++;
      dom.pageIndicator.textContent = `${state.currentPage} / ${state.totalPages}`;
      schedulePreviewRedraw({ redrawBasePage: true });
    }
  });

  // Download Actions
  dom.downloadCurrentPdfBtn.addEventListener('click', downloadCurrentPdf);
  dom.downloadBatchZipBtn.addEventListener('click', downloadBatchZip);

  // Window Resize Auto-Redraw
  window.addEventListener('resize', () => {
    schedulePreviewRedraw();
  });
}

// Global functions for inline HTML calls
window.downloadSinglePdfById = downloadSinglePdfById;
window.removeFile = removeFile;

// ==========================================================================
// 9. App Initialization
// ==========================================================================
async function initApp() {
  refreshIcons();
  setupEventListeners();

  // Initialize Clock & Auto-refresh timer
  updateTimestamp();
  setInterval(() => {
    if (state.watermark.autoTime) updateTimestamp();
  }, 1000);

  // Detect IP
  detectClientIp();

  // Preload Korean font asynchronously
  loadKoreanFont().then(() => {
    schedulePreviewRedraw();
  });
}

// Run on DOM ready
document.addEventListener('DOMContentLoaded', initApp);
