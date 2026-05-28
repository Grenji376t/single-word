import { sampleVocabulary } from './sampleData.js';
import { tts } from './tts.js';
import { analyzeTextbookImage, fileToBase64 } from './gemini.js';
// Initialize Firebase via global CDN compat library to prevent esbuild / Vite dependency resolution hang
const firebase = window.firebase;
const firebaseConfig = {
  projectId: "english-palace-srs-1309",
  appId: "1:955961581996:web:d16b0c75d8272e7d2e1a09",
  storageBucket: "english-palace-srs-1309.firebasestorage.app",
  apiKey: "AIzaSyDZAwyhdUXTqYPChrzzLUAMtplikxIJRzo",
  authDomain: "english-palace-srs-1309.firebaseapp.com",
  messagingSenderId: "955961581996"
};

const firebaseApp = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Application State
let currentDeck = 'sample'; // 'sample', 'custom' or 'palace'
let showSyllables = true;   // Default is showing syllables, matching the mockup
let currentSpeedIndex = 0;  // Index in speechRates
const speechRates = [
  { label: '1x', value: 1.0 },
  { label: '0.8x', value: 0.8 },
  { label: '0.6x', value: 0.6 },
  { label: '1.2x', value: 1.2 }
];

let customVocabulary = [];
let selectedFileBlob = null;
let currentSpeakingCard = null;
let englishOnlyMode = false; // '只顯示英文' (English Only) mode state
let chineseOnlyMode = false; // '只顯示中文' (Chinese Only) mode state

// Palace SRS States
let palaceVocabulary = [];
let currentPalaceCard = null;
let syncCode = localStorage.getItem('anki_palace_sync_code') || '';
let palaceSearchQuery = '';
let isSyncing = false;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadApiKey();
  loadCustomVocabulary();
  loadPalaceVocabulary(); // Load Memory Palace
  initEventListeners();
  renderVocabulary();
  updateDeckStats();
  
  // Set default speed rate in TTS manager
  tts.setRate(speechRates[currentSpeedIndex].value);

  // If there's an existing syncCode, run background sync!
  if (syncCode) {
    syncFromCloud(syncCode);
  }
});

// Load Gemini API Key from localStorage
function loadApiKey() {
  const savedKey = localStorage.getItem('gemini_api_key');
  const inputEl = document.getElementById('input-api-key');
  if (savedKey && inputEl) {
    inputEl.value = savedKey;
  }
}

// Load custom user vocabulary from localStorage
function loadCustomVocabulary() {
  try {
    const savedVocab = localStorage.getItem('custom_vocabulary_deck');
    if (savedVocab) {
      customVocabulary = JSON.parse(savedVocab);
    }
  } catch (err) {
    console.error("無法載入自訂單字庫:", err);
    customVocabulary = [];
  }
}

// Save custom vocabulary to localStorage
function saveCustomVocabulary() {
  localStorage.setItem('custom_vocabulary_deck', JSON.stringify(customVocabulary));
}

