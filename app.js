import { sampleVocabulary } from './sampleData.js';
import { tts } from './tts.js';
import { analyzeTextbookImage, fileToBase64 } from './gemini.js';

// Application State
let currentDeck = 'sample'; // 'sample' or 'custom'
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



// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadApiKey();
  loadCustomVocabulary();
  initEventListeners();
  renderVocabulary();
  updateDeckStats();
  
  // Set default speed rate in TTS manager
  tts.setRate(speechRates[currentSpeedIndex].value);
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
}

// Helper to switch active vocabulary deck
function switchToDeck(deckType) {
  currentDeck = deckType;
  
  const tabSample = document.getElementById('tab-sample');
  const tabCustom = document.getElementById('tab-custom');
  
  if (deckType === 'sample') {
    if (tabSample) tabSample.classList.add('active');
    if (tabCustom) tabCustom.classList.remove('active');
  } else {
    if (tabSample) tabSample.classList.remove('active');
    if (tabCustom) tabCustom.classList.add('active');
  }
  
  renderVocabulary();
  updateDeckStats();
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