// Toast notification helper
function showToast(message, isError = false) {
  const toast = document.getElementById('toast-notify');
  const toastMsg = document.getElementById('toast-message');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;
  
  if (isError) {
    toast.classList.add('error');
  } else {
    toast.classList.remove('error');
  }

  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// Setup Event Listeners
function initEventListeners() {
  // Settings Panel Toggle
  const btnTriggerSettings = document.getElementById('btn-trigger-settings');
  const panelSettings = document.getElementById('panel-settings');
  if (btnTriggerSettings && panelSettings) {
    btnTriggerSettings.addEventListener('click', () => {
      panelSettings.classList.toggle('open');
    });
  }

  // Save API Key
  const btnSaveApi = document.getElementById('btn-save-api');
  const inputApiKey = document.getElementById('input-api-key');
  if (btnSaveApi && inputApiKey) {
    btnSaveApi.addEventListener('click', () => {
      const key = inputApiKey.value.trim();
      if (!key) {
        showToast("請輸入有效的 API 金鑰！", true);
        return;
      }
      localStorage.setItem('gemini_api_key', key);
      showToast("金鑰已安全儲存！");
      panelSettings.classList.remove('open');
    });
  }

  // Clear API Key
  const btnClearApi = document.getElementById('btn-clear-api');
  if (btnClearApi && inputApiKey) {
    btnClearApi.addEventListener('click', () => {
      localStorage.removeItem('gemini_api_key');
      inputApiKey.value = '';
      showToast("金鑰已清除！");
    });
  }

  // File and Camera inputs
  const inputCamera = document.getElementById('input-camera');
  const inputFile = document.getElementById('input-file');
  const containerPreview = document.getElementById('container-preview');
  const imgPreview = document.getElementById('img-captured-preview');

  const handleFileSelection = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        showToast("請選擇圖片格式的檔案！", true);
        return;
      }
      
      selectedFileBlob = file;
      const imageUrl = URL.createObjectURL(file);
      
      if (imgPreview && containerPreview) {
        imgPreview.src = imageUrl;
        containerPreview.style.display = 'flex';
        // Scroll down to the preview section smoothly so they see the upload is staged
        containerPreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  if (inputCamera) inputCamera.addEventListener('change', handleFileSelection);
  if (inputFile) inputFile.addEventListener('change', handleFileSelection);

  // Send Image to Gemini for OCR analysis
  const btnStartAnalyze = document.getElementById('btn-start-analyze');
  const loaderOverlay = document.getElementById('loader-overlay');
  
  if (btnStartAnalyze) {
    btnStartAnalyze.addEventListener('click', async () => {
      if (!selectedFileBlob) {
        showToast("尚未選取任何圖片！", true);
        return;
      }

      const apiKey = localStorage.getItem('gemini_api_key');
      if (!apiKey) {
        showToast("請先在上方設定您的 Gemini API 金鑰！", true);
        if (panelSettings) {
          panelSettings.classList.add('open');
          panelSettings.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      // Activate loader spinner
      if (loaderOverlay) loaderOverlay.classList.add('active');

      try {
        const base64String = await fileToBase64(selectedFileBlob);
        const mimeType = selectedFileBlob.type;
        
        // Analyze image using Gemini
        const newWords = await analyzeTextbookImage(base64String, mimeType, apiKey);
        
        if (newWords.length === 0) {
          showToast("未辨識出任何英文單字，請嘗試更清晰的照片！", true);
        } else {
          // Store new words
          customVocabulary = [...newWords, ...customVocabulary];
          saveCustomVocabulary();
          
          // Switch to Custom Tab to show the results
          switchToDeck('custom');
          showToast(`成功分析！已新增 ${newWords.length} 個單字。`);
          
          // Reset file staging and previews
          selectedFileBlob = null;
          if (containerPreview) containerPreview.style.display = 'none';
          if (inputCamera) inputCamera.value = '';
          if (inputFile) inputFile.value = '';
        }
      } catch (err) {
        console.error("分析流程出錯:", err);
        showToast(err.message || "發生未知錯誤，請重試", true);
      } finally {
        if (loaderOverlay) loaderOverlay.classList.remove('active');
      }
    });
  }

  // Toggle Syllables Control ("Tт 音節") - Matches Image 2
  const btnToggleSyllable = document.getElementById('btn-toggle-syllable');
  if (btnToggleSyllable) {
    btnToggleSyllable.addEventListener('click', () => {
      showSyllables = !showSyllables;
      
      // Update UI active state style
      if (showSyllables) {
        btnToggleSyllable.classList.remove('inactive');
      } else {
        btnToggleSyllable.classList.add('inactive');
      }

      // Update visibility on all rendered syllable nodes
      const syllableNodes = document.querySelectorAll('.vocab-syllables');
      syllableNodes.forEach(node => {
        if (showSyllables) {
          node.classList.remove('hidden');
        } else {
          node.classList.add('hidden');
        }
      });
    });
  }

  // Adjust Speed Rate Button ("1x") - Cycles speech rates
  const btnAdjustSpeed = document.getElementById('btn-adjust-speed');
  const speedLabel = document.getElementById('speed-label');
  if (btnAdjustSpeed && speedLabel) {
    btnAdjustSpeed.addEventListener('click', () => {
      currentSpeedIndex = (currentSpeedIndex + 1) % speechRates.length;
      const speedConfig = speechRates[currentSpeedIndex];
      
      // Update TTS rate
      tts.setRate(speedConfig.value);
      
      // Update button label matching mockup (e.g. 1x, 0.8x, 0.6x)
      speedLabel.textContent = speedConfig.label;
      showToast(`發音速度已切換至：${speedConfig.label}`);
    });
  }

  // Toggle English Only Mode ("只顯示英文")
  const btnToggleEnglishOnly = document.getElementById('btn-toggle-english-only');
  const btnToggleChineseOnly = document.getElementById('btn-toggle-chinese-only');

  if (btnToggleEnglishOnly) {
    btnToggleEnglishOnly.addEventListener('click', () => {
      englishOnlyMode = !englishOnlyMode;
      
      if (englishOnlyMode) {
        // Mutual exclusivity: turn off Chinese Only mode
        chineseOnlyMode = false;
        if (btnToggleChineseOnly) btnToggleChineseOnly.classList.remove('active');
        
        btnToggleEnglishOnly.classList.add('active');
        showToast("只顯示英文模式啟動！中文解釋已被遮蔽。");
      } else {
        btnToggleEnglishOnly.classList.remove('active');
        showToast("只顯示英文模式關閉！");
      }

      // Update cards
      const cards = document.querySelectorAll('.vocab-card');
      cards.forEach(card => {
        card.classList.remove('masked-english');
        if (englishOnlyMode) {
          card.classList.add('masked');
        } else {
          card.classList.remove('masked');
        }
      });
    });
  }

  // Toggle Chinese Only Mode ("只顯示中文")
  if (btnToggleChineseOnly) {
    btnToggleChineseOnly.addEventListener('click', () => {
      chineseOnlyMode = !chineseOnlyMode;
      
      if (chineseOnlyMode) {
        // Mutual exclusivity: turn off English Only mode
        englishOnlyMode = false;
        if (btnToggleEnglishOnly) btnToggleEnglishOnly.classList.remove('active');
        
        btnToggleChineseOnly.classList.add('active');
        showToast("只顯示中文模式啟動！英文、音標與音節已被遮蔽。");
      } else {
        btnToggleChineseOnly.classList.remove('active');
        showToast("只顯示中文模式關閉！");
      }

      // Update cards
      const cards = document.querySelectorAll('.vocab-card');
      cards.forEach(card => {
        card.classList.remove('masked');
        if (chineseOnlyMode) {
          card.classList.add('masked-english');
        } else {
          card.classList.remove('masked-english');
        }
      });
    });
  }



  // Deck selector tabs
  const tabSample = document.getElementById('tab-sample');
  const tabCustom = document.getElementById('tab-custom');

  const switchTabHandler = (event) => {
    const deckType = event.currentTarget.getAttribute('data-deck');
    switchToDeck(deckType);
  };

  if (tabSample) tabSample.addEventListener('click', switchTabHandler);
  if (tabCustom) tabCustom.addEventListener('click', switchTabHandler);

  // --- 手動新增單字與刪除上傳單字功能 ---

  // 1. 刪除上傳單字邏輯
  const btnDeleteCustom = document.getElementById('btn-delete-custom');
  if (btnDeleteCustom) {
    btnDeleteCustom.addEventListener('click', () => {
      if (customVocabulary.length === 0) {
        showToast("「我分析的單字」頁面目前已無任何單字！", true);
        return;
      }

      const confirmDelete = confirm("確定要清空所有您上傳或新增的單字嗎？此動作無法復原！");
      if (confirmDelete) {
        customVocabulary = [];
        saveCustomVocabulary();
        
        // 重新渲染並更新統計
        if (currentDeck === 'custom') {
          renderVocabulary();
        }
        updateDeckStats();
        
        showToast("已成功清除所有已分析與手動新增的單字。");
      }
    });
  }

  // 2. 顯示/隱藏手動新增單字 Modal
  const btnManualAdd = document.getElementById('btn-manual-add');
  const modalManualAdd = document.getElementById('modal-manual-add');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelManual = document.getElementById('btn-cancel-manual');
  const formManualAdd = document.getElementById('form-manual-add');

  const openModal = () => {
    if (modalManualAdd) {
      modalManualAdd.classList.add('open');
      modalManualAdd.setAttribute('aria-hidden', 'false');
      // Focus on first input
      const firstInput = document.getElementById('input-manual-word');
      if (firstInput) firstInput.focus();
    }
  };

  const closeModal = () => {
    if (modalManualAdd) {
      modalManualAdd.classList.remove('open');
      modalManualAdd.setAttribute('aria-hidden', 'true');
    }
    if (formManualAdd) {
      formManualAdd.reset();
    }
  };

  if (btnManualAdd) btnManualAdd.addEventListener('click', openModal);
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancelManual) btnCancelManual.addEventListener('click', closeModal);
  
  // 點擊 Modal 背景遮罩也可以關閉
  if (modalManualAdd) {
    modalManualAdd.addEventListener('click', (e) => {
      if (e.target === modalManualAdd) {
        closeModal();
      }
    });
  }

  // 3. 表單送出新增單字
  if (formManualAdd) {
    formManualAdd.addEventListener('submit', (e) => {
      e.preventDefault();

      const wordInput = document.getElementById('input-manual-word');
      const phoneticInput = document.getElementById('input-manual-phonetic');
      const syllablesInput = document.getElementById('input-manual-syllables');
      const explanationInput = document.getElementById('input-manual-explanation');

      if (!wordInput || !explanationInput) return;

      const word = wordInput.value.trim();
      const phonetic = phoneticInput ? phoneticInput.value.trim() : '';
      const syllables = syllablesInput ? syllablesInput.value.trim() : '';
      const explanation = explanationInput.value.trim();

      if (!word || !explanation) {
        showToast("請填寫英文單字與中文解釋！", true);
        return;
      }

      // 建立新的單字卡物件
      const newCard = {
        word,
        phonetic: phonetic || `/${word}/`, // 如果沒填寫音標，給予簡易格式
        syllables: syllables || word,      // 如果沒填音節，預設為原單字
        explanation
      };

      // 加入自訂單字庫最上方
      customVocabulary = [newCard, ...customVocabulary];
      saveCustomVocabulary();

      // 切換至「我分析的單字」頁面，並重新整理
      switchToDeck('custom');
      
      showToast(`已成功手動新增單字卡：「${word}」！`);
      closeModal();
    });
  }

  // --- 記憶宮殿與雲端同步事件監聽器 ---

  // 1. 宮殿 Tab 切換
  const tabPalace = document.getElementById('tab-palace');
  if (tabPalace) {
    tabPalace.addEventListener('click', () => switchToDeck('palace'));
  }

  // 2. 雲端同步金鑰控制
  const btnGenerateSync = document.getElementById('btn-generate-sync');
  if (btnGenerateSync) {
    btnGenerateSync.addEventListener('click', () => {
      const confirmGen = confirm("這將會為您在雲端開設一個新的單字儲存槽，並生成專屬的同步金鑰，確定要啟用嗎？");
      if (confirmGen) {
        const newKey = generateSyncCode();
        syncCode = newKey;
        localStorage.setItem('anki_palace_sync_code', syncCode);
        updateSyncUI();
        syncToCloud();
      }
    });
  }

  const btnEnterSync = document.getElementById('btn-enter-sync');
  const modalSyncEntry = document.getElementById('modal-sync-entry');
  if (btnEnterSync && modalSyncEntry) {
    btnEnterSync.addEventListener('click', () => {
      modalSyncEntry.classList.add('open');
      modalSyncEntry.setAttribute('aria-hidden', 'false');
      const input = document.getElementById('input-sync-code');
      if (input) {
        input.value = '';
        input.focus();
      }
    });
  }

  const btnCloseSyncModal = document.getElementById('btn-close-sync-modal');
  const btnCancelSync = document.getElementById('btn-cancel-sync');
  const closeSyncModal = () => {
    if (modalSyncEntry) {
      modalSyncEntry.classList.remove('open');
      modalSyncEntry.setAttribute('aria-hidden', 'true');
    }
  };
  if (btnCloseSyncModal) btnCloseSyncModal.addEventListener('click', closeSyncModal);
  if (btnCancelSync) btnCancelSync.addEventListener('click', closeSyncModal);
  if (modalSyncEntry) {
    modalSyncEntry.addEventListener('click', (e) => {
      if (e.target === modalSyncEntry) closeSyncModal();
    });
  }

  const formSyncEntry = document.getElementById('form-sync-entry');
  if (formSyncEntry) {
    formSyncEntry.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputSyncCode = document.getElementById('input-sync-code');
      if (inputSyncCode) {
        const entered = inputSyncCode.value.trim().toUpperCase();
        if (!entered.startsWith('ENG-') || entered.length < 9) {
          showToast("請輸入格式正確的同步金鑰！ (如: ENG-XXXX-XXXX)", true);
          return;
        }
        syncFromCloud(entered);
        closeSyncModal();
      }
    });
  }

  const btnCopySyncCode = document.getElementById('btn-copy-sync-code');
  if (btnCopySyncCode) {
    btnCopySyncCode.addEventListener('click', copySyncCode);
  }

  const btnManualSync = document.getElementById('btn-manual-sync');
  if (btnManualSync) {
    btnManualSync.addEventListener('click', () => {
      syncToCloud();
    });
  }

  // 3. 一鍵匯入控制
  const btnImportSample = document.getElementById('btn-import-sample');
  if (btnImportSample) {
    btnImportSample.addEventListener('click', () => {
      const confirmImport = confirm("確定要將所有《課本精選範例》匯入至記憶宮殿中嗎？重疊的英文單字將自動去重！");
      if (confirmImport) {
        importToPalace('sample');
      }
    });
  }

  const btnImportCustom = document.getElementById('btn-import-custom');
  if (btnImportCustom) {
    btnImportCustom.addEventListener('click', () => {
      if (customVocabulary.length === 0) {
        showToast("自訂單字庫中目前沒有單字可供匯入！", true);
        return;
      }
      const confirmImport = confirm("確定要將所有《我分析的單字》匯入至記憶宮殿中嗎？重疊的英文單字將自動去重！");
      if (confirmImport) {
        importToPalace('custom');
      }
    });
  }

  // 4. SRS 卡片交互與評分
  const palaceCardContainer = document.getElementById('palace-card-container');
  if (palaceCardContainer) {
    palaceCardContainer.addEventListener('click', () => {
      const btnShowAnswer = document.getElementById('btn-palace-show-answer');
      if (btnShowAnswer && !btnShowAnswer.classList.contains('hidden')) {
        showPalaceAnswer();
      } else {
        const inner = document.getElementById('palace-card-inner');
        if (inner) inner.classList.toggle('flipped');
      }
    });
  }

  const btnPalaceShowAnswer = document.getElementById('btn-palace-show-answer');
  if (btnPalaceShowAnswer) {
    btnPalaceShowAnswer.addEventListener('click', showPalaceAnswer);
  }

  for (let i = 1; i <= 4; i++) {
    const btnRate = document.getElementById(`btn-rate-${i}`);
    if (btnRate) {
      btnRate.addEventListener('click', () => ratePalaceCard(i));
    }
  }

  const palaceSpeakBtn = document.getElementById('palace-speak-btn');
  if (palaceSpeakBtn) {
    palaceSpeakBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playPalaceSound();
    });
  }

  // 5. 搜尋欄
  const inputPalaceSearch = document.getElementById('input-palace-search');
  if (inputPalaceSearch) {
    inputPalaceSearch.addEventListener('input', (e) => {
      palaceSearchQuery = e.target.value;
      renderPalaceManager();
    });
  }
}

// Helper to switch active vocabulary deck
function switchToDeck(deckType) {
  currentDeck = deckType;
  
  const tabSample = document.getElementById('tab-sample');
  const tabCustom = document.getElementById('tab-custom');
  const tabPalace = document.getElementById('tab-palace');
  
  const gridVocabulary = document.getElementById('grid-vocabulary');
  const sectionPalace = document.getElementById('section-palace');
  const statsEl = document.getElementById('text-deck-stats');

  // Remove active state from all tabs
  if (tabSample) tabSample.classList.remove('active');
  if (tabCustom) tabCustom.classList.remove('active');
  if (tabPalace) tabPalace.classList.remove('active');

  if (deckType === 'palace') {
    if (tabPalace) tabPalace.classList.add('active');
    if (gridVocabulary) gridVocabulary.classList.add('hidden');
    if (sectionPalace) sectionPalace.classList.remove('hidden');
    if (statsEl) statsEl.style.visibility = 'hidden';
    
    // Refresh Palace views
    nextPalaceCard();
    renderPalaceManager();
    updateSyncUI();
  } else {
    if (deckType === 'sample') {
      if (tabSample) tabSample.classList.add('active');
    } else {
      if (tabCustom) tabCustom.classList.add('active');
    }
    
    if (gridVocabulary) gridVocabulary.classList.remove('hidden');
    if (sectionPalace) sectionPalace.classList.add('hidden');
    if (statsEl) statsEl.style.visibility = 'visible';
    
    renderVocabulary();
    updateDeckStats();
  }
}

// Update statistics text showing total cards
function updateDeckStats() {
  const statsEl = document.getElementById('text-deck-stats');
  if (!statsEl) return;

  const currentList = currentDeck === 'sample' ? sampleVocabulary : customVocabulary;
  statsEl.textContent = `共 ${currentList.length} 個單字`;
}

// Render dynamic grid of vocabulary cards
function renderVocabulary() {
  const grid = document.getElementById('grid-vocabulary');
  if (!grid) return;

  // Clear existing items
  grid.innerHTML = '';

  const activeList = currentDeck === 'sample' ? sampleVocabulary : customVocabulary;

  if (activeList.length === 0) {
    // Show premium descriptive placeholder if custom deck is empty
    const noDataHtml = `
      <div class="no-data-card" role="status">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-grey); margin-bottom: 0.5rem;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="19" x2="15" y2="19"/><line x1="9" y1="11" x2="10" y2="11"/></svg>
        <h3 style="color: #ffffff; font-size: 1.1rem; font-weight: 500;">尚未拍攝或上傳單字</h3>
        <p style="font-size: 0.9rem; max-width: 320px; margin: 0 auto; line-height: 1.4;">
          您可以點選上方的「<b>拍照分析</b>」或上載照片，或在「設定」中填寫 API 金鑰，讓 AI 即時生成專屬字卡！
        </p>
      </div>
    `;
    grid.innerHTML = noDataHtml;
    return;
  }

  // Create cards
  activeList.forEach((item, index) => {
    const card = document.createElement('article');
    let cardClass = 'vocab-card';
    if (englishOnlyMode) cardClass += ' masked';
    if (chineseOnlyMode) cardClass += ' masked-english';
    card.className = cardClass;
    card.setAttribute('aria-label', `英文單字卡: ${item.word}`);
    
    // Header containing English word & Pronounce Button
    const header = document.createElement('div');
    header.className = 'vocab-card-header';

    const wordEl = document.createElement('h2');
    wordEl.className = 'vocab-word';
    wordEl.textContent = item.word;

    const speakBtn = document.createElement('button');
    speakBtn.className = 'pronounce-btn';
    speakBtn.setAttribute('aria-label', `播放 ${item.word} 發音`);
    speakBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    `;

    // TTS speak event listener
    speakBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent card events if any
      
      // Reveal explanations when pronunciation is played
      card.classList.remove('masked');
      card.classList.remove('masked-english');
      
      // If already speaking this card, stop it
      if (currentSpeakingCard === card) {
        tts.stop();
        resetSpeakingState(card);
        return;
      }
      
      // If another card is speaking, reset it
      if (currentSpeakingCard) {
        resetSpeakingState(currentSpeakingCard);
      }

      // Start new speech
      currentSpeakingCard = card;
      tts.speak(
        item.word,
        () => card.classList.add('speaking'),
        () => resetSpeakingState(card)
      );
    });



    header.appendChild(wordEl);
    header.appendChild(speakBtn);

    // Phonetic Symbols (IPA)
    const phoneticEl = document.createElement('div');
    phoneticEl.className = 'vocab-phonetic';
    phoneticEl.textContent = item.phonetic;

    // Syllables row (with dots separator, e.g. "Amer · i · ca")
    const syllablesEl = document.createElement('div');
    syllablesEl.className = 'vocab-syllables';
    if (!showSyllables) {
      syllablesEl.classList.add('hidden');
    }
    syllablesEl.textContent = item.syllables;

    // Chinese explanation
    const explanationEl = document.createElement('div');
    explanationEl.className = 'vocab-explanation';
    explanationEl.textContent = item.explanation;

    // Tap/Click on masked explanation to manually reveal it
    explanationEl.addEventListener('click', () => {
      card.classList.remove('masked');
    });

    // Tap/Click on masked English elements to manually reveal them
    const revealEnglish = () => {
      card.classList.remove('masked-english');
    };
    wordEl.addEventListener('click', revealEnglish);
    phoneticEl.addEventListener('click', revealEnglish);
    syllablesEl.addEventListener('click', revealEnglish);


    card.appendChild(header);
    card.appendChild(phoneticEl);
    card.appendChild(syllablesEl);
    card.appendChild(explanationEl);

    grid.appendChild(card);

  });
}

// Reset speech active states on card UI
function resetSpeakingState(cardElement) {
  if (cardElement) {
    cardElement.classList.remove('speaking');
  }
  if (currentSpeakingCard === cardElement) {
    currentSpeakingCard = null;
  }
}

// ==========================================================================
// 記憶宮殿 Spaced Repetition System (SRS) & Firebase 雲端備份同步核心邏輯
// ==========================================================================

// 1. 本地儲存資料讀寫
function loadPalaceVocabulary() {
  try {
    const saved = localStorage.getItem('anki_english_palace_data');
    if (saved) {
      palaceVocabulary = JSON.parse(saved);
    } else {
      palaceVocabulary = [];
    }
  } catch (err) {
    console.error("無法載入記憶宮殿單字庫:", err);
    palaceVocabulary = [];
  }
}

function savePalaceVocabulary() {
  localStorage.setItem('anki_english_palace_data', JSON.stringify(palaceVocabulary));
}

// 2. 雲端同步金鑰與雙向同步 (Firebase Cloud Firestore)
function generateSyncCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'ENG-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function syncToCloud() {
  if (!syncCode) return;
  isSyncing = true;
  updateSyncUI();
  try {
    await db.collection("palace_users").doc(syncCode).set({
      deck: palaceVocabulary,
      updatedAt: Date.now()
    });
    console.log("雲端同步成功！");
    showToast("雲端同步備份成功！");
  } catch (error) {
    console.error("雲端同步失敗:", error);
    showToast("雲端同步失敗，請檢查網路！", true);
  } finally {
    isSyncing = false;
    updateSyncUI();
  }
}

async function syncFromCloud(inputCode) {
  if (!inputCode) return;
  isSyncing = true;
  updateSyncUI();
  try {
    const docSnap = await db.collection("palace_users").doc(inputCode).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (data && Array.isArray(data.deck)) {
        // 全面覆蓋本機以達成多裝置同步一致
        palaceVocabulary = data.deck;
        savePalaceVocabulary();
        syncCode = inputCode;
        localStorage.setItem('anki_palace_sync_code', syncCode);
        
        showToast("同步成功！已成功自雲端下載進度。");
        if (currentDeck === 'palace') {
          nextPalaceCard();
          renderPalaceManager();
        }
      } else {
        showToast("同步金鑰對接完成，但雲端尚無單字數據。");
        syncCode = inputCode;
        localStorage.setItem('anki_palace_sync_code', syncCode);
      }
    } else {
      // 雲端無此金鑰，代表是全新的同步金鑰，我們將本地數據直接上傳
      syncCode = inputCode;
      localStorage.setItem('anki_palace_sync_code', syncCode);
      await syncToCloud();
      showToast("新金鑰對接完成！已將本地單字庫備份至雲端。");
    }
  } catch (error) {
    console.error("對接金鑰失敗:", error);
    showToast("對接金鑰失敗，請檢查網路連線！", true);
  } finally {
    isSyncing = false;
    updateSyncUI();
  }
}

function updateSyncUI() {
  const displayEl = document.getElementById('sync-code-display');
  const btnGenerate = document.getElementById('btn-generate-sync');
  const btnEnter = document.getElementById('btn-enter-sync');
  const btnManual = document.getElementById('btn-manual-sync');
  const btnCopy = document.getElementById('btn-copy-sync-code');
  const syncIcon = document.querySelector('.sync-icon');

  if (syncIcon) {
    if (isSyncing) {
      syncIcon.classList.add('sync-icon-spin');
    } else {
      syncIcon.classList.remove('sync-icon-spin');
    }
  }

  if (syncCode) {
    if (displayEl) {
      displayEl.textContent = syncCode;
      displayEl.style.color = '#a7eed6';
    }
    if (btnGenerate) btnGenerate.style.display = 'none';
    if (btnEnter) btnEnter.textContent = '更換同步金鑰';
    if (btnManual) btnManual.style.display = 'inline-block';
    if (btnCopy) btnCopy.style.display = 'inline-block';
  } else {
    if (displayEl) {
      displayEl.textContent = '未啟用';
      displayEl.style.color = 'var(--text-grey)';
    }
    if (btnGenerate) btnGenerate.style.display = 'inline-block';
    if (btnEnter) btnEnter.textContent = '輸入金鑰對接';
    if (btnManual) btnManual.style.display = 'none';
    if (btnCopy) btnCopy.style.display = 'none';
  }
}

function copySyncCode() {
  if (!syncCode) return;
  navigator.clipboard.writeText(syncCode).then(() => {
    showToast("同步金鑰已複製到剪貼簿！");
  }).catch(err => {
    console.error("無法複製:", err);
    showToast("複製失敗，請手動複製！", true);
  });
}

// 3. 一鍵去重匯入功能
function importToPalace(deckType) {
  const sourceDeck = deckType === 'sample' ? sampleVocabulary : customVocabulary;
  if (sourceDeck.length === 0) {
    showToast("匯入來源單字庫目前是空的！", true);
    return;
  }

  let addedCount = 0;
  let skippedCount = 0;

  sourceDeck.forEach(sourceItem => {
    const cleanSourceWord = sourceItem.word.trim().toLowerCase();
    
    // 嚴格英文去重校驗 (比對不分大小寫、前後空格)
    const isDuplicate = palaceVocabulary.some(item => 
      item.word.trim().toLowerCase() === cleanSourceWord
    );

    if (isDuplicate) {
      skippedCount++;
    } else {
      // 賦予初始 SRS 間隔重複參數與狀態
      const srsCard = {
        word: sourceItem.word,
        phonetic: sourceItem.phonetic || `/${sourceItem.word}/`,
        syllables: sourceItem.syllables || sourceItem.word,
        explanation: sourceItem.explanation,
        ease: 2.5,
        interval: 0,
        nextReview: Date.now(),
        reviewsCount: 0,
        state: 'new' // 'new', 'learn', 'review'
      };
      palaceVocabulary.push(srsCard);
      addedCount++;
    }
  });

  if (addedCount > 0) {
    savePalaceVocabulary();
    syncToCloud();
    switchToDeck('palace');
    showToast(`匯入成功！新增了 ${addedCount} 個單字，略過了 ${skippedCount} 個重複單字。`);
  } else {
    showToast(`無新單字匯入。所有 ${skippedCount} 個單字在記憶宮殿中已存在！`);
  }
}

// 4. 間隔重複 (SRS) 排程演算法核心
function nextPalaceCard() {
  const now = Date.now();
  let newCards = [];
  let learningCards = [];
  let dueCards = [];
  let futureCards = [];

  palaceVocabulary.forEach(card => {
    const nextReview = card.nextReview || 0;
    const interval = card.interval || 0;

    if (nextReview <= now) {
      if (interval === 0 && (card.reviewsCount || 0) === 0) {
        newCards.push(card);
      } else if (interval < 10) {
        learningCards.push(card);
      } else {
        dueCards.push(card);
      }
    } else {
      futureCards.push({ card, time: nextReview });
    }
  });

  // 渲染統計狀態看板
  const countNewEl = document.getElementById('palace-count-new');
  const countLearnEl = document.getElementById('palace-count-learn');
  const countReviewEl = document.getElementById('palace-count-review');
  if (countNewEl) countNewEl.textContent = newCards.length;
  if (countLearnEl) countLearnEl.textContent = learningCards.length;
  if (countReviewEl) countReviewEl.textContent = dueCards.length;

  // 重置字卡 3D 翻轉效果為正面
  const cardInner = document.getElementById('palace-card-inner');
  if (cardInner) {
    cardInner.classList.remove('flipped');
  }
  
  const btnShowAnswer = document.getElementById('btn-palace-show-answer');
  const ratingButtons = document.getElementById('palace-rating-buttons');
  const studySection = document.getElementById('palace-card-container');
  const doneView = document.getElementById('palace-done-view');

  // SRS 優先級排程：學習中 -> 複習中 -> 新單字
  if (learningCards.length > 0) {
    currentPalaceCard = learningCards[0];
  } else if (dueCards.length > 0) {
    currentPalaceCard = dueCards[0];
  } else if (newCards.length > 0) {
    currentPalaceCard = newCards[0];
  } else {
    currentPalaceCard = null;
  }

  if (currentPalaceCard) {
    if (studySection) studySection.classList.remove('hidden');
    if (btnShowAnswer) btnShowAnswer.classList.remove('hidden');
    if (ratingButtons) ratingButtons.classList.add('hidden');
    if (doneView) doneView.classList.add('hidden');

    renderPalaceCardFrontAndBack();
  } else {
    // 今日無到期複習，呈現修練完成畫面
    if (studySection) studySection.classList.add('hidden');
    if (btnShowAnswer) btnShowAnswer.classList.add('hidden');
    if (ratingButtons) ratingButtons.classList.add('hidden');
    if (doneView) doneView.classList.remove('hidden');

    const nextDueEl = document.getElementById('palace-next-due-time');
    if (nextDueEl) {
      if (futureCards.length > 0) {
        futureCards.sort((a, b) => a.time - b.time);
        const diffMin = Math.round((futureCards[0].time - Date.now()) / 60000);
        if (diffMin < 1) {
          nextDueEl.textContent = "幾秒鐘";
        } else if (diffMin < 60) {
          nextDueEl.textContent = `${diffMin} 分鐘`;
        } else if (diffMin < 1440) {
          nextDueEl.textContent = `${Math.round(diffMin / 60)} 小時`;
        } else {
          nextDueEl.textContent = `${Math.round(diffMin / 1440)} 天`;
        }
      } else {
        nextDueEl.textContent = "無排程（請先匯入單字）";
      }
    }
  }
}

function renderPalaceCardFrontAndBack() {
  if (!currentPalaceCard) return;

  const wordFront = document.getElementById('palace-word');
  const phoneticFront = document.getElementById('palace-phonetic');
  const syllablesFront = document.getElementById('palace-syllables');

  const wordBack = document.getElementById('palace-word-back');
  const phoneticBack = document.getElementById('palace-phonetic-back');
  const syllablesBack = document.getElementById('palace-syllables-back');
  const explanationBack = document.getElementById('palace-explanation');

  if (wordFront) wordFront.textContent = currentPalaceCard.word;
  if (phoneticFront) phoneticFront.textContent = currentPalaceCard.phonetic;
  if (syllablesFront) syllablesFront.textContent = currentPalaceCard.syllables;

  if (wordBack) wordBack.textContent = currentPalaceCard.word;
  if (phoneticBack) phoneticBack.textContent = currentPalaceCard.phonetic;
  if (syllablesBack) syllablesBack.textContent = currentPalaceCard.syllables;
  if (explanationBack) explanationBack.textContent = currentPalaceCard.explanation;
}

function showPalaceAnswer() {
  const cardInner = document.getElementById('palace-card-inner');
  if (cardInner) {
    cardInner.classList.add('flipped');
  }

  const btnShowAnswer = document.getElementById('btn-palace-show-answer');
  const ratingButtons = document.getElementById('palace-rating-buttons');
  if (btnShowAnswer) btnShowAnswer.classList.add('hidden');
  if (ratingButtons) ratingButtons.classList.remove('hidden');

  playPalaceSound();
  calcPalaceIntervals();
}

function playPalaceSound() {
  if (!currentPalaceCard) return;
  // 沿用系統語速播放發音
  tts.speak(currentPalaceCard.word);
}

function calcPalaceIntervals() {
  if (!currentPalaceCard) return;
  const ease = currentPalaceCard.ease || 2.5;
  const interval = currentPalaceCard.interval || 0;

  // 評分按鈕時間間隔公式計算 (單位：分鐘)：
  // 1. 重來: 0.5 分鐘 (30 秒)
  // 2. 困難: 乘上 1.2 倍
  // 3. 良好: 乘上 ease 因數
  // 4. 簡單: 乘上 ease 乘上 1.3 倍，最低起跳 4 天 (5760 分鐘)
  let ints = [
    0.5,
    Math.max(1, Math.round(interval * 1.2)),
    Math.max(10, Math.round(interval * ease)),
    Math.max(5760, Math.round(interval * ease * 1.3))
  ];
  
  window.currentPalaceIntervals = ints;

  const fmt = (m) => {
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
  };

  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`rate-time-${i}`);
    if (el) el.textContent = fmt(ints[i - 1]);
  }
}

function ratePalaceCard(rating) {
  if (!currentPalaceCard) return;
  
  const id = palaceVocabulary.findIndex(card => card.word === currentPalaceCard.word);
  if (id === -1) return;

  let card = palaceVocabulary[id];
  card.reviewsCount = (card.reviewsCount || 0) + 1;

  let ease = card.ease || 2.5;
  if (rating === 1) ease = Math.max(1.3, ease - 0.2);
  if (rating === 4) ease += 0.15;
  card.ease = ease;

  const selectedInterval = window.currentPalaceIntervals[rating - 1];
  card.interval = selectedInterval;
  card.nextReview = Date.now() + (selectedInterval * 60 * 1000);

  if (selectedInterval < 10) {
    card.state = 'learn';
  } else {
    card.state = 'review';
  }

  palaceVocabulary[id] = card;

  savePalaceVocabulary();
  syncToCloud();

  renderPalaceManager();
  nextPalaceCard();
}

// 5. 宮殿字庫搜尋與管理清單
function renderPalaceManager() {
  const listEl = document.getElementById('list-palace-words');
  const statsEl = document.getElementById('palace-total-stats');
  if (!listEl) return;

  listEl.innerHTML = '';
  if (statsEl) statsEl.textContent = palaceVocabulary.length;

  if (palaceVocabulary.length === 0) {
    listEl.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: var(--text-grey); padding: 2rem 0; font-size: 0.9rem; font-weight: 500;">
        目前宮殿內沒有單字，請使用上方按鈕匯入！
      </div>
    `;
    return;
  }

  const query = palaceSearchQuery.trim().toLowerCase();
  const filtered = palaceVocabulary.filter(item => 
    item.word.toLowerCase().includes(query) || 
    item.explanation.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: var(--text-grey); padding: 2rem 0; font-size: 0.9rem; font-weight: 500;">
        無符合搜尋條件的單字
      </div>
    `;
    return;
  }

  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'palace-word-row';

    const wordEl = document.createElement('div');
    wordEl.className = 'palace-row-word';
    wordEl.textContent = item.word;

    const expEl = document.createElement('div');
    expEl.className = 'palace-row-exp';
    expEl.textContent = item.explanation;

    const metaEl = document.createElement('div');
    metaEl.className = 'palace-row-meta';

    const badge = document.createElement('span');
    badge.className = 'badge-srs-status';
    
    const interval = item.interval || 0;
    if (interval === 0 && (item.reviewsCount || 0) === 0) {
      badge.className += ' badge-new';
      badge.textContent = '新單字';
    } else if (interval < 10) {
      badge.className += ' badge-learn';
      badge.textContent = '學習中';
    } else {
      badge.className += ' badge-review';
      badge.textContent = '複習中';
    }
    metaEl.appendChild(badge);

    // 選擇性刪除按鈕
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete-row';
    delBtn.setAttribute('aria-label', `自宮殿刪除 ${item.word}`);
    delBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
    `;

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const confirmDelete = confirm(`確定要將單字「${item.word}」從記憶宮殿中刪除嗎？這將會重設其複習進度！`);
      if (confirmDelete) {
        deleteFromPalace(item.word);
      }
    });

    row.appendChild(wordEl);
    row.appendChild(expEl);
    row.appendChild(metaEl);
    row.appendChild(delBtn);

    listEl.appendChild(row);
  });
}

function deleteFromPalace(word) {
  palaceVocabulary = palaceVocabulary.filter(item => item.word !== word);
  savePalaceVocabulary();
  syncToCloud();
  renderPalaceManager();
  nextPalaceCard();
  showToast(`已成功將「${word}」移出記憶宮殿！`);
}
